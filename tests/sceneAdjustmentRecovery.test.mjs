import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test, afterEach } from "node:test";
import { classifyJsonPrefix } from "../core/util/jsonPrefix.js";
import { parseSceneJsonString, generateSceneJsonString, requestUpdatedSceneJsonString } from "../core/ai/sceneAiService.js";
import { runAiAdjustTurn } from "../tools/scene-host/shared/js/aiTurnOrchestrator.js";
import { runAiAdjustTurn as runPackagedAdjustTurn } from "../packages/host-kit/js/aiTurnOrchestrator.js";
import { runSceneAgent } from "../core/ai/sceneAgent.js";
import { createRuntimeSceneSession, captureSceneSession, executeSceneSessionCommands } from "../core/session.js";
import { formatObjectGetFeedbackFromBatch } from "../core/ai/sceneCommandSkill.js";
import { getObjectByThreeJsonId } from "../core/handler/objectRegistry.js";
import { Raycaster, Vector3 } from "three";

const validText = await readFile(new URL("./fixtures/vase-adjustment-valid.json", import.meta.url), "utf8");
const invalidText = await readFile(new URL("./fixtures/vase-adjustment-invalid.txt", import.meta.url), "utf8");
const vase = JSON.parse(validText).objectList.find((record) => record.threeJsonId === "vase-body");
// Evaluate the exact attached source graph without requesting its unrelated web textures/fonts.
const modelScene = { threeJsonId: "vase-test", objectList: [vase] };
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const options = { provider: "deepseek", apiKey: "test-key", stream: true, capabilityLookup: false, capabilityReview: false };
function respond(content, finishReason = "stop") {
  // Exercise arbitrary SSE boundaries, including inside quotes, numbers and markers.
  const deltas = content.match(/[\s\S]{1,19}/g) || [];
  return new Response(deltas.map((delta) => `data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`).join("")
    + `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finishReason }] })}\n\ndata: [DONE]\n\n`,
  { headers: { "Content-Type": "text/event-stream" } });
}
function mockReplies(replies) {
  const requests = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    assert.ok(replies.length, "unexpected extra provider request");
    const reply = replies.shift();
    return respond(typeof reply === "string" ? reply : reply.content, reply.finishReason);
  };
  return requests;
}
function outputSink() {
  return { text: "", resets: 0, delta(delta, metadata = {}) {
    if (metadata.reset) { this.text = ""; this.resets++; }
    this.text += delta;
  } };
}

test("JSON prefix classification separates true EOF from corruption in the attached vase", () => {
  assert.equal(classifyJsonPrefix(validText).status, "complete");
  assert.equal(classifyJsonPrefix(invalidText).status, "invalid");
  assert.throws(() => parseSceneJsonString(invalidText), (error) => {
    assert.match(error.message, /JSON string is malformed/);
    assert.doesNotMatch(error.message, /arithmetic expression/);
    return true;
  });
  const compact = '{"a":[true,false,null,-1.25e-12,"\\u1234 \\"\\\\"],"b":{}}';
  assert.doesNotThrow(() => JSON.parse(compact));
  for (let i = 0; i < compact.length; i++) assert.equal(classifyJsonPrefix(compact.slice(0, i)).status, "incomplete", `prefix ${i}`);
  for (const text of ['{"a":1..', '{"a"::', '{"a":truee', '{"a":01', '{"a":"\\x', '{"a":"line\nbreak', '{"a":1,}', '{}{}']) {
    assert.equal(classifyJsonPrefix(text).status, "invalid", text);
  }
  const deep = "[".repeat(10000) + "0" + "]".repeat(10000);
  assert.equal(classifyJsonPrefix(deep).status, "complete");
});

test("a truncated adjustment restarts a clean JSON stream in both host adapters", async () => {
  const changed = JSON.parse(validText);
  changed.name = "adjusted-vase";
  const complete = JSON.stringify(changed);
  for (const run of [runAiAdjustTurn, runPackagedAdjustTurn]) {
    const sink = outputSink();
    const requests = mockReplies([
      { content: complete.slice(0, 180), finishReason: "length" },
      complete.slice(0, 380) + "\n<<<THREEJSON_CONTINUE>>>",
      complete.slice(380) + "\n<<<THREEJSON_COMPLETE>>>"
    ]);
    const result = await run({ userPrompt: "adjust the vase", targetSceneJsonString: validText,
      providerOptions: options, strictOutputMode: true, updateOutputMode: "json-full", onDelta: sink.delta.bind(sink) });
    assert.equal(requests.length, 3);
    assert.equal(sink.text, complete, "failed-output UI must not retain the abandoned prefix or transport markers");
    assert.equal(JSON.parse(result.sceneJsonString).name, "adjusted-vase");
    assert.equal(sink.resets, 2);
  }
});

test("invalid middle syntax with finish_reason length is not mistaken for recoverable truncation", async () => {
  const requests = mockReplies([{ content: invalidText, finishReason: "length" }]);
  await assert.rejects(requestUpdatedSceneJsonString("adjust the vase", validText, options), /JSON string is malformed/);
  assert.equal(requests.length, 1);
});

test("segmented recovery rejects the damaged vase, then streams only the corrected document", async () => {
  const sink = outputSink();
  const requests = mockReplies([invalidText, validText + "\n<<<THREEJSON_COMPLETE>>>"]);
  const result = await generateSceneJsonString("a vase", { ...options, segmentedOutput: true, onDelta: sink.delta.bind(sink) });
  assert.equal(requests.length, 2);
  assert.match(requests[1].messages.at(-1).content, /NOT appended/);
  assert.equal(sink.text, validText);
  assert.equal(JSON.parse(result).name, "plum-blossom-vase");
});

test("an invalid continuation is replaced, not permanently appended to the valid prefix", async () => {
  const first = '{"sceneConfig":{"scene":{"background":"#111111"}},"name":"';
  const sink = outputSink();
  const requests = mockReplies([
    first + "\n<<<THREEJSON_CONTINUE>>>",
    '{\n"name":"restart"}',
    'repaired"}\n<<<THREEJSON_COMPLETE>>>'
  ]);
  const result = await generateSceneJsonString("a scene", { ...options, segmentedOutput: true, onDelta: sink.delta.bind(sink) });
  assert.equal(requests.length, 3);
  assert.equal(JSON.parse(sink.text).name, "repaired");
  assert.equal(JSON.parse(result).name, "repaired");
});

test("repeated malformed fragments stop after protocol repair, preserving exact diagnostic output", async () => {
  const requests = mockReplies([invalidText, invalidText]);
  await assert.rejects(generateSceneJsonString("a vase", { ...options, segmentedOutput: true }), (error) => {
    assert.equal(error.code, "SCENE_JSON_SEGMENT_INVALID");
    assert.equal(error.rawContent, invalidText);
    return true;
  });
  assert.equal(requests.length, 2);
});

test("identical but useful array fragments are allowed beyond sixty-four responses", async () => {
  const replies = ['{"sceneConfig":{"scene":{"background":"#111111"}},"metadata":{"coordinates":[\n<<<THREEJSON_CONTINUE>>>',
    ...Array.from({ length: 66 }, () => '0,\n<<<THREEJSON_CONTINUE>>>'), '0]}}\n<<<THREEJSON_COMPLETE>>>'];
  const requests = mockReplies(replies);
  const result = await generateSceneJsonString("coordinate output", { ...options, segmentedOutput: true });
  assert.equal(requests.length, 68);
  assert.equal(JSON.parse(result).metadata.coordinates.length, 67);
});

test("a CONTINUE marker does not turn repeated document openings into useful progress", async () => {
  const opening = '{"objectList":[\n<<<THREEJSON_CONTINUE>>>';
  const requests = mockReplies([opening, opening, opening]);
  await assert.rejects(generateSceneJsonString("a vase", { ...options, segmentedOutput: true }),
    (error) => error.code === "SCENE_OUTPUT_LIMIT" && /repeated or empty/.test(error.message));
  assert.equal(requests.length, 3);
});

test("the attached lowercase modeledmesh is inspected and adjusted locally after a thrown topology error", async () => {
  const session = await createRuntimeSceneSession(modelScene);
  const snapshot = () => JSON.stringify(captureSceneSession(session));
  const before = snapshot();
  const fromAbove = () => {
    session.runtime.scene.updateMatrixWorld(true);
    return new Raycaster(new Vector3(0.025, 4, 0.01), new Vector3(0, -1, 0))
      .intersectObject(getObjectByThreeJsonId("vase-body", session.runtime.scene))[0]?.point.y;
  };
  assert.ok(fromAbove() > 2.9, "the original vase is capped at the top");
  const profile = vase.modeling.nodes[0].params.points;
  const hollowProfile = [...profile.slice(0, -1), ...profile.slice(2, -1).reverse().map(([r, y, z]) => [Math.max(0.05, r - 0.06), y, z]), [0, 0.06, 0]];
  const patch = [{ op: "replace", path: "/nodes/0/params/points", value: hollowProfile }];
  const requests = mockReplies(["mesh.getTopology id=vase-body", "model.inspect id=vase-body",
    `model.patch id=vase-body baseRevision=0 patch=${JSON.stringify(patch)}\n# done`]);
  try {
    const result = await runAiAdjustTurn({ userPrompt: "继续细化，让花瓶空心", envelope: "继续细化，让花瓶空心",
      targetSceneJsonString: before, providerOptions: options, capabilityLookup: false,
      selectedCapabilityIds: ["complexMesh"],
      resolveContextPayload: () => ({ objectList: [{ threeJsonId: "vase-body", objType: "modeledmesh" }] }),
      applyCommands: async (commands) => {
        const batch = await executeSceneSessionCommands(session, commands);
        if (!batch.ok) {
          assert.equal(snapshot(), before);
          // Both thrown host failures and returned {ok:false} must stay in local repair.
          throw new Error(batch.error?.message || batch.results.find((entry) => !entry.ok)?.error);
        }
        return { ...batch, objectGetFeedback: formatObjectGetFeedbackFromBatch(batch.results) };
      }, refreshContext: async () => ({ currentSceneJsonString: snapshot() }) });
    assert.equal(requests.length, 3);
    assert.match(requests[0].messages[0].content, /Computable modeling \(modelingGraph\)/);
    assert.match(requests[1].messages[1].content, /Previous error:.*model.inspect/);
    assert.equal(result.stage, "commands");
    assert.equal(result.agentResult.completed, true);
    assert.equal(session.document.root.objectList[0].modelRevision, 1);
    assert.deepEqual(session.document.root.objectList[0].modeling.nodes[0].params.points, hollowProfile);
    assert.ok(getObjectByThreeJsonId("vase-body", session.runtime.scene).geometry.attributes.position.count > 1000);
    assert.ok(fromAbove() < 0.2, "the opening now exposes the interior floor, not a lid");
    await session.undo();
    assert.equal(snapshot(), before);
  } finally { session.dispose(); }
});

test("agent JSON-mode restart forwards reset metadata instead of mixing two documents", async () => {
  const updated = JSON.stringify({ ...modelScene, name: "updated" });
  mockReplies([{ content: updated.slice(0, 90), finishReason: "length" }, updated]);
  const sink = outputSink();
  const result = await runSceneAgent({ mode: "update", prompt: "rename", currentSceneJsonString: JSON.stringify(modelScene), outputMode: "json" },
    { ...options, onDelta: sink.delta.bind(sink), agent: { outline: false } });
  assert.equal(sink.text, updated);
  assert.equal(JSON.parse(result.sceneJsonString).name, "updated");
});

test("fallback JSON must compile before success; a pathless tube rolls back to the vase", async () => {
  for (const run of [runAiAdjustTurn, runPackagedAdjustTurn]) {
    const session = await createRuntimeSceneSession(modelScene);
    const snapshot = () => JSON.stringify(captureSceneSession(session));
    const before = snapshot();
    const updated = { ...modelScene, name: "verified-vase" };
    const invalidPatch = [{ op: "replace", path: "/objectList/0/objType", value: "tube" }];
    const requests = mockReplies(["mesh.getTopology id=vase-body", JSON.stringify(invalidPatch), JSON.stringify(updated)]);
    const failed = [];
    try {
      const result = await run({ userPrompt: "adjust the vase", envelope: "adjust the vase", targetSceneJsonString: before,
        providerOptions: options, capabilityLookup: false, agentOptions: { maxRefineRounds: 1 },
        applyCommands: async (commands) => {
          const batch = await executeSceneSessionCommands(session, commands);
          if (!batch.ok) { failed.push(snapshot()); return { ok: false, error: batch.error?.message || batch.results.find((entry) => !entry.ok)?.error }; }
          return batch;
        }, refreshContext: async () => ({ currentSceneJsonString: snapshot() }) });
      assert.equal(requests.length, 3);
      assert.equal(result.stage, "json-full");
      assert.equal(result.sceneJson.name, "verified-vase");
      assert.equal(failed.length, 2);
      assert.ok(failed.every((state) => state === before));
      assert.match(requests[2].messages[1].content, /Tube requires a valid path/);
    } finally { session.dispose(); }
  }
});

test("invalid Patch and full-JSON fallbacks never replace the last good vase", async () => {
  const session = await createRuntimeSceneSession(modelScene);
  const snapshot = () => JSON.stringify(captureSceneSession(session));
  const before = snapshot();
  const invalidScene = { objectList: [{ ...vase, objType: "tube" }] };
  const requests = mockReplies(["mesh.getTopology id=vase-body",
    JSON.stringify([{ op: "replace", path: "/objectList/0/objType", value: "tube" }]), JSON.stringify(invalidScene)]);
  try {
    await assert.rejects(runAiAdjustTurn({ userPrompt: "adjust", envelope: "adjust", targetSceneJsonString: before,
      providerOptions: options, capabilityLookup: false, agentOptions: { maxRefineRounds: 1 },
      applyCommands: async (commands) => {
        const batch = await executeSceneSessionCommands(session, commands);
        return { ...batch, error: batch.error?.message || batch.results?.find((entry) => !entry.ok)?.error };
      }, refreshContext: async () => ({ currentSceneJsonString: snapshot() }) }), /Tube requires a valid path/);
    assert.equal(requests.length, 3);
    assert.equal(snapshot(), before);
    assert.equal(session.revision, 0);
  } finally { session.dispose(); }
});

test("cancelling a command application does not enter local repair or JSON fallback", async () => {
  const abort = new DOMException("User cancelled", "AbortError");
  const requests = mockReplies(['object.patch id=vase-body partial={"position":{"x":1}}']);
  await assert.rejects(runAiAdjustTurn({ userPrompt: "move", envelope: "move", targetSceneJsonString: JSON.stringify(modelScene),
    providerOptions: options, capabilityLookup: false,
    applyCommands: async () => { throw abort; }, refreshContext: async () => ({ currentSceneJsonString: JSON.stringify(modelScene) }) }),
  (error) => error === abort);
  assert.equal(requests.length, 1);
});

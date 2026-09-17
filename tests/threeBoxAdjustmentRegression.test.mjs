import test from "node:test";
import assert from "node:assert/strict";
import { createSceneCardSession } from "../tools/scene-host/shared/js/sceneCardSession.js";
import { runAiAdjustTurn, resolveAiAdjustContextPayload } from "../tools/scene-host/shared/js/aiTurnOrchestrator.js";
import { createJsonScene } from "../core/handler/sceneLoadHandler.js";
import { getObjectByThreeJsonId } from "../core/handler/objectRegistry.js";
import { formatObjectGetFeedbackFromBatch } from "../core/ai/sceneCommandSkill.js";
import { requestUpdatedSceneJsonString, requestUpdatedSceneEditCommands } from "../core/ai/sceneAiService.js";
import { parseCommandScript } from "../core/command/parser.js";

const scene = () => ({
  threeJsonId: "adjustment-regression",
  sceneConfig: { scene: { background: "#7ec8e3" } },
  objectList: [{ threeJsonId: "box", objType: "box", material: { color: "#336699" } }]
});
const recolor = { op: "material.patch", args: { id: "box", partial: { color: "#ff0000" } } };

function response(content, finishReason = "stop") {
  return new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}\n\n` +
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finishReason }] })}\n\n` +
    "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } }
  );
}

async function adjustThroughRealCard(t, replies, settings = {}) {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    assert.ok(requests.length <= replies.length, "valid edits must not fall back to rewriting the whole scene");
    const reply = replies[requests.length - 1];
    return response(typeof reply === "function" ? reply(body) : reply);
  });
  const card = createSceneCardSession({ createRuntime: createJsonScene });
  try {
    await card.render(scene());
    const before = card.export();
    const resolveContext = (document) => resolveAiAdjustContextPayload(document, settings);
    const result = await runAiAdjustTurn({
      userPrompt: "把立方体改成红色", envelope: "把立方体改成红色",
      targetSceneJsonString: JSON.stringify(before), updateOutputMode: "commands",
      providerOptions: { apiKey: "test-only", provider: "custom", baseUrl: "https://provider.invalid/v1" },
      capabilityLookup: false, resolveContextPayload: resolveContext,
      applyCommands: async (commands) => {
        const result = await card.execute(commands);
        return { ...result, objectGetFeedback: formatObjectGetFeedbackFromBatch(result.results) };
      },
      refreshContext: async () => ({ ...resolveContext(card.export()), currentSceneJsonString: JSON.stringify(card.export()) })
    });
    assert.equal(result.stage, "commands");
    assert.equal(JSON.parse(result.sceneJsonString).objectList[0].material.color, "#ff0000");
    assert.equal(before.objectList[0].material.color, "#336699", "the previous turn must remain unchanged");
    const mesh = getObjectByThreeJsonId("box", card.runtime.scene);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      assert.equal(material.color.getHexString(), "ff0000", "verify actual runtime materials, not just a success flag");
    }
    return requests;
  } finally { card.dispose(); }
}

for (const [name, script] of [
  ["formatted command object", JSON.stringify(recolor, null, 2)],
  ["formatted command array", JSON.stringify([recolor], null, 2)],
  ["multiline DSL argument", `material.patch id=box partial=${JSON.stringify(recolor.args.partial, null, 2)}`]
]) {
  test(`ThreeBox applies ${name} in one completion through the real session`, async (t) => {
    const requests = await adjustThroughRealCard(t, [`${script}\n# done`]);
    assert.equal(requests.length, 1);
  });
}

test("JSON Patch followed by # done is applied rather than discarded as a completion-only reply", async (t) => {
  await adjustThroughRealCard(t, ['[{"op":"replace","path":"/objectList/0/material/color","value":"#ff0000"}]\n# done']);
});

test("scene listing and scalar property reads are returned to the model before the edit", async (t) => {
  await adjustThroughRealCard(t, [
    "scene.list",
    (body) => {
      assert.match(body.messages[1].content, /"op": "scene.list"/);
      return 'object.get id=box path="material.color"';
    },
    (body) => {
      assert.match(body.messages[1].content, /"path": "material.color"/);
      assert.match(body.messages[1].content, /#336699/);
      return JSON.stringify(recolor);
    }
  ], { includeSpatialSummary: false });
});

test("a malformed final command never permits partial execution of an earlier valid command", () => {
  assert.throws(() => parseCommandScript(`${JSON.stringify(recolor)}\nobject.patch id=box partial={"position":`));
});

test("multiline parsing preserves escaped strings, hash colors, comments and tab-delimited arguments", () => {
  const script = `# comment containing unmatched {\n${JSON.stringify({
    op: "object.patch", args: { id: "box", partial: { name: 'label "]} # done', material: { color: "#ff0000" } } }
  }, null, 2)}\nobject.get\tid=box\tpath="material.color"\n`;
  const commands = parseCommandScript(script);
  assert.equal(commands.length, 2);
  assert.equal(commands[0].args.partial.name, 'label "]} # done');
  assert.equal(commands[1].args.path, "material.color");
  assert.equal(parseCommandScript('{"op":"scene.list", /* } "] */ "args":{}}')[0].op, "scene.list");
});

test("full scene JSON followed by # done is not mistaken for an empty update", async (t) => {
  const updated = scene(); updated.objectList[0].material.color = "#ff0000";
  t.mock.method(globalThis, "fetch", async () => response(`${JSON.stringify(updated, null, 2)}\n# done`));
  const result = await requestUpdatedSceneEditCommands("change color", { currentSceneJsonString: JSON.stringify(scene()) }, {
    apiKey: "test-only", provider: "custom", baseUrl: "https://provider.invalid/v1", stream: true,
    agentRound: true, fallbackToJson: false
  });
  assert.equal(result.outputMode, "json");
  assert.equal(JSON.parse(result.sceneJsonString).objectList[0].material.color, "#ff0000");
});

for (const finishReason of [null, "stop", "length"]) {
  test(`short truncated adjustment JSON is recovered even with finish_reason=${finishReason}`, async (t) => {
    // Same failure shape reported in production: output stops in the background color string.
    const truncated = '{\n  "version": "next",\n  "name": "adventure-island",\n  "threeJsonId": "adventure-island-scene",\n  "schemaVersion": 2,\n  "sceneConfig": {\n    "scene": {\n      "background": "#7ec8e3';
    const updated = scene(); updated.objectList[0].material.color = "#ff0000";
    const requests = [];
    t.mock.method(globalThis, "fetch", async (_url, init) => {
      requests.push(JSON.parse(init.body));
      assert.ok(requests.length <= 2);
      return requests.length === 1 ? response(truncated, finishReason) : response(JSON.stringify(updated));
    });
    const output = await requestUpdatedSceneJsonString("把立方体改成红色", JSON.stringify(scene()), {
      apiKey: "test-only", provider: "custom", baseUrl: "https://provider.invalid/v1", stream: true, updateMode: "full"
    });
    assert.equal(JSON.parse(output).objectList[0].material.color, "#ff0000");
    assert.equal(requests.length, 2);
    assert.ok(requests.every((request) => !Object.hasOwn(request, "max_tokens")));
  });
}

test("a provider repeating an incomplete adjustment stops without inventing a replacement scene", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return response('{"objectList":['); });
  await assert.rejects(requestUpdatedSceneJsonString("change color", JSON.stringify(scene()), {
    apiKey: "test-only", provider: "custom", baseUrl: "https://provider.invalid/v1", stream: true
  }), (error) => error.code === "SCENE_OUTPUT_LIMIT" && /repeated or empty/.test(error.message));
  assert.equal(calls, 4, "one initial attempt and the existing repeated-fragment anomaly guard");
});

test("cancelling adjustment recovery stops before another provider request", async (t) => {
  const controller = new AbortController();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    init.signal.throwIfAborted(); calls++;
    return response('{"objectList":[');
  });
  await assert.rejects(requestUpdatedSceneJsonString("change color", JSON.stringify(scene()), {
    apiKey: "test-only", provider: "custom", baseUrl: "https://provider.invalid/v1", stream: true,
    signal: controller.signal,
    onGenerationPhase: () => controller.abort(new DOMException("Cancelled", "AbortError"))
  }), { name: "AbortError" });
  assert.equal(calls, 1);
});

test("an explicit adjustment response budget is still respected during short-output recovery", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return response('{"objectList":['); });
  await assert.rejects(requestUpdatedSceneJsonString("change color", JSON.stringify(scene()), {
    apiKey: "test-only", provider: "custom", baseUrl: "https://provider.invalid/v1", stream: true, maxSceneSegments: 1
  }), (error) => error.code === "SCENE_OUTPUT_LIMIT" && /configured 1/.test(error.message));
  assert.equal(calls, 2);
});

test("syntax errors inside JSON do not start an unproductive continuation loop", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return response('{"objectList":[ invalid'); });
  await assert.rejects(requestUpdatedSceneJsonString("change color", JSON.stringify(scene()), {
    apiKey: "test-only", provider: "custom", baseUrl: "https://provider.invalid/v1", stream: true
  }), /Invalid scene JSON/);
  assert.equal(calls, 1);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mock, test } from "node:test";
import {
  resolveImmediateDirectGeneration,
  runAiAdjustTurn
} from "../tools/scene-host/shared/js/aiTurnOrchestrator.js";

const SCENE = JSON.stringify({
  threeJsonId: "live-adjust-test",
  objectList: [{
    threeJsonId: "floor",
    objType: "box",
    geometry: { width: 10, height: 0.2, depth: 10 },
    material: { color: "#888888" }
  }]
});

const CHANGED_SCENE = JSON.stringify({
  threeJsonId: "live-adjust-test",
  objectList: [{
    threeJsonId: "floor",
    objType: "box",
    geometry: { width: 10, height: 0.2, depth: 10 },
    material: { color: "#336699" }
  }]
});

function sseResponse(content) {
  const body = [
    `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
    "data: [DONE]\n\n"
  ].join("");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" }
  });
}

test("image generation wires the same incremental draft command executor as text generation", async () => {
  const source = await readFile(
    new URL("../tools/scene-host/shared/js/aiTurnOrchestrator.js", import.meta.url),
    "utf8"
  );
  const hostKitSource = await readFile(
    new URL("../packages/host-kit/js/aiTurnOrchestrator.js", import.meta.url),
    "utf8"
  );
  const imageRunner = source.slice(
    source.indexOf("export async function runAiImageGenerateTurn"),
    source.indexOf("export async function classifyAiTurnIntent")
  );
  assert.match(
    imageRunner,
    /applyDraftCommands:\s*\(commands, context\) => applyAiDraftCommands\(commands,[\s\S]*visualReviewAvailable/
  );
  assert.doesNotMatch(source, /maxTokens\s*=\s*\d+/);
  assert.doesNotMatch(hostKitSource, /maxTokens\s*=\s*\d+/);
});

test("automatic first generations negotiate construction policy while complete mode may use the bounded fast path", () => {
  assert.equal(resolveImmediateDirectGeneration({
    userPrompt: "Generate an Earth-Moon system with rotation and orbit",
    history: []
  }), null);

  const direct = resolveImmediateDirectGeneration({
    userPrompt: "Generate an Earth-Moon system with rotation and orbit",
    history: []
  }, { sceneGenerationMode: "direct" });
  assert.equal(direct?.executionMode, "direct");
  assert.equal(direct?.generationStrategy, "single");
  assert.equal(direct?.selectedCapabilityIds, undefined);

  assert.equal(resolveImmediateDirectGeneration({
    userPrompt: "Generate a city with four districts, infrastructure and hundreds of buildings",
    history: []
  }, { sceneGenerationMode: "direct" }), null);
  const adjust = resolveImmediateDirectGeneration({
    userPrompt: "把月球改成红色",
    history: [{ turnId: "earth", summary: "地月系统" }]
  });
  assert.equal(adjust?.intent, "adjust");
  assert.equal(adjust?.targetTurnId, "earth");
  const terseAdjust = resolveImmediateDirectGeneration({
    userPrompt: "变成红色",
    history: [{ turnId: "cube", summary: "蓝色立方体" }]
  });
  assert.equal(terseAdjust?.intent, "adjust");
  assert.equal(terseAdjust?.targetTurnId, "cube");

  assert.equal(resolveImmediateDirectGeneration({
    userPrompt: "Create a new red sphere",
    history: [{ turnId: "earth", summary: "Earth system" }]
  }), null);
});

test("runAiAdjustTurn applies automatic rounds through host live-runtime callbacks", async () => {
  const replies = [
    "- adjust floor color",
    'object.patch id=floor partial={"material":{"color":"#336699"}}',
    "# done"
  ];
  const applied = [];
  const requestBodies = [];
  const fetchMock = mock.fn(async (_url, init = {}) => {
    requestBodies.push(JSON.parse(init.body));
    return {
      ok: true,
      async text() { return ""; },
      async json() { return { choices: [{ message: { content: replies.shift() || "# done" } }] }; }
    };
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runAiAdjustTurn({
      userPrompt: "change the floor color",
      envelope: "change the floor color",
      targetSceneJsonString: SCENE,
      providerOptions: { apiKey: "test-key", provider: "deepseek" },
      agentOptions: { maxRefineRounds: 4 },
      updateOutputMode: "auto",
      resolveContextPayload: () => ({ objectList: [{ threeJsonId: "floor", objType: "box" }] }),
      applyCommands: async (commands) => {
        applied.push(...commands);
        return { ok: true, sceneMutated: true };
      },
      refreshContext: async () => ({
        currentSceneJsonString: CHANGED_SCENE,
        objectList: [{ threeJsonId: "floor", objType: "box" }]
      })
    });

    assert.equal(result.liveApplied, true);
    assert.equal(result.agentResult.completed, true);
    assert.equal(result.agentResult.stopReason, "implicit_complete");
    assert.equal(applied.length, 1);
    assert.equal(result.commands.length, 1);
    assert.equal(fetchMock.mock.calls.length, 2);
    assert.ok(requestBodies.every((body) => !Object.hasOwn(body, "max_tokens")));
    assert.ok(requestBodies.every((body) => body.messages[1].content.includes('"floor"')));
    assert.ok(requestBodies.every((body) => !body.messages[1].content.includes('"geometry"')));
    assert.ok(requestBodies.every((body) => !body.messages[1].content.includes("#888888")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("iterative command adjustment streams each model round into a separate visible channel", async () => {
  const replies = [
    'object.patch id=floor partial={"material":{"color":"#336699"}}\n# continue',
    "# done"
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock.fn(async () => sseResponse(replies.shift() || "# done"));
  const streamed = [];
  try {
    const result = await runAiAdjustTurn({
      userPrompt: "change the floor color",
      envelope: "change the floor color",
      targetSceneJsonString: SCENE,
      providerOptions: { apiKey: "test-key", provider: "deepseek" },
      agentOptions: { maxRefineRounds: 4 },
      updateOutputMode: "commands",
      capabilityLookup: false,
      resolveContextPayload: () => ({ objectList: [{ threeJsonId: "floor", objType: "box" }] }),
      applyCommands: async () => ({ ok: true, sceneMutated: true }),
      refreshContext: async () => ({
        currentSceneJsonString: CHANGED_SCENE,
        objectList: [{ threeJsonId: "floor", objType: "box" }]
      }),
      onDelta: (delta, metadata) => streamed.push({ delta, metadata })
    });

    assert.equal(result.stage, "commands");
    assert.equal(streamed.length, 2);
    assert.equal(streamed[0].metadata.stage, "adjust_refinement");
    assert.equal(streamed[0].metadata.outputMode, "commands");
    assert.equal(streamed[0].metadata.reset, true);
    assert.equal(streamed[1].metadata.reset, true);
    assert.notEqual(streamed[0].metadata.streamId, streamed[1].metadata.streamId);
    assert.match(streamed[0].delta, /object\.patch/);
    assert.equal(streamed[1].delta, "# done");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("strict JSON Patch and full JSON adjustments expose correctly typed stream metadata", async () => {
  const cases = [
    {
      updateOutputMode: "json-incremental",
      content: JSON.stringify([{ op: "replace", path: "/objectList/0/material/color", value: "#336699" }]),
      expectedStage: "json-incremental",
      expectedStreamStage: "adjust_json_patch",
      expectedOutputMode: "patch"
    },
    {
      updateOutputMode: "json-full",
      content: CHANGED_SCENE,
      expectedStage: "json-full",
      expectedStreamStage: "adjust_full_json",
      expectedOutputMode: "json"
    }
  ];

  for (const entry of cases) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async () => sseResponse(entry.content));
    const streamed = [];
    try {
      const result = await runAiAdjustTurn({
        userPrompt: "change the floor color",
        envelope: "change the floor color",
        targetSceneJsonString: SCENE,
        providerOptions: { apiKey: "test-key", provider: "deepseek" },
        updateOutputMode: entry.updateOutputMode,
        strictOutputMode: true,
        onDelta: (delta, metadata) => streamed.push({ delta, metadata })
      });
      assert.equal(result.stage, entry.expectedStage);
      assert.equal(streamed.map((item) => item.delta).join(""), entry.content);
      assert.equal(streamed[0].metadata.stage, entry.expectedStreamStage);
      assert.equal(streamed[0].metadata.outputMode, entry.expectedOutputMode);
      assert.equal(streamed[0].metadata.reset, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
});

test("runAiAdjustTurn rejects a false command success and falls back to a verified JSON Patch", async () => {
  const replies = [
    'object.patch id=floor partial={"material":{"color":"#ff0000"}}',
    JSON.stringify([{ op: "replace", path: "/objectList/0/material/color", value: "#ff0000" }])
  ];
  const fetchMock = mock.fn(async () => ({
    ok: true,
    async text() { return ""; },
    async json() { return { choices: [{ message: { content: replies.shift() || "# done" } }] }; }
  }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runAiAdjustTurn({
      userPrompt: "turn it red",
      envelope: "turn it red",
      targetSceneJsonString: SCENE,
      providerOptions: { apiKey: "test-key", provider: "deepseek" },
      agentOptions: { maxRefineRounds: 1 },
      updateOutputMode: "commands",
      resolveContextPayload: () => ({ objectList: [{ threeJsonId: "floor", objType: "box" }] }),
      applyCommands: async () => ({ ok: true, sceneMutated: true }),
      // Reproduce the original bug: command execution says ok, but the authoritative export did
      // not change because a different canvas was mutated.
      refreshContext: async () => ({
        currentSceneJsonString: SCENE,
        objectList: [{ threeJsonId: "floor", objType: "box" }]
      })
    });

    assert.equal(result.stage, "json-incremental");
    assert.equal(result.sceneJson.objectList[0].material.color, "#ff0000");
    assert.equal(result.agentResult.stopReason, "json_patch_fallback");
    assert.equal(fetchMock.mock.calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

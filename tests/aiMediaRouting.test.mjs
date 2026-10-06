import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { classifyTurnIntent } from "../core/ai/sceneChatSession.js";
import { classifyAiTurnIntent } from "../tools/scene-host/shared/js/aiTurnOrchestrator.js";
import { prepareAiMediaTurn } from "../tools/scene-host/shared/js/aiMediaRouting.js";
import { prepareAiMediaTurn as packagedPrepare } from "../packages/host-kit/js/aiMediaRouting.js";
import { resolveSceneAgentRoute, createUnsuccessfulTurnRecord } from "../packages/scene-agent-kit/js/turnState.js";
import { loadHostLocaleCatalog } from "../tools/scene-host/shared/i18n/index.js";
import { loadHostLocaleCatalog as loadPackagedLocale } from "../packages/host-kit/i18n/index.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const provider = { provider: "chatgpt", apiKey: "test", negotiateOutputKind: true };
function reply(value, inspect = () => {}) {
  globalThis.fetch = async (_url, init) => {
    inspect(JSON.parse(init.body));
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(value) } }] }) };
  };
}

test("the existing AI negotiation decides output type, including direct mode and natural medium requests", async () => {
  for (const [prompt, kind] of [["用视频科普一下双缝干涉实验", "video"], ["Explain this through a film", "video"], ["给房间放一个电视播放视频", "scene"]]) {
    let calls = 0;
    reply({ outputKind: kind }, body => { calls++; assert.match(body.messages[0].content, /outputKind/); });
    const result = await classifyAiTurnIntent({ userPrompt: prompt, history: [] }, { ...provider, sceneGenerationMode: "direct" });
    assert.equal(calls, 1); assert.equal(result.outputKind, kind); assert.equal(result.classificationFailed, false);
  }
});

test("medium is not inferred from prompt keywords or substituted when AI output is malformed", async () => {
  reply({ outputKind: "scene" });
  const result = await classifyTurnIntent({ userPrompt: "把标题改成‘生成视频’" }, provider);
  assert.equal(result.outputKind, "scene");
  reply({ outputKind: "unsupported" });
  const failed = await classifyTurnIntent({ userPrompt: "生成视频" }, provider);
  assert.equal(failed.classificationFailed, true);
  assert.throws(() => resolveSceneAgentRoute(failed, []), { code: "SCENE_AGENT_INTENT_CLASSIFICATION_FAILED" });
  await assert.rejects(prepareAiMediaTurn({ userPrompt: "生成视频", providerOptions: provider }, "generate"), { code: "AI_OUTPUT_KIND_REQUIRED" });
});

test("the AI receives prior media types and explicit host output choices win", async () => {
  reply({ intent: "adjust", targetTurnId: "film", outputKind: "scene" }, body => {
    assert.match(body.messages[1].content, /"outputKind":\s*"video"/);
  });
  const result = await classifyTurnIntent({ userPrompt: "继续", history: [{ turnId: "film", outputKind: "video" }] }, { ...provider, outputKind: "video" });
  assert.equal(result.outputKind, "video"); assert.equal(result.targetTurnId, "film");
});

test("both host routes announce before authoring, honor Stop and reuse an existing decision without another request", async () => {
  await loadHostLocaleCatalog("en-US"); await loadPackagedLocale("en-US");
  globalThis.fetch = () => { throw new Error("No classification needed"); };
  for (const prepare of [prepareAiMediaTurn, packagedPrepare]) {
    const controller = new AbortController(); let notices = 0;
    await assert.rejects(prepare({ userPrompt: "anything", outputKind: "video", signal: controller.signal,
      onOutputKind: async ({ outputKind, message }) => {
        notices++; assert.equal(outputKind, "video"); assert.match(message, /video|视频/); controller.abort();
      }
    }, "generate"), { name: "AbortError" });
    assert.equal(notices, 1);
    const continued = await prepare({ userPrompt: "继续细化", targetSceneJsonString: '{"documentType":"composition"}' }, "adjust");
    assert.equal(continued.outputKind, "video");
  }
});

test("failed turn records retain the negotiated medium for history retry", () => {
  assert.equal(createUnsuccessfulTurnRecord({ id: "failed-video", mode: "generate", outputKind: "video" }).outputKind, "video");
});

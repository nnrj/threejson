import assert from "node:assert/strict";
import test from "node:test";

import {
  SCENE_AGENT_SETTINGS_DEFAULTS,
  normalizeSceneAgentSettings,
  resolveSceneAgentOptions,
  resolveSceneAgentTokenOptions
} from "@threejson/scene-agent-kit/settings";
import {
  createUnsuccessfulTurnRecord,
  isSceneContextTurn,
  resolveSceneAgentRoute
} from "@threejson/scene-agent-kit/turn-state";
import {
  buildSceneAgentTurnEnvelope,
  createSceneAgentTurnContext,
  projectSceneAgentJsonString
} from "@threejson/scene-agent-kit/controller";
import {
  createSceneAgentRepository,
  createTurnId
} from "@threejson/scene-agent-kit/repository";

test("scene-agent defaults use automatic construction and no engine-owned token ceiling", () => {
  assert.equal(SCENE_AGENT_SETTINGS_DEFAULTS.ai.sceneGenerationMode, "auto");
  assert.equal(SCENE_AGENT_SETTINGS_DEFAULTS.ai.sceneMaxOutputTokens, 0);
  assert.equal(SCENE_AGENT_SETTINGS_DEFAULTS.ai.texturePipelineEnabled, true);
  assert.deepEqual(resolveSceneAgentTokenOptions({ ai: { sceneMaxOutputTokens: 0 } }), {});
  assert.deepEqual(resolveSceneAgentTokenOptions({ ai: { sceneMaxOutputTokens: 12000 } }), { maxTokens: 12000 });
  assert.deepEqual(resolveSceneAgentOptions({ ai: { maxAutoRefineRounds: 4 } }), { maxRefineRounds: 4 });
});

test("scene-agent settings normalize enums and safety budgets without carrying a legacy root agent section", () => {
  const normalized = normalizeSceneAgentSettings({
    ai: { sceneGenerationMode: "invalid", maxAutoRefineRounds: 999, agentDepth: "deep" },
    agent: { enabled: true, depth: "deep" }
  });
  assert.equal(normalized.ai.sceneGenerationMode, "auto");
  assert.equal(normalized.ai.maxAutoRefineRounds, 20);
  assert.equal(Object.hasOwn(normalized, "agent"), false);
  assert.equal(Object.hasOwn(normalized.ai, "agentDepth"), false);
});

test("first-turn routing is generation even if a classifier claims adjustment", () => {
  assert.deepEqual(
    resolveSceneAgentRoute({ intent: "adjust", targetTurnId: "missing" }, []),
    { intent: "generate", targetTurnId: null }
  );
});

test("follow-up routing targets a valid scene and ignores failed turns", () => {
  const turns = [
    { id: "base", sceneJson: "{}" },
    createUnsuccessfulTurnRecord({
      id: "failed",
      conversationId: "c1",
      userPrompt: "bad adjustment",
      mode: "adjust",
      targetTurnId: "base"
    }),
    { id: "latest", commands: [{ op: "object.set" }] }
  ];
  assert.equal(isSceneContextTurn(turns[1]), false);
  assert.deepEqual(
    resolveSceneAgentRoute({ intent: "adjust", targetTurnId: "base" }, turns),
    { intent: "adjust", targetTurnId: "base" }
  );
  assert.deepEqual(
    resolveSceneAgentRoute({ intent: "adjust", targetTurnId: "unknown" }, turns),
    { intent: "adjust", targetTurnId: "latest" }
  );
});

test("generic controller exposes product-neutral context, envelope, and projection APIs", () => {
  const context = createSceneAgentTurnContext("turn-1", "create a cube");
  assert.equal(context.turnId, "turn-1");
  assert.equal(context.originalPrompt, "create a cube");

  const envelope = buildSceneAgentTurnEnvelope({
    userPrompt: "make it blue",
    intent: "adjust",
    targetTurnId: "turn-1",
    contextPayload: { sceneJson: "{}" }
  });
  assert.match(envelope, /make it blue/);
  assert.match(envelope, /turn-1/);

  const scene = JSON.stringify({ name: "minimal", objectList: [{ objType: "scene", background: "#000000" }] });
  assert.equal(JSON.parse(projectSceneAgentJsonString(scene, "standard")).name, "minimal");
});

test("repository namespaces are injected and unavailable IndexedDB performs no fallback writes", async () => {
  assert.throws(() => createSceneAgentRepository(), /non-empty dbName/);
  const repository = createSceneAgentRepository({ dbName: "test-scene-agent", indexedDb: null });
  assert.equal(repository.dbName, "test-scene-agent");
  assert.equal(repository.available(), false);
  await assert.rejects(() => repository.putTurn({ id: createTurnId() }), /IndexedDB is unavailable/);
});

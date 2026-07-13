import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { isAiSceneUpdateCommandOp } from "../core/ai/sceneCommandSkill.js";
import { requestUpdatedSceneEditCommands } from "../core/ai/sceneAiService.js";

test("isAiSceneUpdateCommandOp accepts material.patch", () => {
  assert.equal(isAiSceneUpdateCommandOp("material.patch"), true);
  assert.equal(isAiSceneUpdateCommandOp("object.patch"), true);
  assert.equal(isAiSceneUpdateCommandOp("editor.exec"), false);
});

test("requestUpdatedSceneEditCommands keeps material.patch in commands mode", async () => {
  const script = 'material.patch id=floor partial={"color":"#336699"}';
  const fetchMock = mock.fn(async () => ({
    ok: true,
    async text() {
      return "";
    },
    async json() {
      return { choices: [{ message: { content: script } }] };
    }
  }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await requestUpdatedSceneEditCommands(
      "change floor color",
      { objectList: [{ threeJsonId: "floor", objType: "box" }] },
      {
        outputMode: "commands",
        fallbackToJson: false,
        apiKey: "test-key",
        provider: "deepseek"
      }
    );
    assert.equal(result.outputMode, "commands");
    assert.equal(result.commands.length, 1);
    assert.equal(result.commands[0].op, "material.patch");
    assert.equal(result.commands[0].args.id, "floor");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("requestUpdatedSceneEditCommands accepts full scene JSON on an agent round even in commands outputMode", async () => {
  // Regression test: agent/iterative rounds are always given the "auto" system prompt (commands
  // preferred, full JSON allowed "when restructuring many objects" — see
  // buildSceneCommandAutoUpdateSystemPrompt), regardless of the caller's requested outputMode.
  // ThreeBox's "commands" setting never becomes literal outputMode:"auto", so a model that follows
  // its own prompt's advice and returns valid scene JSON used to get rejected here as "not a valid
  // command script" with no fallback (agent calls always pass fallbackToJson:false) — the whole
  // agent turn then failed after burning through every repair round on a response that was never
  // actually invalid.
  const scene = JSON.stringify({
    threeJsonId: "agent-round-json-response",
    worldInfo: {
      boxModelList: [
        {
          name: "floor",
          objType: "box",
          geometry: { width: 10, height: 0.2, depth: 10 },
          position: { x: 0, y: 0, z: 0 },
          material: { type: "standard", color: "#888888" }
        }
      ]
    }
  });
  const fetchMock = mock.fn(async () => ({
    ok: true,
    async text() {
      return "";
    },
    async json() {
      return { choices: [{ message: { content: scene } }] };
    }
  }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await requestUpdatedSceneEditCommands(
      "rebuild the whole room",
      { objectList: [{ threeJsonId: "floor", objType: "box" }] },
      {
        outputMode: "commands",
        agentRound: true,
        fallbackToJson: false,
        apiKey: "test-key",
        provider: "deepseek"
      }
    );
    assert.equal(result.outputMode, "json");
    assert.ok(result.sceneJsonString.includes("worldInfo"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

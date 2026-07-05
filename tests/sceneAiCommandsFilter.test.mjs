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

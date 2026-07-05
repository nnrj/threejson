import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { runEditorAiUpdate } from "../tools/common/editor-single/ai/runEditorAiUpdate.js";

const MINIMAL_SCENE = {
  threeJsonId: "agent-test",
  worldInfo: {
    boxModelList: [
      {
        name: "floor",
        threeJsonId: "floor",
        objType: "box",
        geometry: { width: 10, height: 0.2, depth: 10 },
        position: { x: 0, y: 0, z: 0 },
        material: { type: "standard", color: "#888888" }
      }
    ]
  }
};

test("runEditorAiUpdate iterative agent skips duplicate final exec", async () => {
  const currentJson = JSON.stringify(MINIMAL_SCENE);
  let fetchCall = 0;
  let execCount = 0;
  const fetchMock = mock.fn(async () => {
    fetchCall += 1;
    const content =
      fetchCall === 1
        ? 'object.patch id=floor partial={"material":{"color":"#445566"}}'
        : "# done";
    return {
      ok: true,
      async text() {
        return "";
      },
      async json() {
        return { choices: [{ message: { content } }] };
      }
    };
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    let refreshCount = 0;
    const editorApi = {
      getCommandContext() {
        return { documentJson: currentJson };
      },
      getSelection() {
        return null;
      },
      async execCoreCommands(commands, options = {}) {
        execCount += 1;
        return {
          ok: true,
          results: [{ op: commands[0]?.op || "object.patch", ok: true }]
        };
      }
    };
    const result = await runEditorAiUpdate({
      prompt: "change floor color",
      editorApi,
      fullSceneJson: currentJson,
      getCurrentSceneJson: async () => {
        refreshCount += 1;
        return currentJson;
      },
      outputMode: "commands",
      agentEnabled: true,
      agentOptions: { enabled: true, depth: "simple", iterativeApply: true },
      aiOptions: { apiKey: "test-key", provider: "deepseek" }
    });
    assert.equal(result.skipFinalExec, true);
    assert.equal(result.iterativeApplied, true);
    assert.equal(result.execOk, true);
    assert.equal(execCount, 1);
    assert.ok(refreshCount >= 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

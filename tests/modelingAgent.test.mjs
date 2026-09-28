import assert from "node:assert/strict";
import { test } from "node:test";
import { createRuntimeSceneSession, executeSceneSessionCommands, captureSceneSession } from "../core/session.js";
import { runSceneAgent } from "../core/ai/sceneAgent.js";
import { formatObjectGetFeedbackFromBatch } from "../core/ai/sceneCommandSkill.js";
import { getObjectByThreeJsonId } from "../core/handler/objectRegistry.js";

test("agent queries a graph, receives its revision, then commits a local model.patch without coordinate replay", async () => {
  const payload = { objectList: [{ threeJsonId: "m", objType: "modeledMesh", modeling: { version: 1, parameters: { width: 2 },
    nodes: [{ id: "body", operator: "primitive.box", params: { width: { param: "width" } } }], output: { node: "body", output: "mesh" } } }] };
  const session = await createRuntimeSceneSession(payload), originalFetch = globalThis.fetch;
  const replies = ["- Inspect the current graph revision, then widen its width parameter.", "model.inspect id=m",
    'model.patch id=m baseRevision=0 patch=[{"op":"replace","path":"/parameters/width","value":4}]\n# done'];
  const requests = [], changes = [];
  globalThis.fetch = async (_, init) => {
    requests.push(JSON.parse(init.body));
    return { ok: true, text: async () => "", json: async () => ({ choices: [{ message: { content: replies.shift() || "# done" } }] }) };
  };
  const snapshot = () => JSON.stringify(captureSceneSession(session));
  try {
    const result = await runSceneAgent({ mode: "update", prompt: "Widen the modeledMesh parameter to 4", currentSceneJsonString: snapshot(), outputMode: "commands",
      updateContext: { objectList: [{ threeJsonId: "m", objType: "modeledMesh" }] } }, {
      apiKey: "test-key", provider: "deepseek", generationStrategy: "segmented", selectedCapabilityIds: ["modelingGraph"],
      applyCommands: async (commands) => {
        const batch = await executeSceneSessionCommands(session, commands); changes.push(batch.sceneMutated);
        return { ...batch, sceneJsonString: snapshot(), objectGetFeedback: formatObjectGetFeedbackFromBatch(batch.results) };
      }, refreshContext: async () => ({ currentSceneJsonString: snapshot(), objectList: [] })
    });
    assert.equal(result.completed, true); assert.deepEqual(changes, [false, true]); assert.equal(requests.length, 3);
    const feedback = JSON.stringify(requests.at(-1).messages);
    assert.match(feedback, /model\.inspect/); assert.match(feedback, /revision/); assert.match(feedback, /model\.patch/);
    assert.match(feedback, /primitive\.box/); assert.doesNotMatch(feedback, /Float32Array|"index"\s*:\s*\{/);
    assert.equal(getObjectByThreeJsonId("m", session.runtime.scene).geometry.boundingBox.max.x, 2);
    assert.equal(session.document.root.objectList[0].modeling.parameters.width, 4);
    await session.undo(); assert.equal(session.document.root.objectList[0].modeling.parameters.width, 2);
  } finally { globalThis.fetch = originalFetch; session.dispose(); }
});

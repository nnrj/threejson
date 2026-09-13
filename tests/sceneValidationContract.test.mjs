import test from "node:test";
import assert from "node:assert/strict";
import { validateSceneJson } from "../core/handler/sceneJsonValidate.js";
import { validateSceneJsonWithNormalizer, summarizeSchema } from "../core/ai/agentTools.js";

test("structural validation accepts friendly lists without requiring a box list", async () => {
  const source = JSON.stringify({ worldInfo: { sphereModelList: [{ threeJsonId: "sphere", geometry: { radius: 2 } }] } });
  assert.equal(validateSceneJson(source).ok, true);
  assert.equal((await validateSceneJsonWithNormalizer(source)).ok, true);
});
test("normalizer errors remain errors and capability schema is not silently shortened", async () => {
  const bad = await validateSceneJsonWithNormalizer('{"objectList":');
  assert.equal(bad.ok, false); assert.equal(bad.engineAligned, true); assert.ok(bad.error);
  const full = summarizeSchema(); assert.ok(full.length > 4200); assert.ok(!full.endsWith("...(truncated)"));
  assert.ok(summarizeSchema(500).endsWith("...(truncated)"));
});

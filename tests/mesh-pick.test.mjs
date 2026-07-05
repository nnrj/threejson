import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldUseMeshBvhPick } from "../core/util/meshPick.js";

test("shouldUseMeshBvhPick respects sceneConfig.pick.meshBvh", () => {
  assert.equal(shouldUseMeshBvhPick({ pick: { meshBvh: true } }, null), true);
  assert.equal(shouldUseMeshBvhPick({ pick: { meshBvh: false } }, null), false);
});

test("shouldUseMeshBvhPick respects objJson.pick.precision", () => {
  assert.equal(shouldUseMeshBvhPick(null, { pick: { precision: "bvh" } }), true);
  assert.equal(shouldUseMeshBvhPick(null, { pick: { precision: "meshBvh" } }), true);
  assert.equal(shouldUseMeshBvhPick(null, { pick: { precision: "raycaster" } }), false);
});

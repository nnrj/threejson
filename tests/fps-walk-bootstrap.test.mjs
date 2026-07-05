import { test } from "node:test";
import assert from "node:assert/strict";
import { bootstrapFpsWalkFromScene } from "../extensions/fps-walk/bootstrapFromScene.js";

test("bootstrapFpsWalkFromScene skips non-firstPerson controls", () => {
  const result = bootstrapFpsWalkFromScene({
    controls: { threeJsonControlsKind: "orbit" },
    sceneJson: { sceneConfig: { extensions: { "fps-walk": { floorMeshRef: "floor" } } } }
  });
  assert.equal(result, null);
});

test("bootstrapFpsWalkFromScene returns null when extension disabled", () => {
  const controls = {
    threeJsonControlsKind: "firstPerson",
    eyeHeight: 1.6,
    floorSnap: true,
    setCollisionProvider() {}
  };
  const result = bootstrapFpsWalkFromScene({
    controls,
    sceneJson: {
      sceneConfig: {
        extensions: { "fps-walk": { enabled: false, floorMeshRef: "floor" } }
      }
    }
  });
  assert.equal(result, null);
});

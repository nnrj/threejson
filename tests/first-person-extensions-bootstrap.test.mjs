import { test } from "node:test";
import assert from "node:assert/strict";
import { bootstrapFirstPersonExtensionsFromScene } from "../extensions/fps-walk/bootstrapFirstPersonExtensions.js";

test("bootstrapFirstPersonExtensionsFromScene skips non-firstPerson", async () => {
  const out = await bootstrapFirstPersonExtensionsFromScene({
    controls: { threeJsonControlsKind: "orbit" }
  });
  assert.equal(out.fpsWalk, null);
  assert.equal(out.rapier, null);
});

test("bootstrapFirstPersonExtensionsFromScene uses fps-walk when provider not rapier", async () => {
  const controls = {
    threeJsonControlsKind: "firstPerson",
    eyeHeight: 1.6,
    floorSnap: true,
    setCollisionProvider() {}
  };
  const out = await bootstrapFirstPersonExtensionsFromScene({
    controls,
    sceneJson: {
      sceneConfig: {
        extensions: {
          "fps-walk": { floorMeshRef: "floor" }
        }
      }
    }
  });
  assert.equal(out.rapier, null);
});

test("bootstrapFirstPersonExtensionsFromScene warns without RAPIER for rapier provider", async () => {
  const controls = {
    threeJsonControlsKind: "firstPerson",
    setCollisionProvider() {}
  };
  const out = await bootstrapFirstPersonExtensionsFromScene({
    controls,
    controlsConfig: {
      collision: { enabled: true, provider: "rapier" }
    }
  });
  assert.equal(out.rapier, null);
});

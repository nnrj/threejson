import test from "node:test";
import assert from "node:assert/strict";

import { createJsonScene } from "../core/handler/sceneLoadHandler.js";
import { getObjectByThreeJsonId } from "../core/handler/objectRegistry.js";

function boxPayload(threeJsonId) {
  return {
    worldInfo: {
      boxModelList: [
        {
          name: "shared-box",
          objType: "box",
          threeJsonId,
          geometry: { width: 1, height: 1, depth: 1 },
          position: { x: 0, y: 0, z: 0 },
          material: { type: "standard", color: "#ffffff" }
        }
      ]
    }
  };
}

test("two concurrently-created scenes with the same threeJsonId stay isolated end-to-end", async () => {
  const [runtimeA, runtimeB] = await Promise.all([
    createJsonScene(boxPayload("shared-box-1")),
    createJsonScene(boxPayload("shared-box-1"))
  ]);

  assert.ok(runtimeA.runtimeContext, "createJsonScene should attach a runtimeContext");
  assert.ok(runtimeB.runtimeContext, "createJsonScene should attach a runtimeContext");
  assert.notEqual(
    runtimeA.runtimeContext,
    runtimeB.runtimeContext,
    "each createJsonScene call must get its own RuntimeContext"
  );

  const objA = getObjectByThreeJsonId("shared-box-1", runtimeA.scene);
  const objB = getObjectByThreeJsonId("shared-box-1", runtimeB.scene);
  assert.ok(objA, "scene A should resolve its own object for the shared id");
  assert.ok(objB, "scene B should resolve its own object for the shared id");
  assert.notEqual(objA, objB, "the two scenes must not share the same object instance");
  assert.equal(objA.parent, runtimeA.scene);
  assert.equal(objB.parent, runtimeB.scene);

  runtimeA.dispose();

  const objBAfterDisposeA = getObjectByThreeJsonId("shared-box-1", runtimeB.scene);
  assert.equal(
    objBAfterDisposeA,
    objB,
    "disposing scene A must not affect scene B's object registry"
  );

  runtimeB.dispose();
});

test("scene B loading concurrently does not cancel scene A's scheduled deploy", async () => {
  const heavyBoxList = Array.from({ length: 6 }, (_, i) => ({
    name: `heavy-${i}`,
    objType: "box",
    threeJsonId: `heavy-box-${i}`,
    geometry: { width: 1, height: 1, depth: 1 },
    position: { x: i, y: 0, z: 0 },
    material: { type: "standard", color: "#ffffff" }
  }));

  const payloadA = {
    worldInfo: {
      sceneConfig: {
        deployScheduler: { enabled: true, policy: "timeslot", fluxMs: 30, density: 1 }
      },
      boxModelList: heavyBoxList
    }
  };

  const runA = createJsonScene(payloadA);
  const runtimeB = await createJsonScene(boxPayload("shared-box-2"));

  const runtimeA = await runA;
  const countA = runtimeA.scene.children.filter((c) => c.userData?.objJson?.threeJsonId?.startsWith("heavy-box-")).length;
  assert.equal(countA, heavyBoxList.length, "scene A's scheduled deploy should complete fully, uninterrupted by scene B loading concurrently");

  runtimeA.dispose();
  runtimeB.dispose();
});

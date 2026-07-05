import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import {
  createCommandContext,
  createCommandRegistry,
  executeCommand,
  executeCommands
} from "../core/command/index.js";
import { createJsonSceneSimple } from "../core/handler/sceneLoadHandler.js";
import { clearObjectRegistry } from "../core/handler/objectRegistry.js";

function buildSceneWithBox() {
  return createJsonSceneSimple({
    worldInfo: {
      boxModelList: [
        {
          name: "fit-box",
          objType: "box",
          threeJsonId: "fit-box-1",
          geometry: { width: 2, height: 2, depth: 2 },
          position: { x: 5, y: 0, z: 0 },
          material: { type: "standard", color: "#336699" }
        }
      ]
    },
    sceneConfig: {
      camera: {
        fov: 60,
        near: 0.1,
        far: 1000,
        position: { x: 0, y: 0, z: 0 }
      }
    }
  });
}

test("camera.fit scene target adjusts camera position", async () => {
  clearObjectRegistry();
  const deployed = buildSceneWithBox();
  const camera = deployed.camera;
  const controls = {
    target: new THREE.Vector3(),
    minDistance: 1,
    maxDistance: 1000,
    update: () => {}
  };
  const beforeY = camera.position.y;
  const ctx = createCommandContext({
    scene: deployed.scene,
    camera,
    controls
  });
  const registry = createCommandRegistry();
  const res = await executeCommand(ctx, { op: "camera.fit", args: { target: "scene" } }, { registry });
  assert.equal(res.ok, true);
  assert.notEqual(camera.position.y, beforeY);
  clearObjectRegistry();
});

test("camera.fit id target fits to specific object", async () => {
  clearObjectRegistry();
  const deployed = buildSceneWithBox();
  const camera = deployed.camera;
  const controls = {
    target: new THREE.Vector3(),
    minDistance: 1,
    maxDistance: 1000,
    update: () => {}
  };
  const ctx = createCommandContext({
    scene: deployed.scene,
    camera,
    controls
  });
  const registry = createCommandRegistry();
  const res = await executeCommand(
    ctx,
    { op: "camera.fit", args: { target: "id", id: "fit-box-1" } },
    { registry }
  );
  assert.equal(res.ok, true);
  assert.equal(res.data.threeJsonId, "fit-box-1");
  clearObjectRegistry();
});

test("executeCommands auto mode skips runtime ops without scene", async () => {
  const ctx = createCommandContext({
    document: { objectList: [{ objType: "box", name: "a" }] }
  });
  const batch = await executeCommands(
    ctx,
    [
      { op: "scene.validate", args: { json: ctx.document } },
      { op: "object.patch", args: { id: "x", partial: { position: { x: 1 } } } }
    ],
    { executeMode: "auto" }
  );
  assert.equal(batch.ok, true);
  assert.equal(batch.results[0].ok, true);
  assert.equal(batch.results[1].ok, true);
  assert.equal(batch.results[1].data?.skipped, true);
});

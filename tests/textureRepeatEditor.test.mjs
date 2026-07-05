import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import { applyTextureRepeatToMap } from "../core/util/loadTextureFromMaterialJson.js";
import { applyObjectPartial, applyObjectChange } from "../core/runtime/objectMutation/index.js";
import { clearObjectRegistry, registerObject, unregisterObject } from "../core/handler/objectRegistry.js";

function createMockTexture(repeatX = 1, repeatY = 1) {
  const repeat = {
    x: repeatX,
    y: repeatY,
    set(x, y) {
      this.x = x;
      this.y = y;
    }
  };
  return {
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    repeat,
    dispose: () => {}
  };
}

function createTexturedRegisteredMesh(threeJsonId = "repeat-1") {
  const textureUrl = "/assets/textures/test.png";
  const map = createMockTexture(4, 8);
  map.userData = { threeJsonResolvedUrl: textureUrl };
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xffffff, map })
  );
  mesh.userData = {
    objJson: {
      threeJsonId,
      name: "box",
      position: { x: 0, y: 0, z: 0 },
      rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
      scale: { scaleX: 1, scaleY: 1, scaleZ: 1 },
      material: {
        color: "#ffffff",
        textureUrl,
        textureRepeat: { x: 4, y: 8 }
      }
    }
  };
  registerObject(mesh, mesh.userData.objJson, { recursive: false });
  return mesh;
}

test("applyTextureRepeatToMap sets repeat from materialJson", () => {
  const texture = createMockTexture();
  applyTextureRepeatToMap(texture, { textureRepeat: { x: 3.5, y: 2 } });
  assert.equal(texture.repeat.x, 3.5);
  assert.equal(texture.repeat.y, 2);
  assert.equal(texture.wrapS, THREE.RepeatWrapping);
  assert.equal(texture.wrapT, THREE.RepeatWrapping);
});

test("applyObjectPartial transform undo keeps existing map repeat without reload", () => {
  clearObjectRegistry();
  const mesh = createTexturedRegisteredMesh("repeat-partial");
  const originalMap = mesh.material.map;

  const res = applyObjectPartial("repeat-partial", {
    position: { x: 2, y: 0, z: 0 }
  });
  assert.equal(res.ok, true);
  assert.equal(mesh.position.x, 2);
  assert.equal(mesh.material.map, originalMap);
  assert.equal(mesh.material.map.repeat.x, 4);
  assert.equal(mesh.material.map.repeat.y, 8);

  const undo = applyObjectPartial("repeat-partial", {
    position: { x: 0, y: 0, z: 0 }
  });
  assert.equal(undo.ok, true);
  assert.equal(mesh.material.map, originalMap);
  assert.equal(mesh.material.map.repeat.x, 4);
  assert.equal(mesh.material.map.repeat.y, 8);

  unregisterObject(mesh, { recursive: false });
  clearObjectRegistry();
});

test("applyObjectChange updates textureRepeat on existing map", () => {
  clearObjectRegistry();
  const mesh = createTexturedRegisteredMesh("repeat-change");
  const originalMap = mesh.material.map;

  const res = applyObjectChange("repeat-change", "material.textureRepeat", { x: 6, y: 3 }, {
    createMissing: true
  });
  assert.equal(res.ok, true);
  assert.equal(mesh.material.map, originalMap);
  assert.equal(mesh.material.map.repeat.x, 6);
  assert.equal(mesh.material.map.repeat.y, 3);
  assert.deepEqual(mesh.userData.objJson.material.textureRepeat, { x: 6, y: 3 });

  unregisterObject(mesh, { recursive: false });
  clearObjectRegistry();
});

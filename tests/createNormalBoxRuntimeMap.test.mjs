import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import { createNormalBox } from "../core/builder/modelBuilder.js";

test("createNormalBox binds runtime Texture across cloneJson", () => {
  const runtimeMap = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  runtimeMap.needsUpdate = true;
  const boxObj = {
    name: "stat-bar",
    geometry: { width: 6, height: 20, depth: 12 },
    material: {
      type: "standard",
      color: "#3A8798",
      transparent: true,
      opacity: 0.85,
      map: runtimeMap
    },
    position: { x: 0, y: 10, z: 0 }
  };
  const mesh = createNormalBox(boxObj);
  assert.ok(mesh?.isMesh);
  const mat = mesh.material;
  assert.equal(mat.map, runtimeMap);
});

test("createNormalBox ignores non-texture map placeholders", () => {
  const boxObj = {
    geometry: { width: 1, height: 1, depth: 1 },
    material: {
      type: "standard",
      color: "#ffffff",
      map: "/assets/textures/foo.png"
    }
  };
  const mesh = createNormalBox(boxObj);
  assert.ok(mesh?.isMesh);
  assert.equal(mesh.material.map, null);
});

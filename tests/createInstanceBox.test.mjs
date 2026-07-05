import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import { createInstanceBox } from "../core/builder/modelBuilder.js";

test("createInstanceBox: uniform faces returns InstancedMesh with cloned userData.objJson", () => {
  const record = {
    name: "inst-uniform",
    threeJsonId: "tj-inst-1",
    geometry: { width: 2, height: 2, depth: 2 },
    material: { type: "standard", color: "#ffffff", textureUrl: "/tex.png" },
    transforms: [
      { position: { x: 0, y: 0, z: 0 }, rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 }, scale: { scaleX: 1, scaleY: 1, scaleZ: 1 } },
      { position: { x: 5, y: 0, z: 0 }, rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 }, scale: { scaleX: 1, scaleY: 1, scaleZ: 1 } }
    ]
  };
  const mesh = createInstanceBox(record, { applyTexturesFromJson: false });
  assert.ok(mesh instanceof THREE.InstancedMesh);
  assert.equal(mesh.count, 2);
  const stored = mesh.userData?.objJson;
  assert.ok(stored && typeof stored === "object");
  assert.notEqual(stored, record);
  assert.equal(stored.threeJsonId, "tj-inst-1");
  record.material.color = "#000000";
  assert.notEqual(stored.material.color, "#000000");
});

test("createInstanceBox: non-uniform six-face materials falls back to Group", () => {
  const record = {
    name: "inst-mixed-faces",
    geometry: { width: 1, height: 1, depth: 1 },
    materials: [
      { type: "standard", color: "#ff0000" },
      { type: "standard", color: "#00ff00" },
      { type: "standard", color: "#0000ff" },
      { type: "standard", color: "#ffff00" },
      { type: "standard", color: "#ff00ff" },
      { type: "standard", color: "#1AD4D4" }
    ],
    transforms: [
      { position: { x: 0, y: 0, z: 0 }, rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 }, scale: { scaleX: 1, scaleY: 1, scaleZ: 1 } }
    ]
  };
  const result = createInstanceBox(record, { applyTexturesFromJson: false });
  assert.ok(result instanceof THREE.Group);
  assert.ok(result.children.length >= 1);
});

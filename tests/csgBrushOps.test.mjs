import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import {
  createBrushFromMesh,
  evaluateMeshBoolean
} from "../core/handler/csgBrushOps.js";

function makeBoxMesh(size, position = { x: 0, y: 0, z: 0 }) {
  const geometry = new THREE.BoxGeometry(size, size, size);
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(position.x, position.y, position.z);
  mesh.updateMatrixWorld(true);
  return mesh;
}

test("createBrushFromMesh copies mesh world matrix", () => {
  const mesh = makeBoxMesh(2, { x: 3, y: 0, z: 0 });
  const brush = createBrushFromMesh(mesh);
  assert.ok(brush);
  assert.ok(Math.abs(brush.position.x - 3) < 1e-5);
});

test("evaluateMeshBoolean subtract returns brush geometry", () => {
  const master = makeBoxMesh(4);
  const slave = makeBoxMesh(2, { x: 1, y: 0, z: 0 });
  const result = evaluateMeshBoolean(master, slave, "subtract");
  assert.ok(result);
  assert.ok(result.geometry);
  assert.ok(result.geometry.attributes?.position?.count > 0);
});

test("evaluateMeshBoolean accepts legacy add/sub/inter aliases", () => {
  const a = makeBoxMesh(2);
  const b = makeBoxMesh(2, { x: 1, y: 0, z: 0 });
  assert.ok(evaluateMeshBoolean(a, b, "add"));
  assert.ok(evaluateMeshBoolean(a, b, "sub"));
  assert.ok(evaluateMeshBoolean(a, b, "inter"));
});

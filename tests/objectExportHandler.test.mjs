import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import {
  exportJsonObject,
  exportJsonObjectBatch,
  exportJsonObjectByType,
  packJsonObjectArchive
} from "../core/handler/objectExportHandler.js";
import { registerObject } from "../core/handler/objectRegistry.js";
import { parseTjzArchive } from "../core/archive/tjzParser.js";

function addBox(scene, { id, name }) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0x00ff00 })
  );
  mesh.name = name;
  const descriptor = {
    objType: "box",
    name,
    threeJsonId: id,
    geometry: { width: 1, height: 1, depth: 1 },
    position: { x: 0, y: 0, z: 0 },
    material: { type: "standard", color: "#00ff00" }
  };
  mesh.userData.objJson = descriptor;
  scene.add(mesh);
  registerObject(mesh, descriptor, { recursive: false });
  return mesh;
}

test("exportJsonObject exports descriptor by threeJsonId", () => {
  const scene = new THREE.Scene();
  addBox(scene, { id: "box-1", name: "box-1" });
  const record = exportJsonObject(scene, "box-1");
  assert.equal(record.objType, "box");
  assert.equal(record.threeJsonId, "box-1");
});

test("exportJsonObjectBatch returns per-item result", () => {
  const scene = new THREE.Scene();
  addBox(scene, { id: "box-a", name: "box-a" });
  const list = exportJsonObjectBatch(scene, ["box-a", "missing"]);
  assert.equal(list.length, 2);
  assert.equal(list[0].ok, true);
  assert.equal(list[1].ok, false);
});

test("exportJsonObjectByType resolves objects via objType index", () => {
  const scene = new THREE.Scene();
  addBox(scene, { id: "t-1", name: "t-1" });
  addBox(scene, { id: "t-2", name: "t-2" });
  const records = exportJsonObjectByType(scene, "box");
  assert.equal(records.length, 2);
});

test("packJsonObjectArchive packages single record payload", async () => {
  const scene = new THREE.Scene();
  addBox(scene, { id: "archive-1", name: "archive-1" });
  const bytes = await packJsonObjectArchive(scene, "archive-1");
  const parsed = await parseTjzArchive(bytes);
  assert.equal(parsed.payload.objType, "box");
  assert.equal(parsed.payload.threeJsonId, "archive-1");
});


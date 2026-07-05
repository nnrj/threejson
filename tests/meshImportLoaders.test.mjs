import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import {
  inferMeshImportFormatFromFileName,
  normalizeMeshImportFormat,
  parseMeshArrayBufferToObject3D,
  isBufferExternalMeshType
} from "../core/builder/meshImportLoaders.js";
import {
  buildExternalModelImportRecord,
  importMeshFromArrayBuffer
} from "../core/handler/meshImportHandler.js";

const MINIMAL_STL_ASCII = `solid test
  facet normal 0 0 1
    outer loop
      vertex 0 0 0
      vertex 1 0 0
      vertex 0 1 0
    endloop
  endfacet
endsolid test
`;

const MINIMAL_PLY_ASCII = `ply
format ascii 1.0
element vertex 3
property float x
property float y
property float z
element face 1
property list uchar int vertex_indices
end_header
0 0 0
1 0 0
0 1 0
3 0 1 2
`;

test("normalizeMeshImportFormat accepts export-symmetric formats", () => {
  assert.equal(normalizeMeshImportFormat("GLB"), "glb");
  assert.equal(normalizeMeshImportFormat("usd"), "usdz");
  assert.throws(
    () => normalizeMeshImportFormat("dae"),
    (error) => error.code === "E_MESH_IMPORT_FORMAT_INVALID"
  );
});

test("inferMeshImportFormatFromFileName reads extension", () => {
  assert.equal(inferMeshImportFormatFromFileName("assets/chair.STL"), "stl");
  assert.equal(inferMeshImportFormatFromFileName("room.usdz"), "usdz");
});

test("isBufferExternalMeshType distinguishes buffer loaders", () => {
  assert.equal(isBufferExternalMeshType("stl"), true);
  assert.equal(isBufferExternalMeshType("obj"), false);
  assert.equal(isBufferExternalMeshType("usd"), true);
});

test("parseMeshArrayBufferToObject3D parses minimal STL", async () => {
  const buffer = new TextEncoder().encode(MINIMAL_STL_ASCII).buffer;
  const object = await parseMeshArrayBufferToObject3D("stl", buffer);
  assert.ok(object);
  assert.equal(object.type, "Mesh");
  assert.ok(object.geometry);
});

test("importMeshFromArrayBuffer parses minimal PLY", async () => {
  const buffer = new TextEncoder().encode(MINIMAL_PLY_ASCII).buffer;
  const object = await importMeshFromArrayBuffer(buffer, { format: "ply" });
  assert.ok(object);
  assert.equal(object.type, "Mesh");
});

test("buildExternalModelImportRecord produces externalModel descriptor", () => {
  const record = buildExternalModelImportRecord({
    fileName: "crate.stl",
    modelPath: "blob:mock",
    name: "crate"
  });
  assert.equal(record.objType, "externalModel");
  assert.equal(record.modelFileType, "stl");
  assert.equal(record.modelPath, "blob:mock");
  assert.equal(record.name, "crate");
  assert.ok(typeof record.threeJsonId === "string" && record.threeJsonId.length > 0);
});

test("round-trip STL export then import", async () => {
  const { STLExporter } = await import("three/examples/jsm/exporters/STLExporter.js");
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.5, 0.5),
    new THREE.MeshBasicMaterial()
  );
  const exporter = new STLExporter();
  const stlText = exporter.parse(mesh);
  const imported = await parseMeshArrayBufferToObject3D("stl", stlText);
  assert.ok(imported);
  imported.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(imported);
  assert.ok(box.getSize(new THREE.Vector3()).length() > 0);
});

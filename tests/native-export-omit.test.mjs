import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import {
  estimateThreeNativeJsonPayloadChars,
  measureNativeExportSubtreeComplexity,
  omitExternalFileModelsForNativeExport,
  shouldOmitExternalModelForNativeExport
} from "../core/util/util.js";

test("measureNativeExportSubtreeComplexity counts nodes and triangles", () => {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)));
  const c = measureNativeExportSubtreeComplexity(group);
  assert.ok(c.objectCount >= 2);
  assert.equal(c.meshCount, 1);
  assert.ok(c.triangleCount >= 12);
});

test("shouldOmitExternalModelForNativeExport uses triangle threshold", () => {
  assert.equal(
    shouldOmitExternalModelForNativeExport(
      { objectCount: 10, meshCount: 2, triangleCount: 50000 },
      { maxExternalSubtreeTriangles: 40000 }
    ),
    true
  );
  assert.equal(
    shouldOmitExternalModelForNativeExport(
      { objectCount: 10, meshCount: 2, triangleCount: 12 },
      { maxExternalSubtreeTriangles: 40000 }
    ),
    false
  );
});

test("omitExternalFileModelsForNativeExport skips heavy external model", () => {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  group.name = "heavy-ship";
  group.userData.objJson = {
    name: "heavy-ship",
    modelPath: "/assets/model/obj/big.obj",
    fileType: "obj"
  };
  group.add(new THREE.Mesh(new THREE.SphereGeometry(8, 160, 160)));
  scene.add(group);

  const result = omitExternalFileModelsForNativeExport(scene);
  assert.equal(result.removedCount, 1);
  assert.equal(result.omitted[0].reason, "complexity");
  assert.ok(result.omitted[0].triangleCount > 40000);
});

test("omitExternalFileModelsForNativeExport keeps light external model", () => {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  group.name = "alpaca";
  group.userData.objJson = {
    name: "alpaca",
    modelPath: "/assets/model/obj/maps_fallback/alpaca.obj",
    fileType: "obj"
  };
  group.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)));
  scene.add(group);

  const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  box.userData.objJson = { objType: "box", name: "dock-box" };
  scene.add(box);

  const result = omitExternalFileModelsForNativeExport(scene);
  assert.equal(result.removedCount, 0);
  assert.equal(scene.children.length, 2);
});

test("estimateThreeNativeJsonPayloadChars scales with geometry arrays", () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10));
  const payload = mesh.toJSON();
  const rough = estimateThreeNativeJsonPayloadChars(payload);
  assert.ok(rough > 100);
});

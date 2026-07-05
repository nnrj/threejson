import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import {
  createJsonObject,
  createJsonObjectAuto,
  createJsonObjectBatch,
  deployJsonObject,
  deployJsonObjectAsync,
  deployJsonObjectAuto
} from "../core/handler/objectLoadHandler.js";

function buildBoxRecord(name = "box-a") {
  return {
    name,
    objType: "box",
    geometry: { width: 1, height: 1, depth: 1 },
    position: { x: 0, y: 0, z: 0 },
    material: { type: "standard", color: "#00ff00" }
  };
}

test("createJsonObject creates mesh for pure record", () => {
  const obj = createJsonObject(buildBoxRecord());
  assert.ok(obj?.isObject3D);
});

test("createJsonObjectBatch supports mixed records", () => {
  const out = createJsonObjectBatch([buildBoxRecord("a"), buildBoxRecord("b")]);
  assert.equal(out.length, 2);
  assert.ok(out[0]?.isObject3D);
});

test("deployJsonObject appends to target scene", () => {
  const scene = new THREE.Scene();
  const before = scene.children.length;
  deployJsonObject(scene, buildBoxRecord());
  assert.ok(scene.children.length >= before + 1);
});

test("deployJsonObjectAsync handles single record", async () => {
  const scene = new THREE.Scene();
  const obj = await deployJsonObjectAsync(scene, buildBoxRecord());
  assert.ok(obj === null || obj?.isObject3D);
});

test("auto APIs dispatch by input shape", () => {
  const one = createJsonObjectAuto(buildBoxRecord());
  const many = createJsonObjectAuto([buildBoxRecord("x"), buildBoxRecord("y")]);
  assert.ok(one === null || one?.isObject3D);
  assert.ok(Array.isArray(many));
  assert.equal(many.length, 2);

  const scene = new THREE.Scene();
  const deployed = deployJsonObjectAuto(scene, [buildBoxRecord("m"), buildBoxRecord("n")]);
  assert.ok(Array.isArray(deployed));
  assert.equal(deployed.length, 2);
});

test("object APIs reject non-record mode", () => {
  const scene = new THREE.Scene();
  assert.throws(
    () => deployJsonObject(scene, buildBoxRecord("sub"), { mode: "subScene" }),
    /E_OBJECT_MODE_MISMATCH/
  );
});

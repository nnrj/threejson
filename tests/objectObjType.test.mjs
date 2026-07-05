import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import { clearObjectRegistry, registerObject } from "../core/handler/objectRegistry.js";
import { setUserDataObjJson } from "../core/handler/objectDescriptorAttach.js";
import {
  getObjectsByObjType,
  getObjJsonListByObjType,
  setObjectsVisibleByObjType,
  destroyObjectsByObjType,
  getThreeJsonIdsByObjType
} from "../core/handler/objectObjType.js";

test("objType index resolves record objType only", () => {
  clearObjectRegistry();
  const scene = new THREE.Scene();

  const cabinetRoot = new THREE.Group();
  setUserDataObjJson(cabinetRoot, {
    threeJsonId: "cab-domain-1",
    objType: "domain",
    domain: "device.cabinet",
    name: "cab-1"
  });
  scene.add(cabinetRoot);
  registerObject(cabinetRoot, cabinetRoot.userData.objJson, { recursive: false });

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  setUserDataObjJson(mesh, {
    threeJsonId: "cab-plain-1",
    objType: "deviceCabinet",
    name: "legacy-cab"
  });
  scene.add(mesh);
  registerObject(mesh, mesh.userData.objJson, { recursive: false });

  assert.deepEqual(getThreeJsonIdsByObjType("deviceCabinet"), ["cab-plain-1"]);
  assert.deepEqual(getThreeJsonIdsByObjType("domain").sort(), ["cab-domain-1"]);
  assert.equal(getObjectsByObjType(scene, "deviceCabinet").length, 1);
  assert.equal(getObjectsByObjType(scene, "domain").length, 1);
});

test("setObjectsVisibleByObjType toggles visibility", () => {
  clearObjectRegistry();
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  setUserDataObjJson(mesh, {
    threeJsonId: "vis-1",
    objType: "deviceCabinet",
    name: "cab"
  });
  scene.add(mesh);
  registerObject(mesh, mesh.userData.objJson, { recursive: false });

  setObjectsVisibleByObjType(scene, "deviceCabinet", false);
  assert.equal(mesh.visible, false);
  setObjectsVisibleByObjType(scene, "deviceCabinet", true);
  assert.equal(mesh.visible, true);
});

test("destroyObjectsByObjType removes indexed objects via registry core", () => {
  clearObjectRegistry();
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  setUserDataObjJson(mesh, {
    threeJsonId: "del-1",
    objType: "shippingLine",
    name: "line-1"
  });
  scene.add(mesh);
  registerObject(mesh, mesh.userData.objJson, { recursive: false });

  const count = destroyObjectsByObjType(scene, "shippingLine");
  assert.equal(count, 1);
  assert.equal(getObjectsByObjType(scene, "shippingLine").length, 0);
  assert.equal(scene.children.length, 0);
});

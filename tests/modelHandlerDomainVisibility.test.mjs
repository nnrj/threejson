import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import { clearObjectRegistry, registerObject } from "../core/handler/objectRegistry.js";
import { setObjectsVisibleByObjType } from "../core/handler/objectObjType.js";
import { setUserDataObjJson } from "../core/handler/objectDescriptorAttach.js";

test("setObjectsVisibleByObjType matches domain deploy roots by objType domain", () => {
  clearObjectRegistry();
  const scene = new THREE.Scene();
  const cabinetRoot = new THREE.Group();
  setUserDataObjJson(cabinetRoot, {
    threeJsonId: "cab-domain-vis",
    objType: "domain",
    domain: "device.cabinet",
    handler: "deployCabinet",
    name: "cab-1"
  });
  scene.add(cabinetRoot);
  registerObject(cabinetRoot, cabinetRoot.userData.objJson, { recursive: false });

  setObjectsVisibleByObjType(scene, "domain", false);
  assert.equal(cabinetRoot.visible, false);

  setObjectsVisibleByObjType(scene, "domain", true);
  assert.equal(cabinetRoot.visible, true);
});

test("setObjectsVisibleByObjType still matches plain objType cabinet", () => {
  clearObjectRegistry();
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  setUserDataObjJson(mesh, {
    threeJsonId: "cab-plain-vis",
    objType: "deviceCabinet",
    name: "legacy-cab"
  });
  scene.add(mesh);
  registerObject(mesh, mesh.userData.objJson, { recursive: false });

  setObjectsVisibleByObjType(scene, "deviceCabinet", false);
  assert.equal(mesh.visible, false);
});

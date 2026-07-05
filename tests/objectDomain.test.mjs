import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import { clearObjectRegistry, registerObject } from "../core/handler/objectRegistry.js";
import { setUserDataObjJson } from "../core/handler/objectDescriptorAttach.js";
import {
  getObjectsByDomain,
  getObjJsonListByDomain,
  getThreeJsonIdsByDomain
} from "../core/handler/objectDomain.js";

test("domain index resolves canonical domain deploy roots only", () => {
  clearObjectRegistry();
  const scene = new THREE.Scene();

  const cabinetRoot = new THREE.Group();
  setUserDataObjJson(cabinetRoot, {
    threeJsonId: "cab-domain-1",
    objType: "domain",
    domain: "device.cabinet",
    name: "cabinet",
    label: "机柜01"
  });
  scene.add(cabinetRoot);
  registerObject(cabinetRoot, cabinetRoot.userData.objJson, { recursive: false });

  const acRoot = new THREE.Group();
  setUserDataObjJson(acRoot, {
    threeJsonId: "ac-domain-1",
    objType: "domain",
    domain: "device.airConditioner",
    name: "air-conditioning"
  });
  scene.add(acRoot);
  registerObject(acRoot, acRoot.userData.objJson, { recursive: false });

  const flatDoor = new THREE.Group();
  setUserDataObjJson(flatDoor, {
    threeJsonId: "door-flat-1",
    objType: "door",
    domain: "door",
    name: "room-door"
  });
  scene.add(flatDoor);
  registerObject(flatDoor, flatDoor.userData.objJson, { recursive: false });

  assert.deepEqual(getThreeJsonIdsByDomain("device.cabinet"), ["cab-domain-1"]);
  assert.equal(getObjectsByDomain(scene, "device.cabinet").length, 1);
  assert.equal(getObjectsByDomain(scene, "device.cabinet")[0], cabinetRoot);
  assert.equal(getObjectsByDomain(scene, "device.airConditioner").length, 1);
  assert.equal(getObjectsByDomain(scene, "door").length, 0);

  const jsonList = getObjJsonListByDomain(scene, "device.cabinet");
  assert.equal(jsonList.length, 1);
  assert.equal(jsonList[0].label, "机柜01");
});

test("getObjectsByDomain respects root scope", () => {
  clearObjectRegistry();
  const scene = new THREE.Scene();
  const sub = new THREE.Group();
  scene.add(sub);

  const cabinetRoot = new THREE.Group();
  setUserDataObjJson(cabinetRoot, {
    threeJsonId: "cab-scoped",
    objType: "domain",
    domain: "device.cabinet",
    name: "cabinet"
  });
  sub.add(cabinetRoot);
  registerObject(cabinetRoot, cabinetRoot.userData.objJson, { recursive: false });

  assert.equal(getObjectsByDomain(scene, "device.cabinet", { root: sub }).length, 1);
  assert.equal(getObjectsByDomain(scene, "device.cabinet", { root: scene }).length, 1);

  const outside = new THREE.Group();
  assert.equal(getObjectsByDomain(scene, "device.cabinet", { root: outside }).length, 0);
});

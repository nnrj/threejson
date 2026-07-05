import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveObjectDisplayLabel,
  resolveObjectDisplayLabelFromObject
} from "../core/util/resolveObjectDisplayLabel.js";
import {
  setObjectsVisibleByName,
  setObjectsVisibleByNames,
  setObjectVisibleByThreeJsonId
} from "../core/handler/objectVisibility.js";
import {
  clearObjectRegistry,
  registerObject,
  getObjectsByName
} from "../core/handler/objectRegistry.js";
import * as THREE from "three";

test("resolveObjectDisplayLabel fallback chain", () => {
  assert.equal(resolveObjectDisplayLabel({ label: "北墙" }), "北墙");
  assert.equal(resolveObjectDisplayLabel({ name: "room-wall" }), "room-wall");
  assert.equal(resolveObjectDisplayLabel({ threeJsonId: "abc" }), "abc");
  assert.equal(resolveObjectDisplayLabel({}), "Unnamed");
  assert.equal(
    resolveObjectDisplayLabel({ label: "展示", name: "batch", threeJsonId: "id" }),
    "展示"
  );
});

test("setObjectsVisibleByName hits all same-name objects", () => {
  clearObjectRegistry();
  const a = new THREE.Mesh();
  const b = new THREE.Mesh();
  a.userData.objJson = { threeJsonId: "a1", name: "room-wall", label: "墙A" };
  b.userData.objJson = { threeJsonId: "b1", name: "room-wall", label: "墙B" };
  a.name = "room-wall";
  b.name = "room-wall";
  registerObject(a, a.userData.objJson);
  registerObject(b, b.userData.objJson);
  assert.equal(getObjectsByName("room-wall").length, 2);
  const n = setObjectsVisibleByName("room-wall", false);
  assert.equal(n, 2);
  assert.equal(a.visible, false);
  assert.equal(b.visible, false);
  clearObjectRegistry();
});

test("setObjectsVisibleByNames aggregates counts", () => {
  clearObjectRegistry();
  const wall = new THREE.Mesh();
  wall.userData.objJson = { threeJsonId: "w1", name: "room-wall" };
  wall.name = "room-wall";
  registerObject(wall, wall.userData.objJson);
  const count = setObjectsVisibleByNames(["room-wall", "room-glass"], false);
  assert.equal(count, 1);
  clearObjectRegistry();
});

test("setObjectsVisibleByName defaults applyToSubtree to hide group child meshes", () => {
  clearObjectRegistry();
  const group = new THREE.Group();
  group.userData.objJson = {
    threeJsonId: "tray-group-1",
    name: "room-ceiling",
    label: "cable-tray-group",
    objType: "group"
  };
  group.name = "room-ceiling";
  const tray = new THREE.Mesh();
  tray.userData.objJson = {
    threeJsonId: "tray-main-1",
    name: "tray-main",
    label: "tray-main",
    objType: "box"
  };
  tray.name = "tray-main";
  tray.material = { visible: true };
  group.add(tray);
  registerObject(group, group.userData.objJson, { recursive: true });

  setObjectsVisibleByName("room-ceiling", false);
  assert.equal(group.visible, false);
  assert.equal(tray.visible, false);
  assert.equal(tray.material.visible, false);

  setObjectsVisibleByName("room-ceiling", true);
  assert.equal(group.visible, true);
  assert.equal(tray.visible, true);
  assert.equal(tray.material.visible, true);

  clearObjectRegistry();
});

test("setObjectsVisibleByName applyToSubtree false toggles registry root only", () => {
  clearObjectRegistry();
  const group = new THREE.Group();
  group.userData.objJson = {
    threeJsonId: "tray-group-2",
    name: "room-ceiling",
    objType: "group"
  };
  group.name = "room-ceiling";
  const tray = new THREE.Mesh();
  tray.userData.objJson = {
    threeJsonId: "tray-main-2",
    name: "tray-main",
    objType: "box"
  };
  tray.name = "tray-main";
  tray.material = { visible: true };
  group.add(tray);
  registerObject(group, group.userData.objJson, { recursive: true });

  setObjectsVisibleByName("room-ceiling", false, { applyToSubtree: false });
  assert.equal(group.visible, false);
  assert.equal(tray.visible, true);
  assert.equal(tray.material.visible, true);

  clearObjectRegistry();
});

test("setObjectVisibleByThreeJsonId toggles single object", () => {
  clearObjectRegistry();
  const mesh = new THREE.Mesh();
  mesh.userData.objJson = { threeJsonId: "tid-1", name: "x" };
  mesh.name = "x";
  registerObject(mesh, mesh.userData.objJson);
  assert.equal(setObjectVisibleByThreeJsonId("tid-1", false), true);
  assert.equal(mesh.visible, false);
  clearObjectRegistry();
});
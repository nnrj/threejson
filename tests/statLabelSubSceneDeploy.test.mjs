import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import { deployGroupDescriptor } from "../core/handler/objectLoadHandler.js";
import {
  migrateGroupDescriptorToSubScene,
  normalizeSubSceneOnRecord
} from "../core/handler/subSceneHierarchy.js";
import { cabinetBoxGroup } from "../domains/device/deviceTemplates.js";

function findFirstMesh(root) {
  if (!root) {
    return null;
  }
  if (root.isMesh) {
    return root;
  }
  for (let i = 0; i < root.children.length; i += 1) {
    const found = findFirstMesh(root.children[i]);
    if (found) {
      return found;
    }
  }
  return null;
}

test("businessInfo.statLabel survives subScene migrate and normalize", () => {
  const desc = JSON.parse(JSON.stringify(cabinetBoxGroup));
  desc.objType = "group";
  desc.boxModelList[0].businessInfo = {
    statLabel: "15%",
    statKind: "capacity"
  };

  migrateGroupDescriptorToSubScene(desc);
  assert.equal(desc.boxModelList, undefined);
  assert.equal(desc.subScene?.[0]?.businessInfo?.statLabel, "15%");

  const { record: normalized } = normalizeSubSceneOnRecord(desc);
  assert.equal(normalized.subScene?.[0]?.businessInfo?.statLabel, "15%");
});

test("deployGroupDescriptor preserves statLabel on mesh userData.objJson", () => {
  const desc = JSON.parse(JSON.stringify(cabinetBoxGroup));
  desc.objType = "group";
  desc.boxModelList[0].businessInfo = {
    statLabel: "2/42",
    statKind: "rackSpace"
  };
  desc.boxModelList[0].objType = "box";

  const scene = new THREE.Scene();
  const group = deployGroupDescriptor(scene, desc);
  assert.ok(group);

  const mesh = findFirstMesh(group);
  assert.ok(mesh?.isMesh);
  assert.equal(mesh.userData.objJson.businessInfo.statLabel, "2/42");
});

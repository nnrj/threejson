import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import {
  addObjectFromDescriptor,
  addObjectFromDescriptorAsync,
  removeObjectById
} from "../core/runtime/sceneObjectCommands.js";
import {
  clearObjectRegistry,
  getObjectByThreeJsonId,
  registerObject
} from "../core/handler/objectRegistry.js";
import { addSystemBucketTag } from "../core/handler/bucketIndex.js";

function buildBoxDescriptor(overrides = {}) {
  return {
    name: "cmd-box",
    objType: "box",
    geometry: { width: 1, height: 1, depth: 1 },
    position: { x: 0, y: 0, z: 0 },
    material: { type: "standard", color: "#336699" },
    ...overrides
  };
}

test("addObjectFromDescriptor deploys box and registers threeJsonId", () => {
  clearObjectRegistry();
  const scene = new THREE.Scene();
  const res = addObjectFromDescriptor(scene, buildBoxDescriptor());
  assert.equal(res.ok, true);
  assert.equal(res.needsAsync, false);
  assert.ok(res.threeJsonId);
  assert.ok(res.object3D?.isMesh || getObjectByThreeJsonId(res.threeJsonId)?.isMesh);
  assert.ok(scene.children.length >= 1);
  clearObjectRegistry();
});

test("addObjectFromDescriptor rejects duplicate threeJsonId", () => {
  clearObjectRegistry();
  const scene = new THREE.Scene();
  const id = "dup-box-1";
  const first = addObjectFromDescriptor(scene, buildBoxDescriptor({ threeJsonId: id }));
  assert.equal(first.ok, true);
  const second = addObjectFromDescriptor(scene, buildBoxDescriptor({ threeJsonId: id }));
  assert.equal(second.ok, false);
  assert.match(String(second.error), /duplicate/i);
  clearObjectRegistry();
});

test("removeObjectById returns removedDescriptor and unregisters", () => {
  clearObjectRegistry();
  const scene = new THREE.Scene();
  const id = "rm-box-1";
  const added = addObjectFromDescriptor(scene, buildBoxDescriptor({ threeJsonId: id }));
  assert.equal(added.ok, true);

  const removed = removeObjectById(scene, id);
  assert.equal(removed.ok, true);
  assert.equal(removed.removedDescriptor?.threeJsonId, id);
  assert.equal(getObjectByThreeJsonId(id), null);
  clearObjectRegistry();
});

test("removeObjectById blocks protected camera unless allowProtectedRemoval", () => {
  clearObjectRegistry();
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  const id = "prot-cam-1";
  cam.userData.objJson = { threeJsonId: id, objType: "camera", name: "cam" };
  registerObject(cam, cam.userData.objJson, { recursive: false });
  scene.add(cam);
  addSystemBucketTag(id, "environment");

  const blocked = removeObjectById(scene, id);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.protected, true);

  const forced = removeObjectById(scene, id, { allowProtectedRemoval: true });
  assert.equal(forced.ok, true);
  assert.equal(getObjectByThreeJsonId(id), null);
  clearObjectRegistry();
});

test("removeObjectById captureSubtree collects child descriptors", () => {
  clearObjectRegistry();
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  const child = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.5, 0.5),
    new THREE.MeshBasicMaterial()
  );
  const groupId = "grp-1";
  const childId = "child-1";
  group.userData.objJson = {
    threeJsonId: groupId,
    objType: "group",
    name: "g",
    boxModelList: []
  };
  child.userData.objJson = {
    threeJsonId: childId,
    objType: "box",
    name: "c",
    geometry: { width: 0.5, height: 0.5, depth: 0.5 }
  };
  registerObject(group, group.userData.objJson, { recursive: false });
  registerObject(child, child.userData.objJson, { recursive: false });
  group.add(child);
  scene.add(group);

  const removed = removeObjectById(scene, groupId, { captureSubtree: true });
  assert.equal(removed.ok, true);
  assert.equal(removed.removedDescriptor.threeJsonId, groupId);
  assert.ok(Array.isArray(removed.removedSubtree));
  assert.equal(removed.removedSubtree.length, 1);
  assert.equal(removed.removedSubtree[0].threeJsonId, childId);
  clearObjectRegistry();
});

test("add then remove round-trip via removedDescriptor", () => {
  clearObjectRegistry();
  const scene = new THREE.Scene();
  const id = "rt-box-1";
  const added = addObjectFromDescriptor(scene, buildBoxDescriptor({ threeJsonId: id }));
  assert.equal(added.ok, true);

  const removed = removeObjectById(scene, id);
  assert.equal(removed.ok, true);

  const restored = addObjectFromDescriptor(scene, removed.removedDescriptor, {
    parent: scene
  });
  assert.equal(restored.ok, true);
  assert.equal(restored.threeJsonId, id);
  assert.ok(getObjectByThreeJsonId(id)?.isMesh);
  clearObjectRegistry();
});

test("addObjectFromDescriptor deploys empty group container for command-mode parent workflow", () => {
  clearObjectRegistry();
  const scene = new THREE.Scene();
  const res = addObjectFromDescriptor(scene, {
    objType: "group",
    name: "assembly-root"
  });
  assert.equal(res.ok, true);
  const node = getObjectByThreeJsonId(res.threeJsonId);
  assert.ok(node?.isGroup);
  assert.equal(scene.children.length, 1);
  clearObjectRegistry();
});

test("addObjectFromDescriptor parents box under group threeJsonId", () => {
  clearObjectRegistry();
  const scene = new THREE.Scene();
  const groupId = "grp-parent-1";
  const groupRes = addObjectFromDescriptor(scene, {
    objType: "group",
    name: "assembly",
    threeJsonId: groupId
  });
  assert.equal(groupRes.ok, true);
  const boxRes = addObjectFromDescriptor(
    scene,
    buildBoxDescriptor({ name: "child-box", threeJsonId: "child-box-1" }),
    { parent: groupId }
  );
  assert.equal(boxRes.ok, true);
  const group = getObjectByThreeJsonId(groupId);
  const child = getObjectByThreeJsonId("child-box-1");
  assert.equal(group.children.length, 1);
  assert.equal(group.children[0], child);
  assert.equal(scene.children.length, 1);
  clearObjectRegistry();
});

test("addObjectFromDescriptor parents sphere under nested group", () => {
  clearObjectRegistry();
  const scene = new THREE.Scene();
  const outerId = "outer-grp";
  const innerId = "inner-grp";
  assert.equal(
    addObjectFromDescriptor(scene, { objType: "group", name: "outer", threeJsonId: outerId }).ok,
    true
  );
  assert.equal(
    addObjectFromDescriptor(scene, { objType: "group", name: "inner", threeJsonId: innerId }, {
      parent: outerId
    }).ok,
    true
  );
  const sphereRes = addObjectFromDescriptor(
    scene,
    {
      objType: "sphere",
      name: "eye",
      threeJsonId: "eye-1",
      geometry: { radius: 2 },
      material: { type: "standard", color: "#ff4081" }
    },
    { parent: innerId }
  );
  assert.equal(sphereRes.ok, true);
  const inner = getObjectByThreeJsonId(innerId);
  assert.equal(inner.children.length, 1);
  assert.ok(inner.children[0]?.isMesh);
  clearObjectRegistry();
});

test("addObjectFromDescriptor fails when deploy produces no object", () => {
  clearObjectRegistry();
  const scene = new THREE.Scene();
  const res = addObjectFromDescriptor(scene, {
    objType: "line",
    name: "bad-line",
    position: { x: 0, y: 0, z: 0 }
  });
  assert.equal(res.ok, false);
  assert.equal(scene.children.length, 0);
  clearObjectRegistry();
});

test("addObjectFromDescriptorAsync deploys box", async () => {
  clearObjectRegistry();
  const scene = new THREE.Scene();
  const res = await addObjectFromDescriptorAsync(scene, buildBoxDescriptor());
  assert.equal(res.ok, true);
  assert.ok(getObjectByThreeJsonId(res.threeJsonId)?.isMesh);
  clearObjectRegistry();
});

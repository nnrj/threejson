import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  applyViewModelLocalTransform,
  attachObjectToCamera,
  fitViewModelToCameraSpace,
  placeLoadedModelByAttachTarget,
  shouldApplyRecordTransform,
  shouldFitViewModel
} from "../core/handler/controls/viewModelAttach.js";
import {
  registerViewModelFollow,
  syncViewModelPivotToCamera
} from "../core/handler/controls/viewModelFollowCamera.js";

test("shouldApplyRecordTransform defaults true and respects false", () => {
  assert.equal(shouldApplyRecordTransform({}), true);
  assert.equal(shouldApplyRecordTransform({ applyTransform: true }), true);
  assert.equal(shouldApplyRecordTransform({ applyTransform: false }), false);
});

test("applyViewModelLocalTransform skips when applyTransform false", () => {
  const o = new THREE.Group();
  applyViewModelLocalTransform(o, {
    applyTransform: false,
    position: { x: 9, y: 9, z: 9 }
  });
  assert.equal(o.position.x, 0);
});

test("attachObjectToCamera parents object and applies local transform", () => {
  const camera = new THREE.PerspectiveCamera();
  const scene = new THREE.Scene();
  scene.add(camera);
  const model = new THREE.Group();

  const ok = attachObjectToCamera(camera, model, scene, {
    viewModelFit: false,
    position: { x: 0.1, y: -0.2, z: -0.3 },
    rotation: { rotationX: 0.1, rotationY: 0.2, rotationZ: 0 },
    scale: { scaleX: 2, scaleY: 2, scaleZ: 2 }
  });

  assert.equal(ok, true);
  const content = model.parent;
  const pivot = content?.parent;
  assert.equal(pivot?.type, "Group");
  assert.equal(pivot.parent, scene);
  assert.equal(pivot.position.x, 0.1);
  assert.equal(pivot.position.y, -0.2);
  assert.equal(pivot.position.z, -0.3);
  assert.equal(content.scale.x, 2);
  assert.equal(pivot.scale.x, 1);
});

test("placeLoadedModelByAttachTarget camera uses camera not scene children", () => {
  const camera = new THREE.PerspectiveCamera();
  const scene = new THREE.Scene();
  scene.add(camera);
  const model = new THREE.Group();

  const where = placeLoadedModelByAttachTarget(
    { attachTo: "camera", viewModelFit: false, position: { x: 0, y: 0, z: -1 } },
    model,
    scene,
    { camera }
  );

  assert.equal(where, "camera");
  const pivot = model.parent?.parent;
  assert.equal(pivot?.type, "Group");
  assert.equal(pivot.userData.threeJsonViewModelFollow?.camera, camera);
  assert.equal(scene.children.includes(model), false);
});

test("syncViewModelPivotToCamera follows camera movement", () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  scene.add(camera);
  const pivot = new THREE.Group();
  pivot.position.set(0, 0, -1);
  scene.add(pivot);
  registerViewModelFollow(pivot, camera);
  camera.position.set(0, 2, 10);
  camera.updateMatrixWorld(true);
  syncViewModelPivotToCamera(pivot, camera);
  assert.ok(Math.abs(pivot.position.z - 9) < 0.05);
});

test("placeLoadedModelByAttachTarget without attachTo returns failed", () => {
  const scene = new THREE.Scene();
  const model = new THREE.Group();
  assert.equal(placeLoadedModelByAttachTarget({}, model, scene, {}), "failed");
  assert.equal(model.parent, null);
});

test("placeLoadedModelByAttachTarget camera without camera returns failed", () => {
  const scene = new THREE.Scene();
  const model = new THREE.Group();
  assert.equal(placeLoadedModelByAttachTarget({ attachTo: "camera" }, model, scene, {}), "failed");
  assert.equal(model.parent, null);
});

test("applyViewModelLocalTransform leaves defaults when fields omitted", () => {
  const o = new THREE.Group();
  o.position.set(5, 5, 5);
  applyViewModelLocalTransform(o, {});
  assert.equal(o.position.x, 5);
});

test("applyViewModelLocalTransform does not reset scale when viewModelFit", () => {
  const o = new THREE.Group();
  o.scale.set(0.25, 0.25, 0.25);
  applyViewModelLocalTransform(o, {
    attachTo: "camera",
    viewModelFit: true,
    scale: { scaleX: 1, scaleY: 1, scaleZ: 1 }
  });
  assert.equal(o.scale.x, 0.25);
});

test("shouldFitViewModel defaults true for attachTo camera", () => {
  assert.equal(shouldFitViewModel({ attachTo: "camera" }), true);
  assert.equal(shouldFitViewModel({ attachTo: "camera", viewModelFit: false }), false);
});

test("fitViewModelToCameraSpace centers offset child and scales to max size", () => {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2),
    new THREE.MeshBasicMaterial()
  );
  mesh.position.set(10, 0, 0);
  root.add(mesh);

  fitViewModelToCameraSpace(root, { viewModelMaxSize: 1 });

  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const maxDim = Math.max(size.x, size.y, size.z);
  assert.ok(Math.abs(maxDim - 1) < 0.05, `expected maxDim ~1, got ${maxDim}`);
  assert.ok(Math.abs(center.x) < 0.05 && Math.abs(center.y) < 0.05 && Math.abs(center.z) < 0.05);
  assert.equal(mesh.frustumCulled, false);
});

test("fitViewModelToCameraSpace scales skinned meshes not parent group", () => {
  const content = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(30, 30, 30),
    new THREE.MeshBasicMaterial()
  );
  mesh.isSkinnedMesh = true;
  content.add(mesh);

  const result = fitViewModelToCameraSpace(content, { viewModelMaxSize: 1.2 });

  assert.equal(result.fitted, true);
  assert.equal(result.skinnedFit, true);
  assert.equal(content.scale.x, 1);
  assert.ok(mesh.scale.x < 0.1);
  assert.ok(Math.abs(content.position.x) < 1e-5);
});

test("syncViewModelPivotToCamera keeps pivot scale 1 for skinned viewmodel", () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  scene.add(camera);

  const pivot = new THREE.Group();
  const content = new THREE.Group();
  const skinned = new THREE.SkinnedMesh(
    new THREE.BoxGeometry(0.2, 0.2, 0.2),
    new THREE.MeshBasicMaterial()
  );
  content.add(skinned);
  pivot.add(content);
  content.scale.set(0.03, 0.03, 0.03);
  scene.add(pivot);

  registerViewModelFollow(pivot, camera);
  camera.position.set(0, 2, 10);
  camera.rotation.set(0.2, 0.5, 0.1);
  camera.updateMatrixWorld(true);
  syncViewModelPivotToCamera(pivot, camera);

  assert.ok(Math.abs(pivot.scale.x - 1) < 1e-5);
  assert.ok(Math.abs(pivot.scale.y - 1) < 1e-5);
  assert.ok(Math.abs(pivot.scale.z - 1) < 1e-5);
  assert.ok(Math.abs(content.scale.x - 0.03) < 1e-5);
});

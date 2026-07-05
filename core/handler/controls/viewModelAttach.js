/**
 * First-person viewmodel: parent to scene, follow camera each frame (see viewModelFollowCamera.js).
 */
import * as THREE from "three";
import { log } from "../../util/logger.js";
import {
  captureViewModelCameraLocal,
  registerViewModelFollow,
  syncViewModelPivotToCamera
} from "./viewModelFollowCamera.js";

const _box = new THREE.Box3();
const _center = new THREE.Vector3();
const _size = new THREE.Vector3();
export function normalizeAttachTo(record) {
  return typeof record?.attachTo === "string" ? record.attachTo.trim().toLowerCase() : "";
}

/** Default true; skip JSON position/rotation/scale only when `applyTransform: false` */
export function shouldApplyRecordTransform(record = {}) {
  return record?.applyTransform !== false;
}

export function shouldFitViewModel(record = {}) {
  if (record.viewModelFit === false) {
    return false;
  }
  if (record.viewModelFit === true) {
    return true;
  }
  return normalizeAttachTo(record) === "camera";
}

function countVisibleMeshes(object) {
  let n = 0;
  object?.traverse?.((child) => {
    if (child.isMesh && child.visible !== false) {
      n++;
    }
  });
  return n;
}

function collectSkinnedMeshes(root, out = []) {
  root?.traverse?.((child) => {
    if (child.isSkinnedMesh) {
      out.push(child);
    }
  });
  return out;
}

export function fitViewModelToCameraSpace(pivot, record = {}) {
  if (!pivot?.isObject3D) {
    return { fitted: false, reason: "no-object" };
  }
  const maxSize = Number.isFinite(record.viewModelMaxSize) ? record.viewModelMaxSize : 1;
  const skinnedMeshes = collectSkinnedMeshes(pivot, []);

  pivot.traverse((child) => {
    if (child.isSkinnedMesh && child.skeleton) {
      child.skeleton.update();
    }
  });
  pivot.updateMatrixWorld(true);
  _box.setFromObject(pivot);
  if (_box.isEmpty()) {
    return { fitted: false, reason: "empty-box", meshCount: countVisibleMeshes(pivot) };
  }

  _box.getSize(_size);
  const maxDim = Math.max(_size.x, _size.y, _size.z, 1e-6);
  const scaleFactor = maxSize / maxDim;

  if (skinnedMeshes.length > 0) {
    pivot.scale.set(1, 1, 1);
    for (let i = 0; i < skinnedMeshes.length; i++) {
      const mesh = skinnedMeshes[i];
      mesh.scale.multiplyScalar(scaleFactor);
      mesh.skeleton?.update();
    }
    pivot.updateMatrixWorld(true);
    setViewModelFrustumCulled(pivot, false);
    return {
      fitted: true,
      skinnedFit: true,
      maxDimAfter: maxSize,
      contentScale: [pivot.scale.x, pivot.scale.y, pivot.scale.z],
      meshScale: skinnedMeshes[0] ? [skinnedMeshes[0].scale.x, skinnedMeshes[0].scale.y, skinnedMeshes[0].scale.z] : null,
      meshCount: countVisibleMeshes(pivot)
    };
  }

  _box.getCenter(_center);
  pivot.position.x -= _center.x;
  pivot.position.y -= _center.y;
  pivot.position.z -= _center.z;
  pivot.scale.multiplyScalar(scaleFactor);

  pivot.updateMatrixWorld(true);
  _box.setFromObject(pivot);
  if (!_box.isEmpty()) {
    _box.getCenter(_center);
    pivot.position.x -= _center.x;
    pivot.position.y -= _center.y;
    pivot.position.z -= _center.z;
  }

  pivot.updateMatrixWorld(true);
  setViewModelFrustumCulled(pivot, false);

  _box.setFromObject(pivot);
  _box.getSize(_size);
  return {
    fitted: true,
    skinnedFit: false,
    maxDimAfter: Math.max(_size.x, _size.y, _size.z, 0),
    contentScale: [pivot.scale.x, pivot.scale.y, pivot.scale.z],
    meshCount: countVisibleMeshes(pivot)
  };
}

export function setViewModelFrustumCulled(root, culled = false) {
  if (!root) {
    return;
  }
  root.traverse((child) => {
    child.frustumCulled = culled;
  });
}

export function configureViewModelDrawOrder(root) {
  if (!root) {
    return;
  }
  root.traverse((child) => {
    if (!child.isMesh) {
      return;
    }
    child.renderOrder = 10;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (let i = 0; i < mats.length; i++) {
      const m = mats[i];
      if (!m) {
        continue;
      }
      m.depthTest = true;
      m.depthWrite = true;
      m.needsUpdate = true;
    }
  });
}

export function applyViewModelLocalTransform(object, record = {}, options = {}) {
  if (!object || !shouldApplyRecordTransform(record)) {
    return;
  }
  const scaleTarget = options.scaleTarget || object;
  if (record.position && typeof record.position === "object") {
    object.position.set(
      Number(record.position.x) || 0,
      Number(record.position.y) || 0,
      Number(record.position.z) || 0
    );
  }
  if (
    record.scale &&
    typeof record.scale === "object" &&
    !shouldFitViewModel(record)
  ) {
    scaleTarget.scale.set(
      record.scale.scaleX != null ? record.scale.scaleX : 1,
      record.scale.scaleY != null ? record.scale.scaleY : 1,
      record.scale.scaleZ != null ? record.scale.scaleZ : 1
    );
  }
  if (record.rotation && typeof record.rotation === "object") {
    object.rotation.set(
      record.rotation.rotationX != null ? record.rotation.rotationX : 0,
      record.rotation.rotationY != null ? record.rotation.rotationY : 0,
      record.rotation.rotationZ != null ? record.rotation.rotationZ : 0
    );
  }
}

/**
 * @param {import("three").PerspectiveCamera} camera
 * @param {import("three").Object3D} model
 * @param {import("three").Scene} scene
 * @param {object} [record]
 */
export function attachObjectToCamera(camera, model, scene, record = {}) {
  if (!camera?.isCamera || !model?.isObject3D || !scene?.isScene) {
    return false;
  }

  if (model.parent) {
    model.parent.remove(model);
  }

  const pivot = new THREE.Group();
  pivot.name = `${record.refName || record.name || "viewmodel"}_pivot`;
  pivot.scale.set(1, 1, 1);

  const content = new THREE.Group();
  content.name = `${record.refName || record.name || "viewmodel"}_content`;
  content.add(model);
  pivot.add(content);

  if (shouldFitViewModel(record)) {
    fitViewModelToCameraSpace(content, record);
  }
  applyViewModelLocalTransform(pivot, record, { scaleTarget: content });
  setViewModelFrustumCulled(pivot, false);
  configureViewModelDrawOrder(pivot);

  scene.add(pivot);
  registerViewModelFollow(pivot, camera);
  syncViewModelPivotToCamera(pivot, camera);
  captureViewModelCameraLocal(pivot, camera);

  return true;
}

/**
 * Only handles viewmodel attach with `attachTo: "camera"`; default loading is done by loadGltf.
 * @returns {"camera"|"failed"|"unsupported"}
 */
export function placeLoadedModelByAttachTarget(record, object, scene, loadOptions = {}) {
  if (!object || !scene?.isScene) {
    return "failed";
  }
  const attachTo = normalizeAttachTo(record);
  if (attachTo !== "camera") {
    return attachTo ? "unsupported" : "failed";
  }
  const camera = loadOptions.camera;
  if (!camera) {
    log.warn(
      "[viewModelAttach] attachTo=camera but no camera at deploy time:",
      record?.name || record?.refName || ""
    );
    return "failed";
  }
  if (!attachObjectToCamera(camera, object, scene, record)) {
    return "failed";
  }
  return "camera";
}

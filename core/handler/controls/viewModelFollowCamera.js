/**
 * Viewmodel parented to scene; synced each frame from camera matrixWorld (camera children may not render).
 */
import * as THREE from "three";

const _local = new THREE.Matrix4();
const _world = new THREE.Matrix4();
const _invCamera = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _unitScale = new THREE.Vector3(1, 1, 1);

/**
 * @param {import("three").Group} pivot
 * @param {import("three").PerspectiveCamera} camera
 */
export function registerViewModelFollow(pivot, camera) {
  if (!pivot || !camera) {
    return;
  }
  pivot.userData.threeJsonViewModelFollow = {
    camera,
    localPosition: pivot.position.clone(),
    localQuaternion: pivot.quaternion.clone()
  };
}

/**
 * Derive local transform relative to the camera from the pivot world matrix (more stable than cloning position).
 * @param {import("three").Group} pivot
 * @param {import("three").PerspectiveCamera} camera
 */
export function captureViewModelCameraLocal(pivot, camera) {
  if (!pivot || !camera) {
    return;
  }
  camera.updateMatrixWorld(true);
  pivot.updateMatrixWorld(true);
  _invCamera.copy(camera.matrixWorld).invert();
  _local.multiplyMatrices(_invCamera, pivot.matrixWorld);
  _local.decompose(_pos, _quat, _scale);
  const follow = pivot.userData.threeJsonViewModelFollow || {};
  follow.camera = camera;
  follow.localPosition = _pos.clone();
  follow.localQuaternion = _quat.clone();
  pivot.userData.threeJsonViewModelFollow = follow;
}

/**
 * @param {import("three").Group} pivot
 * @param {import("three").PerspectiveCamera} camera
 */
export function syncViewModelPivotToCamera(pivot, camera) {
  const follow = pivot?.userData?.threeJsonViewModelFollow;
  if (!follow || follow.camera !== camera) {
    return;
  }
  camera.updateMatrixWorld(true);
  _local.compose(follow.localPosition, follow.localQuaternion, _unitScale);
  _world.multiplyMatrices(camera.matrixWorld, _local);
  _world.decompose(_pos, _quat, _scale);
  pivot.position.copy(_pos);
  pivot.quaternion.copy(_quat);
  pivot.scale.set(1, 1, 1);
  pivot.updateMatrixWorld(true);
}

/**
 * @param {import("three").Scene} scene
 * @param {import("three").PerspectiveCamera} camera
 */
export function syncViewModelsToCamera(scene, camera) {
  if (!scene || !camera) {
    return;
  }
  scene.traverse((child) => {
    if (child?.userData?.threeJsonViewModelFollow) {
      syncViewModelPivotToCamera(child, camera);
    }
  });
}

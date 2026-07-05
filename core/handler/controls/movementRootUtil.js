import * as THREE from "three";

/**
 * Write world coordinates to movementRoot (camera or rig).
 * @param {import("three").Object3D} movementRoot
 * @param {import("three").PerspectiveCamera} [camera]
 * @param {{ x: number, y: number, z: number }} worldPos
 */
export function setMovementRootWorldPosition(movementRoot, camera, worldPos) {
  if (!movementRoot) {
    return;
  }
  if (movementRoot === camera) {
    camera.position.set(worldPos.x, worldPos.y, worldPos.z);
    return;
  }
  const parent = movementRoot.parent;
  if (parent) {
    movementRoot.position.copy(
      parent.worldToLocal(new THREE.Vector3(worldPos.x, worldPos.y, worldPos.z))
    );
  } else {
    movementRoot.position.set(worldPos.x, worldPos.y, worldPos.z);
  }
}

/**
 * @param {import("three").Object3D} movementRoot
 * @returns {THREE.Vector3}
 */
export function getMovementRootWorldPosition(movementRoot) {
  return movementRoot.getWorldPosition(new THREE.Vector3());
}

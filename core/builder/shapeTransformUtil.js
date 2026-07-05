import { recordHasExplicitRotation } from "./shapeGeometryUtil.js";

function hasValue(value) {
  return value !== undefined && value !== null;
}

function normalizePosition(position = {}) {
  return {
    x: Number(hasValue(position.x) ? position.x : 0),
    y: Number(hasValue(position.y) ? position.y : 0),
    z: Number(hasValue(position.z) ? position.z : 0)
  };
}

function normalizeRotation(rotation = {}) {
  return {
    rotationX: Number(hasValue(rotation.rotationX) ? rotation.rotationX : 0),
    rotationY: Number(hasValue(rotation.rotationY) ? rotation.rotationY : 0),
    rotationZ: Number(hasValue(rotation.rotationZ) ? rotation.rotationZ : 0)
  };
}

function normalizeScale(scale = {}) {
  return {
    scaleX: Number(hasValue(scale.scaleX) ? scale.scaleX : 1),
    scaleY: Number(hasValue(scale.scaleY) ? scale.scaleY : 1),
    scaleZ: Number(hasValue(scale.scaleZ) ? scale.scaleZ : 1)
  };
}

/**
 * @param {import("three").Object3D} object3D
 * @param {object} record
 */
export function applyParallelToOrRotation(object3D, record = {}) {
  const position = normalizePosition(record.position);
  object3D.position.set(position.x, position.y, position.z);

  const scale = normalizeScale(record.scale);
  object3D.scale.set(scale.scaleX, scale.scaleY, scale.scaleZ);

  if (recordHasExplicitRotation(record)) {
    const rotation = normalizeRotation(record.rotation);
    object3D.rotation.set(rotation.rotationX, rotation.rotationY, rotation.rotationZ);
    return;
  }

  const parallelTo = typeof record.parallelTo === "string" ? record.parallelTo.trim().toLowerCase() : "xy";
  if (parallelTo === "xz") {
    object3D.rotation.set(-Math.PI / 2, 0, 0);
  } else if (parallelTo === "yz") {
    object3D.rotation.set(0, Math.PI / 2, 0);
  } else {
    object3D.rotation.set(0, 0, 0);
  }
}

import { recordHasExplicitRotation } from "./shapeGeometryUtil.js";
import { applyObjectTransform } from "../util/objectTransform.js";

/**
 * @param {import("three").Object3D} object3D
 * @param {object} record
 */
export function applyParallelToOrRotation(object3D, record = {}) {
  applyObjectTransform(object3D, record);
  if (record.quaternion !== undefined || recordHasExplicitRotation(record)) return;

  const parallelTo = typeof record.parallelTo === "string" ? record.parallelTo.trim().toLowerCase() : "xy";
  if (parallelTo === "xz") {
    object3D.rotation.set(-Math.PI / 2, 0, 0);
  } else if (parallelTo === "yz") {
    object3D.rotation.set(0, Math.PI / 2, 0);
  } else {
    object3D.rotation.set(0, 0, 0);
  }
}

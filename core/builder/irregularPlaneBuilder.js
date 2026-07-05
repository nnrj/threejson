import { createPlane } from "./modelBuilder.js";
import { createBufferMesh } from "./bufferMeshBuilder.js";
import { createShapePlane } from "./shapePlaneBuilder.js";
import { resolveIrregularPlaneRecord } from "./irregularShapeResolver.js";

export { resolveIrregularPlaneRecord } from "./irregularShapeResolver.js";

/**
 * @param {object} record
 * @param {import("three").Object3D} parent
 * @returns {import("three").Mesh|null}
 */
export function createIrregularPlane(record, parent) {
  const resolved = resolveIrregularPlaneRecord(record);
  if (!resolved) {
    return null;
  }
  const objType = typeof resolved.objType === "string" ? resolved.objType.trim().toLowerCase() : "";
  if (objType === "plane") {
    return createPlane(resolved, parent);
  }
  if (objType === "buffermesh") {
    return createBufferMesh(resolved, parent);
  }
  return createShapePlane(resolved, parent);
}

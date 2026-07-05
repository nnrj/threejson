import { createBufferMesh } from "./bufferMeshBuilder.js";
import { createShapeExtrude } from "./shapeExtrudeBuilder.js";
import { resolveIrregularGeometryRecord } from "./irregularShapeResolver.js";

export { resolveIrregularGeometryRecord } from "./irregularShapeResolver.js";

/**
 * @param {object} record
 * @param {import("three").Object3D} parent
 * @returns {import("three").Mesh|null}
 */
export function createIrregularGeometry(record, parent) {
  const resolved = resolveIrregularGeometryRecord(record);
  if (!resolved) {
    return null;
  }
  const objType = typeof resolved.objType === "string" ? resolved.objType.trim().toLowerCase() : "";
  if (objType === "buffermesh") {
    return createBufferMesh(resolved, parent);
  }
  return createShapeExtrude(resolved, parent);
}

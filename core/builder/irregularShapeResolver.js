import { log } from "../util/logger.js";
function normalizePlaneKind(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "shape";
}

function normalizeGeometryKind(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "shapeextrude";
}

/**
 * @param {object} record
 * @returns {object|null}
 */
export function resolveIrregularPlaneRecord(record) {
  if (!record || typeof record !== "object") {
    return record;
  }
  const kind = normalizePlaneKind(record.planeKind);
  if (kind === "rect") {
    return {
      ...record,
      objType: "plane",
      geometry: record.geometry && typeof record.geometry === "object"
        ? record.geometry
        : {
          width: record.width,
          height: record.height
        },
      material: record.material
    };
  }
  if (kind === "mesh") {
    return {
      ...record,
      objType: "bufferMesh",
      geometry: record.geometry
    };
  }
  if (kind === "csg") {
    log.warn("[irregularPlane] planeKind csg is not implemented; use shape.holes or lab roadmap");
    return null;
  }
  return {
    ...record,
    objType: "shapePlane",
    shape: record.shape,
    curveSegments: record.curveSegments,
    parallelTo: record.parallelTo,
    rotation: record.rotation,
    shapeValidation: record.shapeValidation
  };
}

/**
 * @param {object} record
 * @returns {object|null}
 */
export function resolveIrregularGeometryRecord(record) {
  if (!record || typeof record !== "object") {
    return record;
  }
  const kind = normalizeGeometryKind(record.geometryKind);
  if (kind === "mesh") {
    return {
      ...record,
      objType: "bufferMesh",
      geometry: record.geometry
    };
  }
  if (kind === "csg") {
    log.warn("[irregularGeometry] geometryKind csg is not implemented; see lab roadmap");
    return null;
  }
  return {
    ...record,
    objType: "shapeExtrude",
    shape: record.shape,
    extrude: record.extrude ?? record.shape?.extrude,
    parallelTo: record.parallelTo,
    rotation: record.rotation,
    shapeValidation: record.shapeValidation
  };
}

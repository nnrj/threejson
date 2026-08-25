/**
 * ShapeGeometry irregular plane.
 */
import * as THREE from "three";
import { log } from "../util/logger.js";
import { trackDisposableResource } from "../handler/trackedResourceRegistry.js";
import { registerObject } from "../handler/objectRegistry.js";
import { setUserDataObjJson } from "../handler/objectDescriptorAttach.js";
import { applyVisibilityFromDescriptor } from "../util/util.js";
import {
  buildThreeShapeFromDef,
  validateShapeDefinition
} from "./shapeGeometryUtil.js";
import { applyParallelToOrRotation } from "./shapeTransformUtil.js";
import { createMaterialFromDescriptor } from "./material/materialFactory.js";

function hasValue(value) {
  return value !== undefined && value !== null;
}

function buildShapePlaneMaterial(record) {
  const materialInfo = record?.material && typeof record.material === "object" ? record.material : {};
  const mat = createMaterialFromDescriptor({ side: "double", ...materialInfo }, {
    fallbackType: "standard",
    defaultColor: "#cccccc"
  });
  trackDisposableResource(mat);
  return mat;
}

/**
 * @param {object} record
 * @param {import("three").Object3D} parent
 * @returns {import("three").Mesh|null}
 */
export function createShapePlane(record, parent) {
  if (!record || !parent) {
    return null;
  }
  const shapeDef = record.shape && typeof record.shape === "object" ? record.shape : record;
  const validation = validateShapeDefinition(shapeDef, record);
  if (!validation.ok) {
    log.warn("[shapePlane]", validation.code || "invalid shape", record?.name || "");
    return null;
  }
  if (validation.warn) {
    log.warn("[shapePlane]", validation.code || "shape warning", record?.name || "");
  }

  const shape = buildThreeShapeFromDef(THREE, shapeDef);
  if (!shape) {
    log.warn("[shapePlane] E_SHAPE_CONTOUR_INVALID:", record?.name || "");
    return null;
  }

  const curveSegments = Math.max(1, Math.floor(Number(hasValue(record.curveSegments) ? record.curveSegments : 12)));
  const geometry = new THREE.ShapeGeometry(shape, curveSegments);
  trackDisposableResource(geometry);

  const mesh = new THREE.Mesh(geometry, buildShapePlaneMaterial(record));
  trackDisposableResource(mesh);
  applyParallelToOrRotation(mesh, record);
  applyVisibilityFromDescriptor(mesh, record);
  if (record.name) {
    mesh.name = record.name;
  }
  const payload = { ...record, objType: record.objType || "shapePlane" };
  setUserDataObjJson(mesh, payload);
  parent.add(mesh);
  registerObject(mesh, payload);
  return mesh;
}

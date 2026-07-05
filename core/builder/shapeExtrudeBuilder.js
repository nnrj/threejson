/**
 * ExtrudeGeometry irregular solid.
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

function hasValue(value) {
  return value !== undefined && value !== null;
}

function buildExtrudeMaterial(record) {
  const materialInfo = record?.material && typeof record.material === "object" ? record.material : {};
  const color = hasValue(materialInfo.color) ? materialInfo.color : "#dcdfe6";
  const opacity = Number(hasValue(materialInfo.opacity) ? materialInfo.opacity : 1);
  const transparent = Boolean(hasValue(materialInfo.transparent) ? materialInfo.transparent : opacity < 1);
  const mat = new THREE.MeshStandardMaterial({
    color,
    transparent,
    opacity,
    metalness: Number(hasValue(materialInfo.metalness) ? materialInfo.metalness : 0.1),
    roughness: Number(hasValue(materialInfo.roughness) ? materialInfo.roughness : 0.6)
  });
  trackDisposableResource(mat);
  return mat;
}

function resolveExtrudeSettings(record) {
  const extrude = record?.extrude && typeof record.extrude === "object"
    ? record.extrude
    : record?.shape?.extrude && typeof record.shape.extrude === "object"
      ? record.shape.extrude
      : {};
  return {
    depth: Number(hasValue(extrude.depth) ? extrude.depth : 1),
    bevelEnabled: extrude.bevelEnabled === true,
    bevelThickness: Number(hasValue(extrude.bevelThickness) ? extrude.bevelThickness : 1),
    bevelSize: Number(hasValue(extrude.bevelSize) ? extrude.bevelSize : 1),
    curveSegments: Math.max(1, Math.floor(Number(hasValue(extrude.curveSegments) ? extrude.curveSegments : 12)))
  };
}

/**
 * @param {object} record
 * @param {import("three").Object3D} parent
 * @returns {import("three").Mesh|null}
 */
export function createShapeExtrude(record, parent) {
  if (!record || !parent) {
    return null;
  }
  const shapeDef = record.shape && typeof record.shape === "object" ? record.shape : record;
  const validation = validateShapeDefinition(shapeDef, record);
  if (!validation.ok) {
    log.warn("[shapeExtrude]", validation.code || "invalid shape", record?.name || "");
    return null;
  }
  if (validation.warn) {
    log.warn("[shapeExtrude]", validation.code || "shape warning", record?.name || "");
  }

  const shape = buildThreeShapeFromDef(THREE, shapeDef);
  if (!shape) {
    log.warn("[shapeExtrude] E_SHAPE_CONTOUR_INVALID:", record?.name || "");
    return null;
  }

  const extrudeSettings = resolveExtrudeSettings(record);
  const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  geometry.computeVertexNormals();
  trackDisposableResource(geometry);

  const mesh = new THREE.Mesh(geometry, buildExtrudeMaterial(record));
  trackDisposableResource(mesh);
  applyParallelToOrRotation(mesh, record);
  applyVisibilityFromDescriptor(mesh, record);
  if (record.name) {
    mesh.name = record.name;
  }
  const payload = { ...record, objType: record.objType || "shapeExtrude" };
  setUserDataObjJson(mesh, payload);
  parent.add(mesh);
  registerObject(mesh, payload);
  return mesh;
}

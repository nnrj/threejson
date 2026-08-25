/**
 * TubeGeometry tube (path + radius).
 */
import * as THREE from "three";
import { trackDisposableResource } from "../handler/trackedResourceRegistry.js";
import { registerObject } from "../handler/objectRegistry.js";
import { setUserDataObjJson } from "../handler/objectDescriptorAttach.js";
import { applyVisibilityFromDescriptor } from "../util/util.js";
import { buildCurveFromPathDef } from "../util/tubePath.js";
import { resolvePosition, resolveRotation, resolveScale } from "../util/vectorValue.js";
import { createMaterialFromDescriptor } from "./material/materialFactory.js";

function hasValue(value) {
  return value !== undefined && value !== null;
}

function valueOr(value, fallback) {
  return hasValue(value) ? value : fallback;
}

function normalizePosition(position = {}) {
  return resolvePosition(position);
}

function normalizeRotation(rotation = {}) {
  return resolveRotation(rotation);
}

function normalizeScale(scale = {}) {
  return resolveScale(scale);
}

function applyMeshTransform(mesh, record) {
  const position = normalizePosition(record.position);
  const rotation = normalizeRotation(record.rotation);
  const scale = normalizeScale(record.scale);
  mesh.position.set(position.x, position.y, position.z);
  mesh.rotation.set(rotation.x, rotation.y, rotation.z);
  mesh.scale.set(scale.x, scale.y, scale.z);
  applyVisibilityFromDescriptor(mesh, record);
}

function buildTubeMaterial(record) {
  const materialInfo = record?.material && typeof record.material === "object" ? record.material : {};
  // Tubes default to double-sided because Frenet-frame twisting can otherwise
  // make sections disappear, but an authored side remains authoritative.
  const descriptor = { side: "double", ...materialInfo };
  const mat = createMaterialFromDescriptor(descriptor, {
    fallbackType: "standard",
    defaultColor: "#67c23a"
  });
  trackDisposableResource(mat);
  return mat;
}

/**
 * @param {object} record
 * @returns {THREE.BufferGeometry|null}
 */
export function buildTubeGeometry(record) {
  const pathDef = record?.path ?? record?.curve;
  const curve = buildCurveFromPathDef(pathDef, THREE);
  if (!curve) {
    return null;
  }
  const geoInfo = record?.geometry && typeof record.geometry === "object" ? record.geometry : {};
  const radius = Number(valueOr(geoInfo.radius, valueOr(record.radius, 2)));
  const tubularSegments = Math.max(2, Math.floor(Number(valueOr(geoInfo.tubularSegments, 64))));
  const radialSegments = Math.max(3, Math.floor(Number(valueOr(geoInfo.radialSegments, 8))));
  const closed = Boolean(pathDef?.closed);
  const geometry = new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, closed);
  geometry.computeVertexNormals();
  trackDisposableResource(geometry);
  return geometry;
}

/**
 * @param {object} record
 * @param {THREE.Scene} scene
 * @returns {THREE.Mesh|null}
 */
export function createTube(record, scene) {
  if (!record || !scene) {
    return null;
  }
  const geometry = buildTubeGeometry(record);
  if (!geometry) {
    const error = new Error(`Tube requires a valid path: ${record?.name || "(unnamed)"}`);
    error.code = "E_CURVE_DESCRIPTOR_INVALID";
    throw error;
  }
  const mesh = new THREE.Mesh(geometry, buildTubeMaterial(record));
  trackDisposableResource(mesh);
  mesh.name = typeof record?.name === "string" && record.name.length ? record.name : "newTube";
  record.objType = "tube";
  setUserDataObjJson(mesh, record);
  applyMeshTransform(mesh, record);
  scene.add(mesh);
  return registerObject(mesh, record);
}

export function deployTube(record, scene) {
  return createTube(record, scene);
}

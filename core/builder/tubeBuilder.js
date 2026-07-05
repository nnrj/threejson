/**
 * TubeGeometry tube (path + radius).
 */
import * as THREE from "three";
import { log } from "../util/logger.js";
import { trackDisposableResource } from "../handler/trackedResourceRegistry.js";
import { registerObject } from "../handler/objectRegistry.js";
import { setUserDataObjJson } from "../handler/objectDescriptorAttach.js";
import { applyVisibilityFromDescriptor } from "../util/util.js";
import { buildCurveFromPathDef } from "../util/tubePath.js";

function hasValue(value) {
  return value !== undefined && value !== null;
}

function valueOr(value, fallback) {
  return hasValue(value) ? value : fallback;
}

function normalizePosition(position = {}) {
  return {
    x: Number(valueOr(position.x, 0)),
    y: Number(valueOr(position.y, 0)),
    z: Number(valueOr(position.z, 0))
  };
}

function normalizeRotation(rotation = {}) {
  return {
    rotationX: Number(valueOr(rotation.rotationX, 0)),
    rotationY: Number(valueOr(rotation.rotationY, 0)),
    rotationZ: Number(valueOr(rotation.rotationZ, 0))
  };
}

function normalizeScale(scale = {}) {
  return {
    scaleX: Number(valueOr(scale.scaleX, 1)),
    scaleY: Number(valueOr(scale.scaleY, 1)),
    scaleZ: Number(valueOr(scale.scaleZ, 1))
  };
}

function applyMeshTransform(mesh, record) {
  const position = normalizePosition(record.position);
  const rotation = normalizeRotation(record.rotation);
  const scale = normalizeScale(record.scale);
  mesh.position.set(position.x, position.y, position.z);
  mesh.rotation.set(rotation.rotationX, rotation.rotationY, rotation.rotationZ);
  mesh.scale.set(scale.scaleX, scale.scaleY, scale.scaleZ);
  applyVisibilityFromDescriptor(mesh, record);
}

function resolveMaterialSide(materialInfo) {
  const raw = materialInfo?.side;
  if (raw === undefined || raw === null || raw === "") {
    // TubeGeometry Frenet frames along the curve may twist; single-sided culling can show only half the tube wall from one side
    return THREE.DoubleSide;
  }
  const side = String(raw).trim().toLowerCase();
  if (side === "front") {
    return THREE.FrontSide;
  }
  if (side === "back") {
    return THREE.BackSide;
  }
  return THREE.DoubleSide;
}

function buildTubeMaterial(record) {
  const materialInfo = record?.material && typeof record.material === "object" ? record.material : {};
  const type = typeof materialInfo.type === "string" ? materialInfo.type.trim().toLowerCase() : "standard";
  const color = hasValue(materialInfo.color) ? materialInfo.color : "#67c23a";
  const opacity = Number(valueOr(materialInfo.opacity, 1));
  const transparent = Boolean(valueOr(materialInfo.transparent, opacity < 1));
  const side = resolveMaterialSide(materialInfo);
  if (type === "basic") {
    const mat = new THREE.MeshBasicMaterial({ color, transparent, opacity, side });
    trackDisposableResource(mat);
    return mat;
  }
  const mat = new THREE.MeshStandardMaterial({
    color,
    transparent,
    opacity,
    side,
    metalness: Number(valueOr(materialInfo.metalness, 0.1)),
    roughness: Number(valueOr(materialInfo.roughness, 0.6))
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
    log.warn("[createTube] invalid path:", record?.name || "");
    return null;
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

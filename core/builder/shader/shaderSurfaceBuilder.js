/**
 * objType shaderSurface: geometry + shaderPreset → Mesh added to scene.
 */
import * as THREE from "three";
import { log } from "../../util/logger.js";
import { trackDisposableResource } from "../../handler/trackedResourceRegistry.js";
import { registerObject } from "../../handler/objectRegistry.js";
import { setUserDataObjJson } from "../../handler/objectDescriptorAttach.js";
import { applyVisibilityFromDescriptor } from "../../util/util.js";
import { applyParallelToOrRotation } from "../shapeTransformUtil.js";
import {
  createShaderMaterialFromPreset,
  resolveShaderPresetIdFromDescriptor
} from "./shaderPresetRegistry.js";
import { trackShaderMaterial } from "./shaderMotion.js";

function hasValue(value) {
  return value !== undefined && value !== null;
}

/**
 * @param {object} record
 * @returns {string}
 */
function normalizeSurfaceKind(record) {
  const raw = typeof record?.surface === "string" ? record.surface.trim().toLowerCase() : "plane";
  if (raw === "sphere" || raw === "box") {
    return raw;
  }
  return "plane";
}

/**
 * @param {string} surface
 * @param {object} geometryInfo
 * @returns {import("three").BufferGeometry}
 */
function buildSurfaceGeometry(surface, geometryInfo = {}) {
  const gi = geometryInfo && typeof geometryInfo === "object" ? geometryInfo : {};
  if (surface === "sphere") {
    const radius = Number(hasValue(gi.radius) ? gi.radius : hasValue(gi.width) ? gi.width * 0.5 : 1);
    const widthSegments = Math.max(3, Math.floor(Number(hasValue(gi.widthSegments) ? gi.widthSegments : 32)));
    const heightSegments = Math.max(2, Math.floor(Number(hasValue(gi.heightSegments) ? gi.heightSegments : 16)));
    const geometry = new THREE.SphereGeometry(radius, widthSegments, heightSegments);
    trackDisposableResource(geometry);
    return geometry;
  }
  if (surface === "box") {
    const geometry = new THREE.BoxGeometry(
      Number(hasValue(gi.width) ? gi.width : 1),
      Number(hasValue(gi.height) ? gi.height : 1),
      Number(hasValue(gi.depth) ? gi.depth : 1)
    );
    trackDisposableResource(geometry);
    return geometry;
  }
  const widthSegs = Math.max(
    1,
    Math.floor(Number(hasValue(gi.widthSegments) ? gi.widthSegments : hasValue(gi.segments) ? gi.segments : 1))
  );
  const heightSegs = Math.max(
    1,
    Math.floor(Number(hasValue(gi.heightSegments) ? gi.heightSegments : hasValue(gi.segments) ? gi.segments : 1))
  );
  const geometry = new THREE.PlaneGeometry(
    Number(hasValue(gi.width) ? gi.width : 1),
    Number(hasValue(gi.height) ? gi.height : 1),
    widthSegs,
    heightSegs
  );
  trackDisposableResource(geometry);
  return geometry;
}

/**
 * @param {object} record
 * @param {import("three").Scene|import("three").Object3D} scene
 * @param {object} [ctx={}]
 * @returns {import("three").Mesh|null}
 */
export function deployShaderSurface(record, scene, ctx = {}) {
  if (!record || !scene) {
    return null;
  }
  const presetId = resolveShaderPresetIdFromDescriptor(record);
  if (!presetId) {
    log.warn("[shaderSurface] shaderPreset is required:", record?.name || "");
    return null;
  }
  const material = createShaderMaterialFromPreset(presetId, record, ctx);
  if (!material) {
    return null;
  }
  trackDisposableResource(material);

  const surface = normalizeSurfaceKind(record);
  const geometry = buildSurfaceGeometry(surface, record.geometry);
  const mesh = new THREE.Mesh(geometry, material);
  trackDisposableResource(mesh);

  applyParallelToOrRotation(mesh, record);
  const payload = {
    ...record,
    objType: record.objType || "shaderSurface",
    surface,
    shaderPreset: presetId
  };
  setUserDataObjJson(mesh, payload);
  applyVisibilityFromDescriptor(mesh, payload);
  if (record.name) {
    mesh.name = record.name;
  }

  if (material.transparent && material.side === THREE.DoubleSide) {
    material.forceSinglePass = true;
  }

  scene.add(mesh);
  trackShaderMaterial(material, presetId, mesh);
  registerObject(mesh, payload);
  return mesh;
}

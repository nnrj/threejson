/**
 * THREE.Points point cloud / particles: BufferGeometry from JSON positions or count+bounds.
 */
import * as THREE from "three";
import { log } from "../util/logger.js";
import { loadingManager } from "../cache/loading.js";
import { trackDisposableResource } from "../handler/trackedResourceRegistry.js";
import { registerObject } from "../handler/objectRegistry.js";
import { setUserDataObjJson } from "../handler/objectDescriptorAttach.js";
import { applyVisibilityFromDescriptor } from "../util/util.js";
import { setupPointsMotion } from "./pointsMotion.js";

const textureLoader = new THREE.TextureLoader(loadingManager);
trackDisposableResource(textureLoader);

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

function applyObjectTransform(object3D, source = {}) {
  const position = normalizePosition(source.position);
  const rotation = normalizeRotation(source.rotation);
  const scale = normalizeScale(source.scale);
  object3D.position.set(position.x, position.y, position.z);
  object3D.rotation.set(rotation.rotationX, rotation.rotationY, rotation.rotationZ);
  object3D.scale.set(scale.scaleX, scale.scaleY, scale.scaleZ);
  applyVisibilityFromDescriptor(object3D, source);
}

function materialMapStringResolvableAsUrl(mapStr) {
  const s = typeof mapStr === "string" ? mapStr.trim() : "";
  if (!s.length) {
    return false;
  }
  return (
    /^data:/i.test(s)
    || /^https?:\/\//i.test(s)
    || s.startsWith("//")
    || s.startsWith("/")
    || /^\.{1,2}\//.test(s)
  );
}

function resolveTextureUrl(material = {}) {
  const map = material.map ?? material.textureUrl ?? material.url;
  return typeof map === "string" ? map.trim() : "";
}

function applyPointsTextureWhenLoaded(points, record, url) {
  textureLoader.load(
    url,
    (texture) => {
      trackDisposableResource(texture);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      const mat = points.material;
      if (mat && mat.isPointsMaterial) {
        mat.map = texture;
        mat.transparent = true;
        mat.depthWrite = false;
        mat.needsUpdate = true;
      }
    },
    undefined,
    (err) => {
      log.warn("[createPoints] texture load failed:", url, err);
    }
  );
}

/**
 * @param {object} record
 * @returns {number}
 */
export function resolvePointsCount(record) {
  const explicit = Array.isArray(record?.positions) ? record.positions.length : 0;
  if (explicit > 0) {
    return explicit;
  }
  const count = Number(record?.count);
  if (Number.isFinite(count) && count > 0) {
    return Math.min(Math.floor(count), 500000);
  }
  return 0;
}

/**
 * @param {unknown} positions
 * @returns {Float32Array|null}
 */
export function buildPositionsFromExplicitArray(positions) {
  if (!Array.isArray(positions) || positions.length === 0) {
    return null;
  }
  const out = new Float32Array(positions.length * 3);
  let valid = 0;
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    if (Array.isArray(p) && p.length >= 3) {
      const o = valid * 3;
      out[o] = Number(p[0]) || 0;
      out[o + 1] = Number(p[1]) || 0;
      out[o + 2] = Number(p[2]) || 0;
      valid++;
      continue;
    }
    if (p && typeof p === "object") {
      const o = valid * 3;
      out[o] = Number(p.x) || 0;
      out[o + 1] = Number(p.y) || 0;
      out[o + 2] = Number(p.z) || 0;
      valid++;
    }
  }
  if (valid === 0) {
    return null;
  }
  if (valid === positions.length) {
    return out;
  }
  return out.subarray(0, valid * 3);
}

/**
 * @param {object} record
 * @returns {Float32Array|null}
 */
export function buildPositionsFloat32Array(record) {
  const fromExplicit = buildPositionsFromExplicitArray(record?.positions);
  if (fromExplicit) {
    return fromExplicit;
  }
  const count = resolvePointsCount(record);
  if (count <= 0) {
    return null;
  }
  const bounds = record?.bounds && typeof record.bounds === "object"
    ? record.bounds
    : record?.geometry && typeof record.geometry === "object"
      ? record.geometry
      : {};
  const halfW = Number(valueOr(bounds.width, 100)) / 2;
  const halfH = Number(valueOr(bounds.height, 100)) / 2;
  const halfD = Number(valueOr(bounds.depth, 100)) / 2;
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    out[o] = (Math.random() * 2 - 1) * halfW;
    out[o + 1] = (Math.random() * 2 - 1) * halfH;
    out[o + 2] = (Math.random() * 2 - 1) * halfD;
  }
  return out;
}

/**
 * @param {object} record
 * @returns {Float32Array|null}
 */
export function buildPointColorsFloat32Array(record) {
  const colors = record?.colors;
  if (!Array.isArray(colors) || colors.length === 0) {
    return null;
  }
  const positions = buildPositionsFloat32Array(record);
  if (!positions) {
    return null;
  }
  const pointCount = positions.length / 3;
  const out = new Float32Array(pointCount * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < pointCount; i++) {
    const c = colors[Math.min(i, colors.length - 1)];
    if (typeof c === "string") {
      tmp.set(c);
    } else if (Array.isArray(c) && c.length >= 3) {
      tmp.setRGB(
        Math.min(1, Math.max(0, Number(c[0]) || 0)),
        Math.min(1, Math.max(0, Number(c[1]) || 0)),
        Math.min(1, Math.max(0, Number(c[2]) || 0))
      );
    } else if (c && typeof c === "object") {
      tmp.setRGB(
        Math.min(1, Math.max(0, Number(c.r) ?? 1)),
        Math.min(1, Math.max(0, Number(c.g) ?? 1)),
        Math.min(1, Math.max(0, Number(c.b) ?? 1))
      );
    } else {
      tmp.set("#ffffff");
    }
    const o = i * 3;
    out[o] = tmp.r;
    out[o + 1] = tmp.g;
    out[o + 2] = tmp.b;
  }
  return out;
}

/**
 * @param {string} mode
 * @returns {number}
 */
export function resolvePointsBlending(mode) {
  const s = typeof mode === "string" ? mode.trim().toLowerCase() : "";
  if (s === "additive") {
    return THREE.AdditiveBlending;
  }
  if (s === "subtractive") {
    return THREE.SubtractiveBlending;
  }
  if (s === "multiply") {
    return THREE.MultiplyBlending;
  }
  return THREE.NormalBlending;
}

/**
 * @param {object} record
 * @param {THREE.Texture} [map]
 * @returns {THREE.PointsMaterial}
 */
export function buildPointsMaterial(record, map) {
  const materialInfo = record?.material && typeof record.material === "object" ? record.material : {};
  const params = {
    size: Number(valueOr(materialInfo.size, 4)),
    sizeAttenuation: valueOr(materialInfo.sizeAttenuation, true) !== false,
    transparent: Boolean(valueOr(materialInfo.transparent, Boolean(map))),
    opacity: Number(valueOr(materialInfo.opacity, 1)),
    depthWrite: valueOr(materialInfo.depthWrite, !materialInfo.transparent && !map),
    blending: resolvePointsBlending(materialInfo.blending)
  };
  if (hasValue(materialInfo.color)) {
    params.color = new THREE.Color(materialInfo.color);
  }
  if (map) {
    params.map = map;
    params.transparent = true;
    if (!hasValue(materialInfo.depthWrite)) {
      params.depthWrite = false;
    }
  }
  const mat = new THREE.PointsMaterial(params);
  trackDisposableResource(mat);
  return mat;
}

/**
 * @param {object} record
 * @returns {THREE.BufferGeometry|null}
 */
export function buildPointsGeometry(record) {
  const positions = buildPositionsFloat32Array(record);
  if (!positions || positions.length < 3) {
    return null;
  }
  const geometry = new THREE.BufferGeometry();
  trackDisposableResource(geometry);
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const colors = buildPointColorsFloat32Array(record);
  if (colors) {
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }
  return geometry;
}

/**
 * @param {object} record
 * @param {THREE.Scene} scene
 * @param {THREE.Texture} [map]
 * @returns {THREE.Points|null}
 */
export function finishPointsObject(record, scene, map) {
  const geometry = buildPointsGeometry(record);
  if (!geometry) {
    log.warn("[createPoints] no valid positions or count:", record?.name || "");
    return null;
  }
  const material = buildPointsMaterial(record, map);
  if (geometry.getAttribute("color")) {
    material.vertexColors = true;
  }
  const points = new THREE.Points(geometry, material);
  trackDisposableResource(points);
  points.name = typeof record?.name === "string" && record.name.length ? record.name : "newPoints";
  record.objType = "points";
  setUserDataObjJson(points, record);
  applyObjectTransform(points, record);
  scene.add(points);
  setupPointsMotion(points, record);
  return registerObject(points, record);
}

/**
 * @param {object} record
 * @param {THREE.Scene} scene
 * @returns {THREE.Points|null}
 */
export function createPoints(record, scene) {
  if (!record || !scene) {
    return null;
  }
  const texUrl = resolveTextureUrl(record.material || {});
  const points = finishPointsObject(record, scene);
  if (!points) {
    return null;
  }
  if (texUrl && materialMapStringResolvableAsUrl(texUrl)) {
    applyPointsTextureWhenLoaded(points, record, texUrl);
  }
  return points;
}

/**
 * @param {object} record
 * @param {THREE.Scene} scene
 * @returns {THREE.Points|null}
 */
export function deployPoints(record, scene) {
  return createPoints(record, scene);
}

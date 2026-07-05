/**
 * objType:text shared field parsing and transform application.
 */
import * as THREE from "three";

import { applyVisibilityFromDescriptor } from "../../util/util.js";

const TEXT_MODES = new Set(["texture", "sdf", "mesh"]);

const DEFAULTS = {
  content: "",
  mode: "sdf",
  fontFamily: "SimHei, sans-serif",
  fontSize: 0.25,
  color: "#ffffff",
  align: "left",
  anchor: { x: 0.5, y: 0.5 },
  letterSpacing: 0,
  billboard: false
};

function hasValue(value) {
  return value !== undefined && value !== null;
}

function valueOr(value, fallback) {
  return hasValue(value) ? value : fallback;
}

function numberBetween(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, n));
}

function normalizeObjType(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * @param {object} [record]
 * @returns {"texture"|"sdf"|"mesh"}
 */
export function resolveTextMode(record) {
  const raw = normalizeObjType(record?.mode);
  if (TEXT_MODES.has(raw)) {
    return raw;
  }
  return DEFAULTS.mode;
}

/**
 * @param {object} [record]
 * @returns {object}
 */
export function resolveTextRecord(record = {}) {
  const anchorSrc = record.anchor && typeof record.anchor === "object" ? record.anchor : {};
  const alignRaw = typeof record.align === "string" ? record.align.trim().toLowerCase() : DEFAULTS.align;
  const align = alignRaw === "center" || alignRaw === "right" ? alignRaw : "left";

  return {
    content: hasValue(record.content) ? String(record.content) : DEFAULTS.content,
    mode: resolveTextMode(record),
    fontFamily:
      typeof record.fontFamily === "string" && record.fontFamily.trim()
        ? record.fontFamily.trim()
        : DEFAULTS.fontFamily,
    fontSize: numberBetween(record.fontSize, DEFAULTS.fontSize, 0.01, 512),
    color:
      typeof record.color === "string" && record.color.trim()
        ? record.color.trim()
        : DEFAULTS.color,
    align,
    anchor: {
      x: numberBetween(anchorSrc.x, DEFAULTS.anchor.x, 0, 1),
      y: numberBetween(anchorSrc.y, DEFAULTS.anchor.y, 0, 1)
    },
    maxWidth: hasValue(record.maxWidth) ? numberBetween(record.maxWidth, record.maxWidth, 0.1, 4096) : null,
    lineHeight: hasValue(record.lineHeight) ? numberBetween(record.lineHeight, record.lineHeight, 0.5, 8) : null,
    letterSpacing: numberBetween(record.letterSpacing, DEFAULTS.letterSpacing, -1, 4),
    billboard: record.billboard === true,
    texture: record.texture && typeof record.texture === "object" ? { ...record.texture } : {},
    sdf: record.sdf && typeof record.sdf === "object" ? { ...record.sdf } : {},
    mesh: record.mesh && typeof record.mesh === "object" ? { ...record.mesh } : {},
    name: typeof record.name === "string" && record.name.trim() ? record.name.trim() : "text",
    position: record.position,
    rotation: record.rotation,
    scale: record.scale,
    visible: record.visible
  };
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

/**
 * @param {import("three").Object3D} object3D
 * @param {object} record
 */
export function applyTextTransform(object3D, record) {
  const position = normalizePosition(record?.position);
  const rotation = normalizeRotation(record?.rotation);
  const scale = normalizeScale(record?.scale);
  object3D.position.set(position.x, position.y, position.z);
  object3D.rotation.set(rotation.rotationX, rotation.rotationY, rotation.rotationZ);
  object3D.scale.set(scale.scaleX, scale.scaleY, scale.scaleZ);
  applyVisibilityFromDescriptor(object3D, record);
}

/**
 * @param {{ x: number, y: number }} anchor
 * @returns {{ anchorX: string, anchorY: string }}
 */
export function anchorToTroikaPercents(anchor) {
  const x = numberBetween(anchor?.x, 0.5, 0, 1);
  const y = numberBetween(anchor?.y, 0.5, 0, 1);
  return {
    anchorX: `${Math.round(x * 100)}%`,
    anchorY: `${Math.round(y * 100)}%`
  };
}

/**
 * @param {import("three").Object3D} object3D
 * @param {boolean} enabled
 */
export function attachBillboardBehavior(object3D, enabled) {
  if (!enabled || !object3D) {
    return;
  }
  const previous = object3D.onBeforeRender;
  object3D.onBeforeRender = function onBeforeRenderBillboard(renderer, scene, camera, geometry, material, group) {
    if (typeof previous === "function") {
      previous.call(this, renderer, scene, camera, geometry, material, group);
    }
    if (camera) {
      this.quaternion.copy(camera.quaternion);
    }
  };
}

/**
 * troika Text has its own onBeforeRender; billboard wraps in Group to avoid overriding its material hook.
 * @param {import("three").Object3D} textObject
 * @param {object} record
 * @param {string} name
 * @returns {import("three").Object3D}
 */
export function wrapTextForBillboard(textObject, record, name) {
  const root = new THREE.Group();
  root.name = name;
  applyTextTransform(root, record);
  attachBillboardBehavior(root, true);
  textObject.position.set(0, 0, 0);
  textObject.rotation.set(0, 0, 0);
  textObject.scale.set(1, 1, 1);
  root.add(textObject);
  return root;
}

/**
 * Whether the scene contains text requiring troika SDF (for lazy load and font warmup).
 * @param {object} [sceneConfig]
 * @param {object[]} [objectList]
 * @returns {boolean}
 */
export function sceneNeedsSdfText(sceneConfig, objectList = []) {
  const sceneFont = sceneConfig?.textFont;
  const preloadCharacters =
    sceneFont && typeof sceneFont.preloadCharacters === "string"
      ? sceneFont.preloadCharacters
      : "";
  if (preloadCharacters.length > 0) {
    return true;
  }
  if (!Array.isArray(objectList)) {
    return false;
  }
  for (const rec of objectList) {
    if (!rec || typeof rec !== "object") {
      continue;
    }
    if (normalizeObjType(rec.objType) !== "text") {
      continue;
    }
    if (resolveTextMode(rec) === "sdf") {
      return true;
    }
  }
  return false;
}

export { hasValue, valueOr, numberBetween, normalizeObjType };

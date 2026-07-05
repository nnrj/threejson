/**
 * weather domain strip wind presets → core `createPlane` records (Plane + texture UV scroll).
 */

import { assetUrl } from "../../assets/assetsBase.js";
import { applyWindVisualScale } from "./windRecordNormalize.js";

const SKIP_MERGE_KEYS = new Set(["domain", "handler", "objType", "options", "payload", "items"]);

/** @type {Record<string, object>} */
export const WIND_HANDLER_PRESETS = {
  wind: {
    name: "weather-wind",
    objType: "wind",
    speed: 1,
    geometry: { width: 4, height: 20 },
    position: { x: 0, y: 10, z: 0 },
    rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
    material: {
      textureUrl: assetUrl("textures/environment/nature/weather/wind_cold_left.png"),
      textureRepeat: { x: 0.1, y: 13 },
      transparent: true,
      opacity: 0.85,
      side: "double"
    }
  },
  coldwind: {
    name: "weather-cold-wind",
    objType: "wind",
    speed: 1,
    geometry: { width: 4, height: 20 },
    position: { x: 0, y: 10, z: 0 },
    rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
    material: {
      textureUrl: assetUrl("textures/environment/nature/weather/wind_cold_left.png"),
      textureRepeat: { x: 0.1, y: 13 },
      transparent: true,
      opacity: 0.85,
      side: "double"
    }
  },
  hotwind: {
    name: "weather-hot-wind",
    objType: "wind",
    speed: 1,
    geometry: { width: 4, height: 20 },
    position: { x: 0, y: 10, z: 0 },
    rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
    material: {
      textureUrl: assetUrl("textures/environment/nature/weather/wind_hot_left.png"),
      textureRepeat: { x: 0.1, y: 13 },
      transparent: true,
      opacity: 0.85,
      side: "double"
    }
  }
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergePlain(target, source) {
  const next = { ...target };
  if (!isPlainObject(source)) {
    return next;
  }
  for (const key of Object.keys(source)) {
    if (SKIP_MERGE_KEYS.has(key)) {
      continue;
    }
    const sv = source[key];
    const tv = next[key];
    if (isPlainObject(tv) && isPlainObject(sv)) {
      next[key] = mergePlain(tv, sv);
    } else {
      next[key] = sv;
    }
  }
  return next;
}

/**
 * @param {string} handler
 * @returns {string}
 */
function normalizeWindHandlerKey(handler) {
  if (typeof handler !== "string") {
    return "";
  }
  const key = handler.trim().toLowerCase();
  if (key === "coldwind" || key === "cold_wind") {
    return "coldwind";
  }
  if (key === "hotwind" || key === "hot_wind") {
    return "hotwind";
  }
  if (key === "wind" || key === "windstrip" || key === "wind_strip") {
    return "wind";
  }
  if (key.includes("wind_hot")) {
    return "hotwind";
  }
  if (key.includes("wind_cold")) {
    return "coldwind";
  }
  return key;
}

/**
 * @param {object} record
 * @returns {string}
 */
export function resolveWindHandlerFromRecord(record) {
  if (record?.handler) {
    const fromHandler = normalizeWindHandlerKey(record.handler);
    if (WIND_HANDLER_PRESETS[fromHandler]) {
      return fromHandler;
    }
  }
  const ot = typeof record?.objType === "string" ? record.objType.trim().toLowerCase() : "";
  if (ot === "wind") {
    const url = String(record?.material?.textureUrl || "");
    if (url.includes("wind_hot")) {
      return "hotwind";
    }
    if (url.includes("wind_cold")) {
      return "coldwind";
    }
    return "wind";
  }
  return "";
}

/**
 * @param {string} handler
 * @param {object} [overrides]
 * @returns {object|null}
 */
export function buildWindPlaneRecord(handler, overrides = {}) {
  const key = normalizeWindHandlerKey(handler) || resolveWindHandlerFromRecord(overrides);
  const preset = WIND_HANDLER_PRESETS[key];
  if (!preset) {
    return null;
  }
  const merged = mergePlain(preset, overrides);
  merged.objType = "wind";
  merged.name = overrides.name || merged.name || `weather-${key}`;
  if (Number.isFinite(Number(overrides.speed))) {
    merged.speed = Number(overrides.speed);
  } else if (!Number.isFinite(Number(merged.speed))) {
    merged.speed = 1;
  }
  return applyWindVisualScale(merged);
}

/**
 * @param {string} handler
 * @returns {boolean}
 */
export function isWindHandler(handler) {
  const key = normalizeWindHandlerKey(handler);
  return Boolean(WIND_HANDLER_PRESETS[key]);
}

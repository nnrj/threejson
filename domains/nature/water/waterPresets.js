/**
 * nature.water presets → plane + shaderPreset ocean.
 */
import { applyWaterQualityToRecord, DEFAULT_WATER_QUALITY } from "./waterQuality.js";

/** @type {Record<string, object>} */
export const WATER_HANDLER_PRESETS = {
  ocean: {
    name: "water-ocean",
    objType: "waterSurface",
    handler: "ocean",
    shaderPreset: "ocean",
    quality: DEFAULT_WATER_QUALITY,
    surface: "plane",
    parallelTo: "xz",
    geometry: { width: 500, height: 500 },
    position: { x: 0, y: 0, z: 0 },
    uniforms: {
      quality: DEFAULT_WATER_QUALITY,
      waterColor: "#0a3d62",
      foamColor: "#a8dadc",
      opacity: 0.94,
      waveScale: 0.28,
      waveSpeed: 1.2,
      waveHeight: 0.38
    }
  },
  flow: {
    name: "water-flow",
    objType: "waterSurface",
    handler: "flow",
    shaderPreset: "ocean",
    quality: "low",
    surface: "plane",
    parallelTo: "xz",
    geometry: { width: 120, height: 40 },
    uniforms: {
      quality: "low",
      waterColor: "#0984e3",
      foamColor: "#dfe6e9",
      opacity: 0.88,
      waveScale: 0.8,
      waveSpeed: 2,
      waveHeight: 0.15
    }
  }
};

const SKIP_MERGE_KEYS = new Set(["domain", "handler", "objType", "options", "payload", "items"]);

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
function normalizeWaterHandlerKey(handler) {
  if (typeof handler !== "string") {
    return "";
  }
  const key = handler.trim().toLowerCase();
  if (key === "flow" || key === "river" || key === "stream") {
    return "flow";
  }
  if (key === "ocean" || key === "sea" || key === "water") {
    return "ocean";
  }
  return key;
}

/**
 * @param {string} handler
 * @returns {boolean}
 */
export function isWaterHandler(handler) {
  return Boolean(WATER_HANDLER_PRESETS[normalizeWaterHandlerKey(handler)]);
}

/**
 * @param {string} handler
 * @param {object} [overrides]
 * @returns {object|null}
 */
export function buildWaterSurfaceRecord(handler, overrides = {}) {
  const key = normalizeWaterHandlerKey(handler) || normalizeWaterHandlerKey(overrides?.handler);
  const preset = WATER_HANDLER_PRESETS[key];
  if (!preset) {
    return null;
  }
  const merged = mergePlain(preset, overrides);
  merged.objType = "waterSurface";
  merged.handler = key;
  merged.shaderPreset = merged.shaderPreset || preset.shaderPreset;
  merged.surface = merged.surface || "plane";
  return applyWaterQualityToRecord(merged);
}

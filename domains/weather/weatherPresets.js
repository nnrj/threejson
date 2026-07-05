/**
 * weather domain presets → core `points` records (merge logic unit-testable).
 */

import { assetUrl } from "../../assets/assetsBase.js";
import { WEATHER_PARTICLE_DEFAULT_OPACITY } from "./weatherPalette.js";

const SKIP_MERGE_KEYS = new Set(["domain", "handler", "objType", "options", "payload", "items"]);

/** @type {Record<string, object>} */
export const WEATHER_HANDLER_PRESETS = {
  rain: {
    name: "weather-rain",
    count: 550,
    bounds: { width: 200, height: 70, depth: 200 },
    position: { x: 0, y: 48, z: 0 },
    motion: {
      type: "drift",
      speed: 14,
      direction: { x: 0, y: -1, z: 0 },
      wrap: true
    },
    material: {
      color: "#9ec8ff",
      size: 2.2,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.8,
      blending: "additive",
      depthWrite: false
    }
  },
  snow: {
    name: "weather-snow",
    count: 400,
    bounds: { width: 220, height: 100, depth: 220 },
    position: { x: 0, y: 55, z: 0 },
    motion: {
      type: "drift",
      speed: 4,
      direction: { x: 0.08, y: -1, z: 0.05 },
      wrap: true
    },
    material: {
      color: "#ffffff",
      size: 4.5,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.92,
      blending: "normal",
      depthWrite: false
    }
  },
  sparkles: {
    name: "weather-sparkles",
    count: 900,
    bounds: { width: 160, height: 80, depth: 160 },
    position: { x: 0, y: 35, z: 0 },
    motion: {
      type: "twinkle",
      speed: 2.2,
      minOpacity: 0.2,
      maxOpacity: 1
    },
    material: {
      color: "#ffdd88",
      size: 3,
      sizeAttenuation: true,
      transparent: true,
      opacity: WEATHER_PARTICLE_DEFAULT_OPACITY,
      blending: "additive",
      depthWrite: false
    }
  },
  embers: {
    name: "weather-embers",
    count: 180,
    bounds: { width: 120, height: 100, depth: 120 },
    position: { x: 40, y: 25, z: -20 },
    motion: [
      {
        type: "drift",
        speed: 6,
        direction: { x: 0, y: 1, z: 0.15 },
        wrap: true
      },
      { type: "scrollUv", speed: 1.4 }
    ],
    material: {
      color: "#ffaa55",
      size: 14,
      sizeAttenuation: true,
      transparent: true,
      opacity: WEATHER_PARTICLE_DEFAULT_OPACITY,
      textureUrl: assetUrl("textures/environment/nature/weather/wind_hot_left.png"),
      blending: "additive",
      depthWrite: false
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
 * @param {object} [overrides]
 * @returns {object|null}
 */
export function buildWeatherPointsRecord(handler, overrides = {}) {
  const key = typeof handler === "string" ? handler.trim().toLowerCase() : "";
  const preset = WEATHER_HANDLER_PRESETS[key];
  if (!preset) {
    return null;
  }
  const merged = mergePlain(preset, overrides);
  merged.name = overrides.name || merged.name || `weather-${key}`;
  return merged;
}

/**
 * @param {string} handler
 * @returns {boolean}
 */
export function isWeatherHandler(handler) {
  const key = typeof handler === "string" ? handler.trim().toLowerCase() : "";
  return Boolean(WEATHER_HANDLER_PRESETS[key]);
}

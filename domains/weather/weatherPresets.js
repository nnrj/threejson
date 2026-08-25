/**
 * Weather domain presets expressed directly with the Particle V2 contract.
 */

import { assetUrl } from "../../core/util/assetsBase.js";
import { WEATHER_PARTICLE_DEFAULT_OPACITY } from "./weatherPalette.js";

const SKIP_MERGE_KEYS = new Set(["domain", "handler", "objType", "options", "payload", "items"]);

/** @type {Record<string, object>} */
export const WEATHER_PARTICLE_PRESETS = {
  rain: {
    objType: "particleEmitter",
    name: "weather-rain",
    source: { type: "box", width: 200, height: 70, depth: 200 },
    emission: { mode: "continuous", count: 550, rate: 110, loop: true, seed: 7301 },
    particle: { lifetime: 5, velocity: { x: 0, y: -14, z: 0 } },
    simulation: {
      backend: "cpu",
      boundary: { type: "wrap", width: 200, height: 70, depth: 200 }
    },
    position: { x: 0, y: 48, z: 0 },
    render: {
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
    objType: "particleEmitter",
    name: "weather-snow",
    source: { type: "box", width: 220, height: 100, depth: 220 },
    emission: { mode: "continuous", count: 400, rate: 65, loop: true, seed: 7302 },
    particle: { lifetime: 7, velocity: { x: 0.32, y: -4, z: 0.2 } },
    simulation: {
      backend: "cpu",
      noise: { strength: 0.12, frequency: 1.1 },
      boundary: { type: "wrap", width: 220, height: 100, depth: 220 }
    },
    position: { x: 0, y: 55, z: 0 },
    render: {
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
    objType: "particleEmitter",
    name: "weather-sparkles",
    source: { type: "box", width: 160, height: 80, depth: 160 },
    emission: { mode: "continuous", count: 900, rate: 150, loop: true, seed: 7303 },
    particle: {
      lifetime: 6,
      velocity: { x: 0, y: 0, z: 0 },
      opacityOverLife: [0.2, 1, 0.2],
      sizeOverLife: [1.5, 3.5, 1.5]
    },
    simulation: { backend: "cpu", boundary: { type: "none" } },
    position: { x: 0, y: 35, z: 0 },
    render: {
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
    objType: "particleEmitter",
    name: "weather-embers",
    source: { type: "disc", radius: 14 },
    emission: { mode: "continuous", count: 180, rate: 28, loop: true, seed: 7304 },
    particle: {
      lifetime: { min: 5, max: 8 },
      velocity: { min: { x: -0.4, y: 4, z: -0.2 }, max: { x: 0.4, y: 7, z: 0.5 } },
      sizeOverLife: [12, 7, 1],
      opacityOverLife: [0, 0.9, 0]
    },
    simulation: {
      backend: "cpu",
      noise: { strength: 0.35, frequency: 1.4 },
      boundary: { type: "kill", width: 120, height: 100, depth: 120 }
    },
    position: { x: 40, y: 25, z: -20 },
    render: {
      type: "billboard",
      color: "#ffaa55",
      size: 14,
      sizeAttenuation: true,
      transparent: true,
      opacity: WEATHER_PARTICLE_DEFAULT_OPACITY,
      sprite: assetUrl("textures/environment/nature/weather/wind_hot_left.png"),
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
export function buildWeatherParticleEmitterRecord(handler, overrides = {}) {
  const key = typeof handler === "string" ? handler.trim().toLowerCase() : "";
  const preset = WEATHER_PARTICLE_PRESETS[key];
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
  return Boolean(WEATHER_PARTICLE_PRESETS[key]);
}

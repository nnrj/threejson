/**
 * nature.sky presets → shaderSurface-compatible records (sphere + shaderPreset).
 */
import {
  DEFAULT_SKY_KEYFRAMES,
  parseSkyCycleConfig,
  skyStateToUniforms
} from "./skyTimeOfDay.js";

const SKY_SPHERE_GEOMETRY = { radius: 4000, widthSegments: 32, heightSegments: 16 };

/** @type {Record<string, object>} */
export const SKY_HANDLER_PRESETS = {
  atmosphere: {
    name: "sky-atmosphere",
    objType: "skyDome",
    handler: "atmosphere",
    shaderPreset: "atmosphere",
    surface: "sphere",
    geometry: { ...SKY_SPHERE_GEOMETRY },
    uniforms: {
      sunDirection: [0.3, 0.85, 0.2],
      zenithColor: "#1a4a7a",
      horizonColor: "#7eb8ff",
      sunIntensity: 1.2
    }
  },
  sunset: {
    name: "sky-sunset",
    objType: "skyDome",
    handler: "sunset",
    shaderPreset: "sunset",
    surface: "sphere",
    geometry: { ...SKY_SPHERE_GEOMETRY },
    uniforms: {
      sunDirection: [0.65, 0.12, 0.25],
      zenithColor: "#2a1a4a",
      horizonColor: "#ff8c42",
      sunIntensity: 1.8
    }
  },
  dawn: {
    name: "sky-dawn",
    objType: "skyDome",
    handler: "dawn",
    shaderPreset: "atmosphere",
    surface: "sphere",
    geometry: { ...SKY_SPHERE_GEOMETRY },
    _sampleHour: 6
  },
  noon: {
    name: "sky-noon",
    objType: "skyDome",
    handler: "noon",
    shaderPreset: "atmosphere",
    surface: "sphere",
    geometry: { ...SKY_SPHERE_GEOMETRY },
    _sampleHour: 12
  },
  night: {
    name: "sky-night",
    objType: "skyDome",
    handler: "night",
    shaderPreset: "atmosphere",
    surface: "sphere",
    geometry: { ...SKY_SPHERE_GEOMETRY },
    _sampleHour: 0
  },
  cycle: {
    name: "sky-cycle",
    objType: "skyDome",
    handler: "cycle",
    shaderPreset: "skyCycle",
    surface: "sphere",
    geometry: { ...SKY_SPHERE_GEOMETRY },
    timeOfDay: 12,
    autoCycle: false,
    cycleDuration: 600,
    syncBackground: false
  }
};

const SKIP_MERGE_KEYS = new Set([
  "domain",
  "handler",
  "objType",
  "options",
  "payload",
  "items",
  "_sampleHour"
]);

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
function normalizeSkyHandlerKey(handler) {
  if (typeof handler !== "string") {
    return "";
  }
  const key = handler.trim().toLowerCase();
  if (key === "sunset" || key === "dusk" || key === "sunsetsky") {
    return "sunset";
  }
  if (key === "atmosphere" || key === "sky" || key === "day") {
    return "atmosphere";
  }
  if (key === "cycle" || key === "dynamic" || key === "daynight") {
    return "cycle";
  }
  if (key === "morning" || key === "sunrise") {
    return "dawn";
  }
  if (key === "midday") {
    return "noon";
  }
  if (key === "midnight") {
    return "night";
  }
  return key;
}

/**
 * @param {string} handler
 * @returns {boolean}
 */
export function isSkyHandler(handler) {
  return Boolean(SKY_HANDLER_PRESETS[normalizeSkyHandlerKey(handler)]);
}

/**
 * @param {object} preset
 * @param {object} merged
 * @returns {object}
 */
function applySampleHourPreset(preset, merged) {
  const hour = preset._sampleHour;
  const keyframes = Array.isArray(merged.keyframes) ? merged.keyframes : DEFAULT_SKY_KEYFRAMES;
  merged.uniforms = skyStateToUniforms(hour, keyframes);
  delete merged._sampleHour;
  delete merged.keyframes;
  return merged;
}

/**
 * @param {object} preset
 * @param {object} merged
 * @returns {object}
 */
function applyCyclePreset(preset, merged) {
  const cycle = parseSkyCycleConfig(merged);
  merged.timeOfDay = cycle.timeOfDay;
  merged.autoCycle = cycle.autoCycle;
  merged.cycleDuration = cycle.cycleDuration;
  merged.syncBackground = cycle.syncBackground;
  if (Array.isArray(merged.keyframes) && merged.keyframes.length >= 2) {
    cycle.keyframes = merged.keyframes;
  }
  merged.uniforms = skyStateToUniforms(cycle.timeOfDay, cycle.keyframes);
  merged._skyCycleSeed = cycle;
  return merged;
}

/**
 * @param {string} handler
 * @param {object} [overrides]
 * @returns {object|null}
 */
export function buildSkyDomeRecord(handler, overrides = {}) {
  const key = normalizeSkyHandlerKey(handler) || normalizeSkyHandlerKey(overrides?.handler);
  const preset = SKY_HANDLER_PRESETS[key];
  if (!preset) {
    return null;
  }
  let merged = mergePlain(preset, overrides);
  merged.objType = "skyDome";
  merged.handler = key;
  merged.shaderPreset = merged.shaderPreset || preset.shaderPreset;
  merged.surface = merged.surface || "sphere";

  if (key === "cycle") {
    merged = applyCyclePreset(preset, merged);
  } else if (Number.isFinite(preset._sampleHour)) {
    merged = applySampleHourPreset(preset, merged);
  }

  return merged;
}

/**
 * nature.sky time-of-day sampling: keyframe interpolation + sun direction.
 */
import * as THREE from "three";
import { log } from "../../../core/util/logger.js";

/** @typedef {{ hour: number, zenithColor: string, horizonColor: string, sunIntensity: number }} SkyKeyframe */

/** @type {SkyKeyframe[]} */
export const DEFAULT_SKY_KEYFRAMES = [
  { hour: 0, zenithColor: "#0a0f1a", horizonColor: "#1a2438", sunIntensity: 0.02 },
  { hour: 6, zenithColor: "#4a6a8a", horizonColor: "#ffb347", sunIntensity: 1.0 },
  { hour: 9, zenithColor: "#2a5a8a", horizonColor: "#9ecfff", sunIntensity: 1.15 },
  { hour: 12, zenithColor: "#1a4a7a", horizonColor: "#7eb8ff", sunIntensity: 1.2 },
  { hour: 17, zenithColor: "#3a2a5a", horizonColor: "#ff9a5c", sunIntensity: 1.5 },
  { hour: 19, zenithColor: "#2a1a4a", horizonColor: "#ff8c42", sunIntensity: 1.1 },
  { hour: 24, zenithColor: "#0a0f1a", horizonColor: "#1a2438", sunIntensity: 0.02 }
];

const _tmpColorA = new THREE.Color();
const _tmpColorB = new THREE.Color();
const _tmpColorOut = new THREE.Color();

/**
 * @param {number} hour 0–24
 * @returns {THREE.Vector3}
 */
export function hourToSunDirection(hour) {
  const h = normalizeHour(hour);
  const angle = ((h - 6) / 12) * Math.PI;
  const y = Math.sin(angle);
  const horiz = Math.cos(angle);
  return new THREE.Vector3(horiz * 0.55, y, 0.35).normalize();
}

/**
 * @param {number} hour
 * @returns {number}
 */
function normalizeHour(hour) {
  let h = Number(hour);
  if (!Number.isFinite(h)) {
    h = 12;
  }
  h = h % 24;
  if (h < 0) {
    h += 24;
  }
  return h;
}

/**
 * @param {number} t
 * @returns {number}
 */
function smoothstep(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/**
 * @param {SkyKeyframe[]} keyframes
 * @returns {SkyKeyframe[]}
 */
function normalizeKeyframes(keyframes) {
  if (!Array.isArray(keyframes) || keyframes.length < 2) {
    return DEFAULT_SKY_KEYFRAMES;
  }
  return keyframes
    .map((kf) => ({
      hour: normalizeHour(kf.hour),
      zenithColor: typeof kf.zenithColor === "string" ? kf.zenithColor : "#1a4a7a",
      horizonColor: typeof kf.horizonColor === "string" ? kf.horizonColor : "#7eb8ff",
      sunIntensity: Number.isFinite(Number(kf.sunIntensity)) ? Number(kf.sunIntensity) : 1
    }))
    .sort((a, b) => a.hour - b.hour);
}

/**
 * @param {number} hour
 * @param {SkyKeyframe[]} [keyframes]
 * @returns {{ sunDirection: THREE.Vector3, zenithColor: THREE.Color, horizonColor: THREE.Color, sunIntensity: number }}
 */
export function sampleSkyAtHour(hour, keyframes = DEFAULT_SKY_KEYFRAMES) {
  const sorted = normalizeKeyframes(keyframes);
  const h = normalizeHour(hour);

  let i0 = sorted.length - 1;
  for (let i = 0; i < sorted.length - 1; i += 1) {
    if (h >= sorted[i].hour && h < sorted[i + 1].hour) {
      i0 = i;
      break;
    }
    if (i === 0 && h < sorted[0].hour) {
      i0 = sorted.length - 1;
      break;
    }
  }

  const k0 = sorted[i0];
  const k1 = sorted[(i0 + 1) % sorted.length];
  let span = k1.hour - k0.hour;
  let localH = h;
  if (span <= 0) {
    span = 24 - k0.hour + k1.hour;
    if (h < k0.hour) {
      localH = h + 24;
    }
  }
  const t = span > 0 ? smoothstep((localH - k0.hour) / span) : 0;

  _tmpColorA.set(k0.zenithColor);
  _tmpColorB.set(k1.zenithColor);
  const zenithColor = _tmpColorOut.copy(_tmpColorA).lerp(_tmpColorB, t).clone();

  _tmpColorA.set(k0.horizonColor);
  _tmpColorB.set(k1.horizonColor);
  const horizonColor = new THREE.Color().copy(_tmpColorA).lerp(_tmpColorB, t);

  const sunIntensity = k0.sunIntensity + (k1.sunIntensity - k0.sunIntensity) * t;
  const sunDirection = hourToSunDirection(h);

  return { sunDirection, zenithColor, horizonColor, sunIntensity };
}

/**
 * @param {object} record
 * @returns {{ timeOfDay: number, autoCycle: boolean, cycleDuration: number, syncBackground: boolean, keyframes: SkyKeyframe[] }}
 */
export function parseSkyCycleConfig(record) {
  const duration = Number(record?.cycleDuration ?? record?.cycleSpeed);
  return {
    timeOfDay: normalizeHour(record?.timeOfDay ?? 12),
    autoCycle: record?.autoCycle === true,
    cycleDuration: Number.isFinite(duration) && duration > 0 ? duration : 600,
    syncBackground: record?.syncBackground === true,
    keyframes: Array.isArray(record?.keyframes) ? record.keyframes : DEFAULT_SKY_KEYFRAMES
  };
}

/**
 * @param {{ timeOfDay: number, autoCycle: boolean, cycleDuration: number }} config
 * @param {number} deltaSeconds
 */
export function advanceSkyCycleTime(config, deltaSeconds) {
  if (!config?.autoCycle || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
    return;
  }
  const hoursPerSecond = 24 / config.cycleDuration;
  config.timeOfDay = normalizeHour(config.timeOfDay + hoursPerSecond * deltaSeconds);
}

/**
 * @param {import("three").ShaderMaterial} material
 * @param {{ sunDirection: THREE.Vector3, zenithColor: THREE.Color, horizonColor: THREE.Color, sunIntensity: number }} state
 */
export function applySkyStateToMaterial(material, state) {
  if (!material?.uniforms || !state) {
    return;
  }
  if (material.uniforms.sunDirection) {
    material.uniforms.sunDirection.value.copy(state.sunDirection);
  }
  if (material.uniforms.zenithColor) {
    material.uniforms.zenithColor.value.copy(state.zenithColor);
  }
  if (material.uniforms.horizonColor) {
    material.uniforms.horizonColor.value.copy(state.horizonColor);
  }
  if (material.uniforms.sunIntensity) {
    material.uniforms.sunIntensity.value = state.sunIntensity;
  }
}

/**
 * @param {number} hour
 * @returns {Record<string, unknown>}
 */
export function skyStateToUniforms(hour, keyframes) {
  const state = sampleSkyAtHour(hour, keyframes);
  return {
    sunDirection: state.sunDirection.toArray(),
    zenithColor: `#${state.zenithColor.getHexString()}`,
    horizonColor: `#${state.horizonColor.getHexString()}`,
    sunIntensity: state.sunIntensity
  };
}

/**
 * @param {import("three").ShaderMaterial} material
 * @param {object} ctx
 */
export function updateSkyCycleUniforms(material, ctx) {
  const mesh = ctx?.mesh;
  const config = mesh?.userData?.skyCycle;
  if (!material?.uniforms || !config) {
    return;
  }
  advanceSkyCycleTime(config, ctx.deltaSeconds);
  const state = sampleSkyAtHour(config.timeOfDay, config.keyframes);
  applySkyStateToMaterial(material, state);

  const scene = ctx?.scene;
  if (!config.syncBackground || !scene) {
    return;
  }
  if (scene.background?.isColor) {
    scene.background.copy(state.horizonColor);
    return;
  }
  if (!config.bgWarned && scene.background) {
    log.warn(
      "[nature.sky] syncBackground skipped: scene.background is not a solid color (HDR/cube/equirect)"
    );
    config.bgWarned = true;
  }
}

/**
 * @param {import("three").Mesh|null|undefined} mesh
 * @param {import("three").Scene|null|undefined} scene
 */
export function restoreSkySyncedBackground(mesh, scene) {
  const snapshot = mesh?.userData?.skyBgSnapshot;
  if (!snapshot || !scene?.background?.isColor) {
    return;
  }
  scene.background.copy(snapshot);
}

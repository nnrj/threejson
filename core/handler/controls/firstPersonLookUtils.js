export const DEFAULT_LOOK_SENSITIVITY = 0.001;
export const DEFAULT_LOOK_PITCH_LIMIT = 1.396;
export const DEFAULT_MAX_LOOK_DELTA = 120;
export const DEFAULT_LOOK_SMOOTH_TIME = 0.06;

const HALF_PI = Math.PI / 2;

/**
 * @param {object} [config]
 * @returns {{ minPolarAngle: number, maxPolarAngle: number, pitchLimit: number }}
 */
export function resolveFirstPersonLookLimits(config = {}) {
  const pitchLimit = Number.isFinite(config.lookPitchLimit)
    ? config.lookPitchLimit
    : DEFAULT_LOOK_PITCH_LIMIT;
  const hasExplicitPolar =
    Number.isFinite(config.minPolarAngle) || Number.isFinite(config.maxPolarAngle);

  if (hasExplicitPolar) {
    return {
      minPolarAngle: Number.isFinite(config.minPolarAngle) ? config.minPolarAngle : 0,
      maxPolarAngle: Number.isFinite(config.maxPolarAngle) ? config.maxPolarAngle : Math.PI,
      pitchLimit
    };
  }

  return {
    minPolarAngle: HALF_PI - pitchLimit,
    maxPolarAngle: HALF_PI + pitchLimit,
    pitchLimit
  };
}

/**
 * @param {number} movementX
 * @param {number} movementY
 * @param {number} [maxDelta]
 */
export function clampLookDelta(movementX, movementY, maxDelta = DEFAULT_MAX_LOOK_DELTA) {
  const limit = Number.isFinite(maxDelta) ? maxDelta : DEFAULT_MAX_LOOK_DELTA;
  if (limit <= 0) {
    return { movementX, movementY };
  }
  return {
    movementX: Math.max(-limit, Math.min(limit, movementX)),
    movementY: Math.max(-limit, Math.min(limit, movementY))
  };
}

/**
 * @param {number} deltaSeconds
 * @param {number} [smoothTime]
 */
export function blendLook(deltaSeconds, smoothTime = DEFAULT_LOOK_SMOOTH_TIME) {
  const time = Number.isFinite(smoothTime) && smoothTime > 0 ? smoothTime : DEFAULT_LOOK_SMOOTH_TIME;
  const delta = Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;
  if (delta <= 0) {
    return 0;
  }
  return 1 - Math.exp(-delta / time);
}

/**
 * @param {object} [config]
 */
export function resolveLookSmoothing(config = {}) {
  const value = Number.isFinite(config.lookSmoothing) ? config.lookSmoothing : 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * @param {object} [config]
 */
export function resolveLookSensitivity(config = {}) {
  return Number.isFinite(config.lookSensitivity) ? config.lookSensitivity : DEFAULT_LOOK_SENSITIVITY;
}

/**
 * @param {object} [config]
 */
export function resolveMaxLookDelta(config = {}) {
  return Number.isFinite(config.maxLookDelta) ? config.maxLookDelta : DEFAULT_MAX_LOOK_DELTA;
}

/**
 * @param {object} [config]
 */
export function resolveLookSmoothTime(config = {}) {
  return Number.isFinite(config.lookSmoothTime) ? config.lookSmoothTime : DEFAULT_LOOK_SMOOTH_TIME;
}

/**
 * @param {number} pitch
 * @param {number} pitchLimit
 */
export function clampPitch(pitch, pitchLimit) {
  const limit = Number.isFinite(pitchLimit) ? pitchLimit : DEFAULT_LOOK_PITCH_LIMIT;
  return Math.max(-limit, Math.min(limit, pitch));
}

/**
 * @param {object} [config]
 */
export function isSmoothLookEnabled(config = {}) {
  return resolveLookSmoothing(config) > 0;
}

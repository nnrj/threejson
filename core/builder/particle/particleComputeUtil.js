/**
 * particleEmitter / gpuCompute pure utilities (no Three.js side effects; easy to unit test).
 */
import {
  normalizePointsMotion,
  normalizeMotionType,
  resolveDriftDirection
} from "../../util/pointsMotionUtil.js";

function hasFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * @param {unknown} motion
 * @returns {boolean}
 */
export function hasPointsMotion(motion) {
  if (motion === undefined || motion === null || motion === "") {
    return false;
  }
  if (Array.isArray(motion)) {
    return motion.length > 0;
  }
  if (typeof motion === "string") {
    return motion.trim().length > 0;
  }
  if (typeof motion === "object") {
    if (Array.isArray(motion.motions) && motion.motions.length > 0) {
      return true;
    }
    return typeof motion.type === "string" && motion.type.trim().length > 0;
  }
  return false;
}

/**
 * Parse velocity vector from drift entry in record.motion (for gpuCompute).
 * @param {object} record
 * @returns {{ x: number, y: number, z: number }|null}
 */
export function resolveDriftVelocityFromRecord(record = {}) {
  const motions = normalizePointsMotion(record.motion);
  for (let i = 0; i < motions.length; i++) {
    const motion = motions[i];
    if (normalizeMotionType(motion.type) !== "drift") {
      continue;
    }
    const direction = resolveDriftDirection(motion);
    const emitter = record.emitter && typeof record.emitter === "object" ? record.emitter : {};
    const speed = hasFiniteNumber(motion.speed)
      ? Number(motion.speed)
      : hasFiniteNumber(emitter.speed)
        ? Number(emitter.speed)
        : hasFiniteNumber(record.speed)
          ? Number(record.speed)
          : 1.5;
    return {
      x: direction.x * speed,
      y: direction.y * speed,
      z: direction.z * speed
    };
  }
  return null;
}

/**
 * @param {number} count
 * @param {number} count
 * @param {object} [compute]
 * @returns {{ width: number, height: number }}
 */
export function resolveParticleTextureSize(count, compute = {}) {
  const explicitWidth = Number(compute.textureWidth ?? compute.width);
  const explicitHeight = Number(compute.textureHeight ?? compute.height);
  if (Number.isFinite(explicitWidth) && explicitWidth > 0 && Number.isFinite(explicitHeight) && explicitHeight > 0) {
    return {
      width: Math.floor(explicitWidth),
      height: Math.floor(explicitHeight)
    };
  }
  const textureSize = Number(compute.textureSize);
  if (Number.isFinite(textureSize) && textureSize > 0) {
    const side = Math.max(2, Math.floor(textureSize));
    return { width: side, height: side };
  }
  const side = Math.max(2, Math.ceil(Math.sqrt(Math.max(count, 1))));
  const pow2 = 2 ** Math.ceil(Math.log2(side));
  return { width: pow2, height: pow2 };
}

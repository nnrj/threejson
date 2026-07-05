/**
 * Points motion pure functions (no Three/TWEEN dependency; shared by unit tests and pointsMotion.js).
 */

function hasValue(value) {
  return value !== undefined && value !== null;
}

function valueOr(value, fallback) {
  return hasValue(value) ? value : fallback;
}

/**
 * @param {unknown} motion
 * @returns {object[]}
 */
export function normalizePointsMotion(motion) {
  if (motion === undefined || motion === null || motion === "") {
    return [];
  }
  if (typeof motion === "string") {
    const type = motion.trim().toLowerCase();
    return type ? [{ type }] : [];
  }
  if (Array.isArray(motion)) {
    const out = [];
    for (let i = 0; i < motion.length; i++) {
      out.push(...normalizePointsMotion(motion[i]));
    }
    return out;
  }
  if (typeof motion === "object") {
    if (Array.isArray(motion.motions)) {
      return normalizePointsMotion(motion.motions);
    }
    const type = typeof motion.type === "string" ? motion.type.trim().toLowerCase() : "";
    if (!type) {
      return [];
    }
    return [{ ...motion, type: normalizeMotionType(type) }];
  }
  return [];
}

/**
 * @param {string} type
 * @returns {string}
 */
export function normalizeMotionType(type) {
  const t = String(type).trim().toLowerCase();
  if (t === "scroll_uv" || t === "scrolluv") {
    return "scrollUv";
  }
  if (t === "rise" || t === "fall") {
    return "drift";
  }
  return t;
}

/**
 * @param {object} motion
 * @returns {{ x: number, y: number, z: number }}
 */
export function resolveDriftDirection(motion) {
  const type = normalizeMotionType(motion?.type || "drift");
  if (type === "drift" && motion?.direction && typeof motion.direction === "object") {
    const x = Number(motion.direction.x) || 0;
    const y = Number(motion.direction.y) || 0;
    const z = Number(motion.direction.z) || 0;
    const len = Math.hypot(x, y, z);
    if (len > 1e-6) {
      return { x: x / len, y: y / len, z: z / len };
    }
  }
  const raw = String(motion?.type || "drift").trim().toLowerCase();
  if (raw === "rise") {
    return { x: 0, y: 1, z: 0 };
  }
  if (raw === "fall") {
    return { x: 0, y: -1, z: 0 };
  }
  return { x: 0, y: 1, z: 0 };
}

/**
 * @param {object} record
 * @returns {{ x: number, y: number, z: number }}
 */
export function resolvePointsHalfExtents(record) {
  const bounds = record?.bounds && typeof record.bounds === "object"
    ? record.bounds
    : record?.geometry && typeof record.geometry === "object"
      ? record.geometry
      : {};
  return {
    x: Number(valueOr(bounds.width, 100)) / 2,
    y: Number(valueOr(bounds.height, 100)) / 2,
    z: Number(valueOr(bounds.depth, 100)) / 2
  };
}

/**
 * @param {{ x: number, y: number, z: number }} half
 * @param {{ x: number, y: number, z: number }} direction
 * @returns {number}
 */
export function computeWrapSpanAlongDirection(half, direction) {
  const span = Math.abs(direction.x) * half.x
    + Math.abs(direction.y) * half.y
    + Math.abs(direction.z) * half.z;
  return Math.max(span * 2, 1e-3);
}

/**
 * @param {Float32Array} basePositions
 * @param {Float32Array} phases
 * @param {{ x: number, y: number, z: number }} direction
 * @param {number} speed
 * @param {number} elapsed
 * @param {boolean} wrap
 * @param {{ x: number, y: number, z: number }} halfExtents
 * @param {Float32Array} [out]
 * @returns {Float32Array}
 */
export function computeDriftPositions(
  basePositions,
  phases,
  direction,
  speed,
  elapsed,
  wrap,
  halfExtents,
  out
) {
  const count = basePositions.length / 3;
  const target = out && out.length === basePositions.length ? out : new Float32Array(basePositions.length);
  const wrapSpan = wrap ? computeWrapSpanAlongDirection(halfExtents, direction) : 0;
  const dx = direction.x;
  const dy = direction.y;
  const dz = direction.z;

  for (let i = 0; i < count; i++) {
    const bi = i * 3;
    let offset = elapsed * speed + (phases ? phases[i] : 0);
    if (wrap && wrapSpan > 0) {
      offset = ((offset % wrapSpan) + wrapSpan) % wrapSpan - wrapSpan * 0.5;
    }
    target[bi] = basePositions[bi] + dx * offset;
    target[bi + 1] = basePositions[bi + 1] + dy * offset;
    target[bi + 2] = basePositions[bi + 2] + dz * offset;
  }
  return target;
}

/**
 * @param {number} t
 * @param {number} speed
 * @param {number} minOpacity
 * @param {number} maxOpacity
 * @param {number} [phase=0]
 * @returns {number}
 */
export function computeTwinkleOpacity(t, speed, minOpacity, maxOpacity, phase = 0) {
  const amp = (maxOpacity - minOpacity) * 0.5;
  const mid = minOpacity + amp;
  return mid + amp * Math.sin(t * speed + phase);
}

/**
 * Wind strip JSON normalization: visual scale, texture density, and deploy scale linked.
 */

function valueOr(value, fallback) {
  return value !== undefined && value !== null ? value : fallback;
}

function normalizeScale(scale = {}) {
  return {
    scaleX: valueOr(scale.scaleX, 1),
    scaleY: valueOr(scale.scaleY, 1),
    scaleZ: valueOr(scale.scaleZ, 1)
  };
}

/**
 * Wind strip visual scale multiplier (default 1). Larger strip lowers texture repeat to avoid dense arrows.
 * @param {unknown} raw
 * @returns {number}
 */
export function normalizeWindVisualScale(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return 1;
  }
  return n;
}

/**
 * Write `visualScale` to mesh `scale`; adjust `material.textureRepeat` inversely with scale.
 * `speed` (wind speed/flow sign) and `rotation` (wind direction) keep JSON values.
 * @param {object} record
 * @returns {object}
 */
export function applyWindVisualScale(record) {
  if (!record || typeof record !== "object") {
    return record;
  }
  const visualScale = normalizeWindVisualScale(record.visualScale);
  if (visualScale === 1) {
    return record;
  }
  const merged = { ...record };
  merged.visualScale = visualScale;
  const baseScale = normalizeScale(record.scale);
  merged.scale = {
    scaleX: baseScale.scaleX * visualScale,
    scaleY: baseScale.scaleY * visualScale,
    scaleZ: baseScale.scaleZ * visualScale
  };
  const material = record.material;
  if (material && typeof material === "object") {
    const repeat = material.textureRepeat;
    if (repeat && typeof repeat === "object") {
      merged.material = {
        ...material,
        textureRepeat: {
          x: valueOr(repeat.x, 1) / visualScale,
          y: valueOr(repeat.y, 1) / visualScale
        }
      };
    }
  }
  return merged;
}

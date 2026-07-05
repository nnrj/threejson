/**
 * Pie / ring slice normalization and theta allocation.
 */

export const STAT_PIE_MAX_SLICES = 8;
export const STAT_RING_MAX_SLICES = 6;

/**
 * @param {object[]} [slices]
 * @param {number} [maxCount]
 * @returns {object[]}
 */
export function normalizeSlices(slices, maxCount = STAT_PIE_MAX_SLICES) {
  if (!Array.isArray(slices) || slices.length === 0) {
    return [];
  }
  const cap = Number.isFinite(maxCount) && maxCount > 0 ? maxCount : STAT_PIE_MAX_SLICES;
  /** @type {object[]} */
  const out = [];
  for (let i = 0; i < slices.length && out.length < cap; i++) {
    const slice = slices[i];
    if (!slice || typeof slice !== "object") {
      continue;
    }
    const value = Number(slice.value);
    if (!Number.isFinite(value) || value <= 0) {
      continue;
    }
    out.push(slice);
  }
  return out;
}

/**
 * @param {object[]} slices
 * @returns {number}
 */
export function sumSliceValues(slices) {
  let total = 0;
  for (let i = 0; i < slices.length; i++) {
    const value = Number(slices[i]?.value);
    if (Number.isFinite(value) && value > 0) {
      total += value;
    }
  }
  return total;
}

/**
 * @param {object[]} slices
 * @param {object} [options]
 * @returns {{ slice: object, thetaStart: number, thetaLength: number, fraction: number }[]}
 */
export function sliceToThetaRanges(slices, options = {}) {
  const maxSlices = options.maxSlices ?? STAT_PIE_MAX_SLICES;
  const normalized = normalizeSlices(slices, maxSlices);
  const total = sumSliceValues(normalized);
  if (total <= 0) {
    return [];
  }
  const startAngle = Number(options.startAngle) || 0;
  const angleSpan =
    options.fullCircle === false && Number.isFinite(Number(options.angleSpan))
      ? Number(options.angleSpan)
      : Math.PI * 2;
  let cursor = startAngle;
  return normalized.map((slice) => {
    const value = Number(slice.value);
    const fraction = value / total;
    const thetaLength = fraction * angleSpan;
    const range = { slice, thetaStart: cursor, thetaLength, fraction };
    cursor += thetaLength;
    return range;
  });
}

/**
 * @param {number} fraction 0..1
 * @param {object} [slice]
 * @returns {string}
 */
export function formatSliceLabel(fraction, slice) {
  if (typeof slice?.label === "string" && slice.label.trim()) {
    return slice.label.trim();
  }
  return `${Math.round(fraction * 100)}%`;
}

/**
 * r153–154: non-physical light intensities; down-convert declared physical units for runtime.
 */

const PHYSICAL_POINT_TO_ARBITRARY = 1 / 28000;
const PHYSICAL_DIRECTIONAL_TO_ARBITRARY = 1;

/**
 * @param {object} entry
 * @returns {number}
 */
export function resolveLightIntensity(entry) {
  const raw = typeof entry?.intensity === "number" && Number.isFinite(entry.intensity)
    ? entry.intensity
    : 1;
  const unit = String(entry?.unit || entry?.intensityUnit || "").trim().toLowerCase();
  const isPhysicalUnit =
    unit === "physical"
    || unit === "candela"
    || unit === "lux"
    || unit === "irradiance"
    || entry?.physical === true;
  if (!isPhysicalUnit) {
    return raw;
  }
  if (entry?.type === "point" || entry?.type === "spot") {
    return raw * PHYSICAL_POINT_TO_ARBITRARY;
  }
  if (entry?.type === "directional") {
    return raw * PHYSICAL_DIRECTIONAL_TO_ARBITRARY;
  }
  return raw;
}

export const baseline153Adapter = {
  id: "baseline153",
  resolveLightIntensity
};

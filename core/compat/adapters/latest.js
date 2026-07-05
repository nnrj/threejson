import { log } from "../../util/logger.js";
/**
 * Native-tier adapter (r184+): JSON intensities are already physical units when unit is set.
 */

/**
 * @param {object} entry
 * @returns {number}
 */
export function resolveLightIntensity(entry) {
  const raw = typeof entry?.intensity === "number" && Number.isFinite(entry.intensity)
    ? entry.intensity
    : 1;
  const unit = String(entry?.unit || entry?.intensityUnit || "").trim().toLowerCase();
  if (
    unit === "physical"
    || unit === "candela"
    || unit === "lux"
    || unit === "irradiance"
    || entry?.physical === true
  ) {
    return raw;
  }
  if (unit === "legacy" || entry?.legacy === true) {
    log.warn(
      "[threejson] light entry uses unit legacy on native Three.js revision; intensity used as-is:",
      entry?.type,
      raw
    );
  } else if (unit && unit !== "physical") {
    log.warn("[threejson] unknown light intensity unit, using raw intensity:", unit, entry?.type);
  }
  return raw;
}

export const latestAdapter = {
  id: "latest",
  resolveLightIntensity
};

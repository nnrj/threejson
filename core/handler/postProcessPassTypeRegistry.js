import { log } from "../util/logger.js";
/**
 * passType sub-factory registry (render / outline / unrealBloom / shader).
 */

/** @typedef {(record: object, ctx: object) => import("three/examples/jsm/postprocessing/Pass.js").Pass|null} PassTypeFactory */

/** @type {Map<string, PassTypeFactory>} */
const factoriesByPassType = new Map();

/**
 * @param {string} passType
 * @returns {string}
 */
export function normalizePassType(passType) {
  return typeof passType === "string" ? passType.trim().toLowerCase() : "";
}

/**
 * @param {string} passType
 * @param {PassTypeFactory} factory
 */
export function registerPassTypeFactory(passType, factory) {
  const key = normalizePassType(passType);
  if (!key || typeof factory !== "function") {
    throw new Error("[passTypeRegistry] passType and factory function are required");
  }
  factoriesByPassType.set(key, factory);
}

/**
 * @param {string} passType
 * @returns {PassTypeFactory|null}
 */
export function getPassTypeFactory(passType) {
  return factoriesByPassType.get(normalizePassType(passType)) ?? null;
}

/**
 * @param {object} record
 * @param {object} ctx
 * @returns {import("three/examples/jsm/postprocessing/Pass.js").Pass|null}
 */
export function createPassByType(record, ctx) {
  const passType = normalizePassType(record?.passType) || "outline";
  const factory = factoriesByPassType.get(passType);
  if (!factory) {
    log.warn("[passTypeRegistry] unsupported passType:", passType);
    return null;
  }
  return factory(record, ctx);
}

/** For unit tests only */
export function _clearPassTypeFactoriesForTests() {
  factoriesByPassType.clear();
}

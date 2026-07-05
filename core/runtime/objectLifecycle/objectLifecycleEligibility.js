/**
 * Content vs runtime objType gate for object.ready / object.dispose (denylist).
 */

/** @readonly */
export const CANONICAL_RUNTIME_OBJ_TYPES = Object.freeze([
  "scene",
  "camera",
  "renderer",
  "controls",
  "light",
  "renderloop"
]);

/** @readonly */
export const CANONICAL_RUNTIME_OBJ_TYPE_SET = new Set(CANONICAL_RUNTIME_OBJ_TYPES);

/** @readonly */
export const LIFECYCLE_EXCLUDED_OBJ_TYPES = Object.freeze(["pass", "default"]);

/** @readonly */
export const LIFECYCLE_EXCLUDED_OBJ_TYPE_SET = new Set(LIFECYCLE_EXCLUDED_OBJ_TYPES);

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeObjType(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * @param {unknown} objType
 * @returns {boolean}
 */
export function isLifecycleEligibleObjType(objType) {
  const key = normalizeObjType(objType);
  if (!key) {
    return false;
  }
  if (CANONICAL_RUNTIME_OBJ_TYPE_SET.has(key)) {
    return false;
  }
  if (LIFECYCLE_EXCLUDED_OBJ_TYPE_SET.has(key)) {
    return false;
  }
  return true;
}

/**
 * @param {unknown} record
 * @returns {boolean}
 */
export function isLifecycleEligibleRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return false;
  }
  const threeJsonId = typeof record.threeJsonId === "string" ? record.threeJsonId.trim() : "";
  if (!threeJsonId) {
    return false;
  }
  return isLifecycleEligibleObjType(record.objType);
}

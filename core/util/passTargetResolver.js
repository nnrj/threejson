/**
 * Resolve threeJsonId / threeJsonIds in pass records to Object3D lists (for target-based passes such as outline).
 */
import { getObjectByThreeJsonId } from "../handler/objectRegistry.js";

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeId(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {object} record
 * @returns {string[]}
 */
export function collectPassTargetIds(record) {
  if (!record || typeof record !== "object") {
    return [];
  }
  const ids = [];
  const single = normalizeId(record.threeJsonId);
  if (single) {
    ids.push(single);
  }
  const list = Array.isArray(record.threeJsonIds) ? record.threeJsonIds : [];
  for (let i = 0; i < list.length; i++) {
    const id = normalizeId(list[i]);
    if (id) {
      ids.push(id);
    }
  }
  const seen = new Set();
  const unique = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (!seen.has(id)) {
      seen.add(id);
      unique.push(id);
    }
  }
  return unique;
}

/**
 * @param {object} record
 * @param {{ onMissing?: (id: string) => void }} [hooks]
 * @returns {import("three").Object3D[]}
 */
export function resolvePassTargets(record, hooks = {}) {
  const onMissing = typeof hooks.onMissing === "function" ? hooks.onMissing : null;
  const objects = [];
  const ids = collectPassTargetIds(record);
  for (let i = 0; i < ids.length; i++) {
    const obj = getObjectByThreeJsonId(ids[i]);
    if (obj) {
      objects.push(obj);
    } else if (onMissing) {
      onMissing(ids[i]);
    }
  }
  return objects;
}

/**
 * @param {object} record
 * @returns {boolean}
 */
export function hasPassTargetIds(record) {
  return collectPassTargetIds(record).length > 0;
}

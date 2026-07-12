/**
 * Resolve event targets via objectRegistry (threeJsonId / name / refName).
 */

import {
  getObjectByRefName,
  getObjectByThreeJsonId,
  getObjectsByName
} from "../../handler/objectRegistry.js";

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @typedef {object} EventTargetSelector
 * @property {string} [threeJsonId]
 * @property {string} [name]
 * @property {string} [refName]
 */

/**
 * @param {EventTargetSelector|string|null|undefined} selector
 * @param {*} [runtimeScope] Scene/RuntimeContext/ctx bag to scope the lookup to; omit for the shared default registry.
 * @returns {import("three").Object3D[]}
 */
export function resolveEventTargets(selector, runtimeScope) {
  if (typeof selector === "string") {
    const key = normalizeText(selector);
    if (!key) {
      return [];
    }
    const byId = getObjectByThreeJsonId(key, runtimeScope);
    if (byId) {
      return [byId];
    }
    const byRef = getObjectByRefName(key, runtimeScope);
    if (byRef) {
      return [byRef];
    }
    return getObjectsByName(key, runtimeScope);
  }
  if (!selector || typeof selector !== "object" || Array.isArray(selector)) {
    return [];
  }
  const threeJsonId = normalizeText(selector.threeJsonId);
  if (threeJsonId) {
    const object = getObjectByThreeJsonId(threeJsonId, runtimeScope);
    return object ? [object] : [];
  }
  const refName = normalizeText(selector.refName);
  if (refName) {
    const object = getObjectByRefName(refName, runtimeScope);
    return object ? [object] : [];
  }
  const name = normalizeText(selector.name);
  if (name) {
    return getObjectsByName(name, runtimeScope);
  }
  return [];
}

/**
 * @param {EventTargetSelector|string|null|undefined} selector
 * @param {*} [runtimeScope]
 * @returns {import("three").Object3D|null}
 */
export function resolveEventTarget(selector, runtimeScope) {
  const list = resolveEventTargets(selector, runtimeScope);
  return list.length > 0 ? list[0] : null;
}

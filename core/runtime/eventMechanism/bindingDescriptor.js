/**
 * Derive binding metadata from object descriptors — generic rules, no domain special cases.
 */

/** @typedef {'core'|'domain'} EventExecutorKind */

/** @typedef {object} EventBindingMetadata
 * @property {string} threeJsonId
 * @property {string} objType
 * @property {string} domainKey
 * @property {EventExecutorKind} executorKind
 */

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeObjType(descriptor) {
  return normalizeText(descriptor?.objType || descriptor?.type).toLowerCase();
}

function normalizeDomainKey(descriptor) {
  return normalizeText(descriptor?.domain);
}

/**
 * @param {object|null|undefined} descriptor
 * @returns {EventExecutorKind}
 */
export function deriveExecutorKind(descriptor) {
  const objType = normalizeObjType(descriptor);
  const domainKey = normalizeDomainKey(descriptor);
  if (objType === "domain" && domainKey) {
    return "domain";
  }
  return "core";
}

/**
 * @param {import("three").Object3D|null|undefined} object
 * @param {object|null|undefined} [explicitDescriptor]
 * @returns {EventBindingMetadata|null}
 */
export function buildBindingMetadataFromObject(object, explicitDescriptor = null) {
  const descriptor =
    explicitDescriptor && typeof explicitDescriptor === "object" && !Array.isArray(explicitDescriptor)
      ? explicitDescriptor
      : object?.userData?.objJson;
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
    return null;
  }
  const threeJsonId = normalizeText(descriptor.threeJsonId);
  if (!threeJsonId) {
    return null;
  }
  return {
    threeJsonId,
    objType: normalizeObjType(descriptor),
    domainKey: normalizeDomainKey(descriptor),
    executorKind: deriveExecutorKind(descriptor)
  };
}

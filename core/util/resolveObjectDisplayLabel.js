/**
 * Display label for object/scene descriptors (not used for bulk name queries).
 * Priority: label → name → threeJsonId → fallback "Unnamed".
 */

function pickText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

/**
 * @param {object|null|undefined} descriptor
 * @param {{ fallback?: string }} [options]
 * @returns {string}
 */
export function resolveObjectDisplayLabel(descriptor, options = {}) {
  const fallback = pickText(options.fallback) || "Unnamed";
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
    return fallback;
  }
  return (
    pickText(descriptor.label) ||
    pickText(descriptor.name) ||
    pickText(descriptor.threeJsonId) ||
    fallback
  );
}

/**
 * @param {import("three").Object3D|null|undefined} object3D
 * @param {{ fallback?: string }} [options]
 * @returns {string}
 */
export function resolveObjectDisplayLabelFromObject(object3D, options = {}) {
  if (!object3D) {
    return pickText(options.fallback) || "Unnamed";
  }
  const descriptor = object3D.userData?.objJson;
  if (descriptor && typeof descriptor === "object") {
    return resolveObjectDisplayLabel(descriptor, options);
  }
  return pickText(object3D.name) || pickText(options.fallback) || "Unnamed";
}

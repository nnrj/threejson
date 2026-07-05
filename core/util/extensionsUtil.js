/**
 * Extension JSON container utilities (core does not parse plugin-specific semantics).
 */

/**
 * @param {...Record<string, unknown>|null|undefined} maps
 * @returns {Record<string, unknown>}
 */
export function mergeExtensionMaps(...maps) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (let i = 0; i < maps.length; i++) {
    const map = maps[i];
    if (!map || typeof map !== "object" || Array.isArray(map)) {
      continue;
    }
    const keys = Object.keys(map);
    for (let k = 0; k < keys.length; k++) {
      const key = keys[k];
      const value = map[key];
      if (
        value
        && typeof value === "object"
        && !Array.isArray(value)
        && out[key]
        && typeof out[key] === "object"
        && !Array.isArray(out[key])
      ) {
        out[key] = { .../** @type {object} */ (out[key]), .../** @type {object} */ (value) };
      } else {
        out[key] = value;
      }
    }
  }
  return out;
}

/**
 * @param {object|null|undefined} record
 * @param {string} extensionId
 * @returns {object|null}
 */
export function readExtensionConfig(record, extensionId) {
  if (!record || typeof record !== "object" || !extensionId) {
    return null;
  }
  const extensions = record.extensions;
  if (!extensions || typeof extensions !== "object" || Array.isArray(extensions)) {
    return null;
  }
  const cfg = extensions[extensionId];
  return cfg && typeof cfg === "object" ? cfg : null;
}

/**
 * @param {object|null|undefined} sceneConfig
 * @param {object|null|undefined} worldInfo
 * @returns {Record<string, unknown>}
 */
export function resolveSceneExtensions(sceneConfig, worldInfo) {
  const fromScene =
    sceneConfig?.extensions && typeof sceneConfig.extensions === "object"
      ? sceneConfig.extensions
      : null;
  const fromWorld =
    worldInfo?.extensions && typeof worldInfo.extensions === "object"
      ? worldInfo.extensions
      : null;
  return mergeExtensionMaps(fromWorld, fromScene);
}

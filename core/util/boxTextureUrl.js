/**
 * Box texture URL resolution (persisted fields), for {@link createTextureBox} and unit tests.
 */
import { resolveTextureSource } from "./resolveTextureSource.js";

/**
 * @param {object|null|undefined} materialJson
 * @returns {string|null}
 */
function textureUrlFromMaterialJson(materialJson) {
  return resolveTextureSource(materialJson);
}

/**
 * Resolve default texture URL from six-face `materials[]` or singular `material`.
 * @param {object|null|undefined} boxObj
 * @returns {string|null}
 */
function resolveBoxDefaultTextureUrl(boxObj) {
  if (!boxObj || typeof boxObj !== "object") {
    return null;
  }
  const materials = boxObj.materials;
  if (Array.isArray(materials)) {
    for (let i = 0; i < materials.length; i += 1) {
      const url = textureUrlFromMaterialJson(materials[i]);
      if (url) {
        return url;
      }
    }
  }
  return textureUrlFromMaterialJson(boxObj.material);
}

export {
  resolveBoxDefaultTextureUrl,
  textureUrlFromMaterialJson
};

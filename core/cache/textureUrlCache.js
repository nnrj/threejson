/**
 * Optional static texture URL cache (off by default).
 * Enabled via sceneConfig.extensions.assetLibrary.textureUrlCache.
 * On hit, clones the texture so each mesh can set repeat independently while avoiding duplicate network decode.
 */
import { resolveSceneExtensions } from "../util/extensionsUtil.js";

/** @type {Map<string, import("three").Texture>} */
const canonicalByUrl = new Map();

let cacheEnabled = false;

/**
 * @param {object|null|undefined} normalized
 */
export function configureTextureUrlCacheForDeploy(normalized) {
  const extensions = resolveSceneExtensions(normalized?.sceneConfig, normalized?.worldInfo);
  const assetLibraryExt = extensions?.assetLibrary;
  cacheEnabled = Boolean(
    assetLibraryExt
    && typeof assetLibraryExt === "object"
    && !Array.isArray(assetLibraryExt)
    && assetLibraryExt.textureUrlCache === true
  );
  if (!cacheEnabled) {
    clearTextureUrlCache();
  }
}

/**
 * @returns {boolean}
 */
export function isTextureUrlCacheEnabled() {
  return cacheEnabled;
}

export function clearTextureUrlCache() {
  canonicalByUrl.clear();
}

/**
 * @param {string} url
 * @param {import("three").Texture} texture
 */
export function rememberCanonicalTexture(url, texture) {
  const key = typeof url === "string" ? url.trim() : "";
  if (!cacheEnabled || !key || !texture) {
    return;
  }
  if (!canonicalByUrl.has(key)) {
    canonicalByUrl.set(key, texture);
  }
}

/**
 * @param {string} url
 * @returns {import("three").Texture|null}
 */
export function getCanonicalTexture(url) {
  const key = typeof url === "string" ? url.trim() : "";
  if (!cacheEnabled || !key) {
    return null;
  }
  return canonicalByUrl.get(key) ?? null;
}

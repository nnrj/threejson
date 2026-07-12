/**
 * Optional static texture URL cache (off by default).
 * Enabled via sceneConfig.extensions.assetLibrary.textureUrlCache.
 * On hit, clones the texture so each mesh can set repeat independently while avoiding duplicate network decode.
 *
 * State lives inside `createTextureUrlCacheStore()` instances, one per RuntimeContext
 * (see core/runtime/runtimeContext.js), so configuring/clearing this cache for one
 * scene's deploy never affects a concurrently-loading sibling scene. Named exports
 * are thin wrappers taking an optional trailing `runtimeScope`; omitting it preserves
 * today's shared-global behavior.
 */
import { resolveSceneExtensions } from "../util/extensionsUtil.js";
import { resolveRuntimeContext } from "../runtime/runtimeContext.js";

export function createTextureUrlCacheStore() {
  /** @type {Map<string, import("three").Texture>} */
  const canonicalByUrl = new Map();
  let cacheEnabled = false;

  function clear() {
    canonicalByUrl.clear();
  }

  function configureForDeploy(normalized) {
    const extensions = resolveSceneExtensions(normalized?.sceneConfig, normalized?.worldInfo);
    const assetLibraryExt = extensions?.assetLibrary;
    cacheEnabled = Boolean(
      assetLibraryExt
      && typeof assetLibraryExt === "object"
      && !Array.isArray(assetLibraryExt)
      && assetLibraryExt.textureUrlCache === true
    );
    if (!cacheEnabled) {
      clear();
    }
  }

  function isEnabled() {
    return cacheEnabled;
  }

  function rememberCanonicalTexture(url, texture) {
    const key = typeof url === "string" ? url.trim() : "";
    if (!cacheEnabled || !key || !texture) {
      return;
    }
    if (!canonicalByUrl.has(key)) {
      canonicalByUrl.set(key, texture);
    }
  }

  function getCanonicalTexture(url) {
    const key = typeof url === "string" ? url.trim() : "";
    if (!cacheEnabled || !key) {
      return null;
    }
    return canonicalByUrl.get(key) ?? null;
  }

  return {
    configureForDeploy,
    isEnabled,
    clear,
    rememberCanonicalTexture,
    getCanonicalTexture,
    dispose: clear
  };
}

function resolveStore(runtimeScope) {
  return resolveRuntimeContext(runtimeScope).textureUrlCache;
}

/**
 * @param {object|null|undefined} normalized
 * @param {*} [runtimeScope]
 */
export function configureTextureUrlCacheForDeploy(normalized, runtimeScope) {
  return resolveStore(runtimeScope).configureForDeploy(normalized);
}

/**
 * @returns {boolean}
 */
export function isTextureUrlCacheEnabled(runtimeScope) {
  return resolveStore(runtimeScope).isEnabled();
}

export function clearTextureUrlCache(runtimeScope) {
  return resolveStore(runtimeScope).clear();
}

/**
 * @param {string} url
 * @param {import("three").Texture} texture
 * @param {*} [runtimeScope]
 */
export function rememberCanonicalTexture(url, texture, runtimeScope) {
  return resolveStore(runtimeScope).rememberCanonicalTexture(url, texture);
}

/**
 * @param {string} url
 * @param {*} [runtimeScope]
 * @returns {import("three").Texture|null}
 */
export function getCanonicalTexture(url, runtimeScope) {
  return resolveStore(runtimeScope).getCanonicalTexture(url);
}

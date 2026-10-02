/**
 * Capability-scoped asset URL API.
 *
 * Import this entry when a host only needs ThreeJSON's published asset base or
 * asset URL helpers. It intentionally avoids the aggregate `threejson/core`
 * entry and its scene runtime, AI, editor, and rendering dependencies.
 */
export {
  ASSETS_BASE_MODE_BASE_FIRST,
  ASSETS_BASE_MODE_BASE_ONLY,
  ASSETS_BASE_MODE_CDN_FIRST,
  ASSETS_BASE_MODE_CDN_ONLY,
  ASSETS_BASE_MODE_LOCAL_FIRST,
  ASSETS_BASE_MODE_LOCAL_ONLY,
  ASSETS_PACKAGE_VERSION,
  DEFAULT_CDN_ASSETS_BASE,
  LOCAL_ASSETS_BASE,
  assetUrl,
  assetUrlCandidates,
  getAssetsBaseMode,
  getAssetsBaseUrl,
  normalizeAssetsBase,
  normalizeAssetsBaseMode,
  resolvePublicAssetUrl,
  resolvePublicAssetUrlCandidates,
  setAssetsBaseMode,
  setAssetsBaseUrl
} from "./util/assetsBase.js";
export { resolveAssetUrl } from "./util/assetGateway.js";

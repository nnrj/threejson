/**
 * Public asset URL base: base-first by default; npm/CDN fallback covers installs without local assets.
 */

/**
 * Pin to the published @threejson/assets version used in default CDN URLs. This is a plain literal
 * rather than something read off `@threejson/assets`'s own package.json at runtime: this module
 * never imports asset *contents* from that package (only builds a jsDelivr URL string pointing at
 * it), and `threejson` itself is loaded directly via unbundled browser `<script type="module">`/
 * dynamic `import()` in several consumers (community ThreeBox, the editor, the player) where a JSON
 * import would need import-attribute syntax that isn't universally supported — a literal is the one
 * representation guaranteed to work in every runtime this module ships to.
 *
 * `@threejson/assets` IS still tracked as a real dependency, just a devDependency (see package.json)
 * — that keeps it out of downstream installs (devDependencies never propagate to consumers of a
 * published package) while still surfacing version bumps to `npm outdated`/Dependabot/Renovate.
 * tests/assetsBase.test.mjs asserts this literal matches the installed devDependency's actual
 * version, so a bump to one without the other fails the test suite instead of silently going stale
 * (as happened once already — 1.0.0 was pinned here well after 1.1.2 had shipped).
 */
export const ASSETS_PACKAGE_VERSION = "1.1.2";

export const DEFAULT_CDN_ASSETS_BASE =
  `https://cdn.jsdelivr.net/npm/@threejson/assets@${ASSETS_PACKAGE_VERSION}`;

export const LOCAL_ASSETS_BASE = "/assets";

export const ASSETS_BASE_MODE_LOCAL_FIRST = "local-first";
export const ASSETS_BASE_MODE_CDN_FIRST = "cdn-first";
export const ASSETS_BASE_MODE_LOCAL_ONLY = "local-only";
export const ASSETS_BASE_MODE_CDN_ONLY = "cdn-only";
export const ASSETS_BASE_MODE_BASE_ONLY = "base-only";
export const ASSETS_BASE_MODE_BASE_FIRST = "base-first";

let runtimeBase = LOCAL_ASSETS_BASE;
let runtimeMode = ASSETS_BASE_MODE_BASE_FIRST;

/**
 * @param {string} url
 * @returns {string}
 */
export function normalizeAssetsBase(url) {
  if (typeof url !== "string") {
    return "";
  }
  return url.trim().replace(/\/+$/, "");
}

/**
 * @param {string} mode
 * @returns {string}
 */
export function normalizeAssetsBaseMode(mode) {
  const value = String(mode || "").trim().toLowerCase();
  if (value === "local" || value === ASSETS_BASE_MODE_LOCAL_ONLY) {
    return ASSETS_BASE_MODE_LOCAL_ONLY;
  }
  if (value === "cdn" || value === ASSETS_BASE_MODE_CDN_ONLY) {
    return ASSETS_BASE_MODE_CDN_ONLY;
  }
  if (value === ASSETS_BASE_MODE_CDN_FIRST) {
    return ASSETS_BASE_MODE_CDN_FIRST;
  }
  if (value === ASSETS_BASE_MODE_BASE_ONLY || value === "base") {
    return ASSETS_BASE_MODE_BASE_ONLY;
  }
  if (value === ASSETS_BASE_MODE_BASE_FIRST || value === "fallback-cdn") {
    return ASSETS_BASE_MODE_BASE_FIRST;
  }
  return ASSETS_BASE_MODE_BASE_FIRST;
}

/**
 * @param {string} url
 */
export function setAssetsBaseUrl(url) {
  const normalized = normalizeAssetsBase(url);
  if (!normalized) {
    throw new Error("setAssetsBaseUrl: expected non-empty base URL");
  }
  runtimeBase = normalized;
  runtimeMode = ASSETS_BASE_MODE_BASE_FIRST;
}

export function setAssetsBaseMode(mode) {
  runtimeMode = normalizeAssetsBaseMode(mode);
}

/** @returns {string} */
export function getAssetsBaseUrl() {
  return runtimeBase;
}

export function getAssetsBaseMode() {
  return runtimeMode;
}

/**
 * @param {string} relativePath e.g. `textures/device/cabinet/cabinet_left_door.png`
 * @returns {string}
 */
export function assetUrl(relativePath) {
  const segment = String(relativePath || "").replace(/^\/+/, "");
  if (!segment) {
    return getAssetsBaseUrl();
  }
  return `${getAssetsBaseUrl()}/${segment}`;
}

function assetUrlFromBase(base, relativePath) {
  const segment = String(relativePath || "").replace(/^\/+/, "");
  const normalizedBase = normalizeAssetsBase(base);
  if (!segment) {
    return normalizedBase;
  }
  return `${normalizedBase}/${segment}`;
}

function dedupeUrls(urls) {
  return Array.from(new Set(urls.filter((url) => typeof url === "string" && url.length > 0)));
}

/**
 * @param {string} relativePath
 * @returns {string[]}
 */
export function assetUrlCandidates(relativePath) {
  const mode = normalizeAssetsBaseMode(runtimeMode);
  const localUrl = assetUrlFromBase(LOCAL_ASSETS_BASE, relativePath);
  const cdnUrl = assetUrlFromBase(DEFAULT_CDN_ASSETS_BASE, relativePath);
  const baseUrl = assetUrlFromBase(runtimeBase, relativePath);
  if (mode === ASSETS_BASE_MODE_CDN_FIRST) {
    return dedupeUrls([cdnUrl, localUrl]);
  }
  if (mode === ASSETS_BASE_MODE_LOCAL_ONLY) {
    return [localUrl];
  }
  if (mode === ASSETS_BASE_MODE_CDN_ONLY) {
    return [cdnUrl];
  }
  if (mode === ASSETS_BASE_MODE_BASE_ONLY) {
    return [baseUrl];
  }
  if (mode === ASSETS_BASE_MODE_BASE_FIRST) {
    return dedupeUrls([baseUrl, cdnUrl]);
  }
  return dedupeUrls([localUrl, cdnUrl]);
}

/**
 * Rewrite legacy `/assets/...` paths against the active base. https/data URLs pass through.
 * @param {string} url
 * @returns {string}
 */
export function resolvePublicAssetUrl(url) {
  if (typeof url !== "string") {
    return "";
  }
  const input = url.trim();
  if (!input) {
    return "";
  }
  if (/^(data:|blob:|https?:\/\/)/i.test(input) || input.startsWith("//")) {
    return input;
  }
  if (input.startsWith("/assets/")) {
    return assetUrlCandidates(input.slice("/assets/".length))[0] || "";
  }
  return input;
}

/**
 * Rewrite legacy `/assets/...` paths to all active candidates. https/data URLs pass through.
 * @param {string} url
 * @returns {string[]}
 */
export function resolvePublicAssetUrlCandidates(url) {
  if (typeof url !== "string") {
    return [];
  }
  const input = url.trim();
  if (!input) {
    return [];
  }
  if (/^(data:|blob:|https?:\/\/)/i.test(input) || input.startsWith("//")) {
    return [input];
  }
  if (input.startsWith("/assets/")) {
    return assetUrlCandidates(input.slice("/assets/".length));
  }
  return [input];
}

/**
 * @param {object} payload scene JSON
 * @param {object} [options] createJsonScene options
 * @returns {string|null}
 */
export function resolveAssetsBaseFromLoad(payload = {}, options = {}) {
  const sceneConfig =
    payload?.sceneConfig && typeof payload.sceneConfig === "object" ? payload.sceneConfig : {};
  const candidate = options?.assetsBase ?? sceneConfig.assetsBase;
  if (typeof candidate !== "string") {
    return null;
  }
  const normalized = normalizeAssetsBase(candidate);
  return normalized || null;
}

export function resolveAssetsBaseModeFromLoad(payload = {}, options = {}) {
  const sceneConfig =
    payload?.sceneConfig && typeof payload.sceneConfig === "object" ? payload.sceneConfig : {};
  const candidate = options?.assetsBaseMode ?? sceneConfig.assetsBaseMode;
  if (typeof candidate !== "string") {
    return null;
  }
  return normalizeAssetsBaseMode(candidate);
}

/**
 * Apply per-load assets base override; returns restore function.
 * @param {object} payload
 * @param {object} [options]
 * @returns {() => void}
 */
export function applyAssetsBaseForLoad(payload = {}, options = {}) {
  const override = resolveAssetsBaseFromLoad(payload, options);
  const modeOverride = resolveAssetsBaseModeFromLoad(payload, options);
  if (!override && !modeOverride) {
    return () => {};
  }
  const previous = getAssetsBaseUrl();
  const previousMode = getAssetsBaseMode();
  if (override) {
    runtimeBase = override;
    runtimeMode = modeOverride || ASSETS_BASE_MODE_BASE_FIRST;
  } else {
    runtimeMode = modeOverride;
  }
  return () => {
    runtimeBase = previous;
    runtimeMode = previousMode;
  };
}

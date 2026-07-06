/**
 * Load THREE.Texture from material JSON without writing to the material POJO.
 */
import * as THREE from "three";
import { log } from "./logger.js";
import { trackDisposableResource } from "../handler/trackedResourceRegistry.js";
import { createGifCanvasTextureFromMaterialJson } from "./gifAnimatedTexture.js";
import { resolveTextureSource } from "./resolveTextureSource.js";
import { resolvePublicAssetUrlCandidates } from "./assetsBase.js";
import { applyTexturePropsFromRecord } from "./textureSampling.js";
import {
  getCanonicalTexture,
  isTextureUrlCacheEnabled,
  rememberCanonicalTexture
} from "../cache/textureUrlCache.js";

function hasValue(value) {
  return value !== undefined && value !== null;
}

function valueOr(value, fallback) {
  return hasValue(value) ? value : fallback;
}

/** Same as the Three.js `Texture.repeat` default. */
const TEXTURE_REPEAT_DEFAULT = Object.freeze({ x: 1, y: 1 });

/**
 * @param {number|undefined|null} value
 * @param {number} [fallback=1]
 * @returns {number}
 */
function normalizeTextureRepeatComponent(value, fallback = TEXTURE_REPEAT_DEFAULT.x) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.max(0.01, n);
}

/**
 * @param {unknown} textureRepeat
 * @returns {boolean}
 */
function isDefaultTextureRepeat(textureRepeat) {
  if (textureRepeat === undefined || textureRepeat === null) {
    return true;
  }
  if (typeof textureRepeat !== "object" || Array.isArray(textureRepeat)) {
    return false;
  }
  const x = textureRepeat.x === undefined
    ? TEXTURE_REPEAT_DEFAULT.x
    : normalizeTextureRepeatComponent(textureRepeat.x, TEXTURE_REPEAT_DEFAULT.x);
  const y = textureRepeat.y === undefined
    ? TEXTURE_REPEAT_DEFAULT.y
    : normalizeTextureRepeatComponent(textureRepeat.y, TEXTURE_REPEAT_DEFAULT.y);
  return x === TEXTURE_REPEAT_DEFAULT.x && y === TEXTURE_REPEAT_DEFAULT.y;
}

function normalizeMaterialTextureKind(material) {
  const kind = String(material?.textureKind ?? material?.mapSourceKind ?? "image")
    .trim()
    .toLowerCase();
  if (kind === "video" || kind === "gif") {
    return kind;
  }
  return "image";
}

function tagTextureResolvedUrl(texture, url) {
  if (!texture || typeof url !== "string") {
    return;
  }
  const trimmed = url.trim();
  if (!trimmed.length) {
    return;
  }
  texture.userData = texture.userData || {};
  texture.userData.threeJsonResolvedUrl = trimmed;
}

/**
 * Pause and release the associated `HTMLVideoElement` when `THREE.Texture.dispose` runs.
 * @param {THREE.Texture} texture
 * @param {HTMLVideoElement} video
 */
function wrapVideoElementTextureDispose(texture, video) {
  if (!texture || !video || typeof texture.dispose !== "function") {
    return;
  }
  const innerDispose = texture.dispose.bind(texture);
  texture.dispose = function disposeVideoBackedTexture() {
    try {
      video.pause();
      video.removeAttribute("src");
      video.load();
    } catch (_) {
      /* ignore */
    }
    innerDispose();
  };
}

/**
 * @param {object} materialJson
 * @param {string} url
 * @param {{ wrapRepeat?: boolean, defaultRepeatX?: number, defaultRepeatY?: number }} [opts]
 * @returns {THREE.VideoTexture}
 */
function createVideoTextureFromMaterialJson(materialJson, url, opts = {}) {
  const video = document.createElement("video");
  video.setAttribute("playsinline", "");
  video.playsInline = true;
  video.muted = materialJson.videoMuted !== false;
  video.loop = materialJson.videoLoop !== false;
  const cors = materialJson.videoCrossOrigin ?? materialJson.crossOrigin;
  if (cors === "anonymous" || cors === "use-credentials") {
    video.crossOrigin = cors;
  } else if (/^https?:\/\//i.test(url) || url.startsWith("//")) {
    video.crossOrigin = "anonymous";
  }
  video.src = url;
  const texture = new THREE.VideoTexture(video);
  trackDisposableResource(texture);
  applyTextureRepeatToMap(texture, materialJson, opts);
  applyTexturePropsFromRecord(texture, "imageMap", materialJson);
  tagTextureResolvedUrl(texture, url);
  wrapVideoElementTextureDispose(texture, video);
  if (materialJson.videoAutoplay !== false) {
    const playPromise = video.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch((err) => {
        log.warn("[textureKind:video] video.play() failed:", url, err);
      });
    }
  }
  return texture;
}

function copyLoadedTextureIntoTarget(target, loaded, url) {
  if (!target || !loaded) {
    return;
  }
  target.image = loaded.image;
  target.source = loaded.source;
  target.flipY = loaded.flipY;
  target.colorSpace = loaded.colorSpace;
  target.needsUpdate = true;
  tagTextureResolvedUrl(target, url);
}

function loadTextureFallbackCandidate(loader, urls, index, target, cacheKey, previousError) {
  const url = urls[index];
  if (!url) {
    log.error("Texture load failed:", urls[0], previousError);
    return;
  }
  loader.load(
    url,
    (loaded) => {
      copyLoadedTextureIntoTarget(target, loaded, url);
      rememberCanonicalTexture(cacheKey, target);
    },
    undefined,
    (err) => loadTextureFallbackCandidate(loader, urls, index + 1, target, cacheKey, err)
  );
}
/**
 * @param {object} materialJson
 * @param {{
 *   loader?: THREE.TextureLoader,
 *   wrapRepeat?: boolean,
 *   defaultRepeatX?: number,
 *   defaultRepeatY?: number
 * }} [opts]
 * @returns {THREE.Texture|null}
 */
function loadTextureFromMaterialJson(materialJson, opts = {}) {
  if (!materialJson || typeof materialJson !== "object") {
    return null;
  }
  const rawUrl = resolveTextureSource(materialJson);
  if (!rawUrl) {
    return null;
  }
  const urls = resolvePublicAssetUrlCandidates(rawUrl);
  const url = urls[0];
  if (!url) {
    return null;
  }
  const kind = normalizeMaterialTextureKind(materialJson);
  const wrapRepeat = opts.wrapRepeat !== false;
  const defX = hasValue(opts.defaultRepeatX) ? opts.defaultRepeatX : TEXTURE_REPEAT_DEFAULT.x;
  const defY = hasValue(opts.defaultRepeatY) ? opts.defaultRepeatY : TEXTURE_REPEAT_DEFAULT.y;

  if (kind === "video") {
    return createVideoTextureFromMaterialJson(materialJson, url, {
      wrapRepeat,
      defaultRepeatX: defX,
      defaultRepeatY: defY
    });
  }
  if (kind === "gif") {
    const texture = createGifCanvasTextureFromMaterialJson(materialJson, url, {
      wrapRepeat,
      defaultRepeatX: defX,
      defaultRepeatY: defY
    });
    tagTextureResolvedUrl(texture, url);
    return texture;
  }

  if (isTextureUrlCacheEnabled()) {
    const canonical = getCanonicalTexture(rawUrl);
    if (canonical) {
      const tex = canonical.clone();
      trackDisposableResource(tex);
      applyTextureRepeatToMap(tex, materialJson, opts);
      applyTexturePropsFromRecord(tex, "imageMap", materialJson);
      tagTextureResolvedUrl(tex, canonical.userData?.threeJsonResolvedUrl || url);
      return tex;
    }
  }

  const loader = opts.loader ?? new THREE.TextureLoader();
  const texture = loader.load(
    url,
    (loaded) => {
      tagTextureResolvedUrl(loaded, url);
      rememberCanonicalTexture(rawUrl, loaded);
    },
    undefined,
    (err) => loadTextureFallbackCandidate(loader, urls, 1, texture, rawUrl, err)
  );
  trackDisposableResource(texture);
  rememberCanonicalTexture(rawUrl, texture);
  applyTextureRepeatToMap(texture, materialJson, opts);
  applyTexturePropsFromRecord(texture, "imageMap", materialJson);
  tagTextureResolvedUrl(texture, url);
  return texture;
}

/**
 * Apply `textureRepeat` from material JSON to an existing THREE.Texture (does not load a URL).
 *
 * @param {THREE.Texture|null|undefined} texture
 * @param {object|null|undefined} materialJson
 * @param {{ wrapRepeat?: boolean, defaultRepeatX?: number, defaultRepeatY?: number }} [opts]
 */
function applyTextureRepeatToMap(texture, materialJson, opts = {}) {
  if (!texture || !materialJson || typeof materialJson !== "object") {
    return;
  }
  const wrapRepeat = opts.wrapRepeat !== false;
  const defX = hasValue(opts.defaultRepeatX) ? opts.defaultRepeatX : TEXTURE_REPEAT_DEFAULT.x;
  const defY = hasValue(opts.defaultRepeatY) ? opts.defaultRepeatY : TEXTURE_REPEAT_DEFAULT.y;
  const tr = materialJson.textureRepeat || {};
  texture.wrapS = wrapRepeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.wrapT = wrapRepeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.repeat.set(
    wrapRepeat ? valueOr(tr.x, defX) : 1,
    wrapRepeat ? valueOr(tr.y, defY) : 1
  );
}

export {
  TEXTURE_REPEAT_DEFAULT,
  isDefaultTextureRepeat,
  normalizeTextureRepeatComponent,
  loadTextureFromMaterialJson,
  createVideoTextureFromMaterialJson,
  normalizeMaterialTextureKind,
  applyTextureRepeatToMap
};

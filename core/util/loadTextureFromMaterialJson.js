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
import { requestTexture, bindTextureWhenReady, whenTextureReady } from "../resource/textureRequest.js";
import { resolveRuntimeContext } from "../runtime/runtimeContext.js";
import { MATERIAL_TEXTURE_SLOTS } from "../texture/textureSlots.js";

const MATERIAL_TEXTURE_FIELD_TO_SLOT = Object.freeze({
  textureUrl: "baseColor",
  map: "baseColor",
  ...Object.fromEntries(
    Object.entries(MATERIAL_TEXTURE_SLOTS)
      .filter(([slot]) => slot !== "baseColor")
      .map(([slot, value]) => [value.descriptorField, slot])
  )
});

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
  const runtimeScope = resolveRuntimeContext(opts.runtimeScope);
  const rawUrl = resolveTextureSource(materialJson, runtimeScope);
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

  const texture = requestTexture(rawUrl, { ...opts, runtimeScope, replicas: opts.replicas || materialJson.textureResources?.baseColor?.replicas });
  trackDisposableResource(texture);
  applyTextureRepeatToMap(texture, materialJson, opts);
  applyTexturePropsFromRecord(texture, "imageMap", materialJson);
  tagTextureResolvedUrl(texture, url);
  return texture;
}

/** Whether a descriptor contains at least one supported color/PBR map URL. */
function materialJsonHasAnyTexture(materialJson) {
  if (!materialJson || typeof materialJson !== "object") return false;
  return Object.keys(MATERIAL_TEXTURE_FIELD_TO_SLOT).some((field) => {
    const value = materialJson[field];
    return typeof value === "string" && value.trim();
  });
}

/**
 * Load every supported texture field and assign it to a THREE.Material. Base-color retains the
 * existing image/video/GIF behavior; all physical maps are image textures.
 */
function applyMaterialTextureSetFromJson(threeMaterial, materialJson, opts = {}) {
  if (!threeMaterial || !materialJson || typeof materialJson !== "object") return {};
  const applied = {};
  for (const [field, slot] of Object.entries(MATERIAL_TEXTURE_FIELD_TO_SLOT)) {
    if (applied[slot]) continue;
    const rawUrl = materialJson[field];
    if (typeof rawUrl !== "string" || !rawUrl.trim()) continue;
    const definition = MATERIAL_TEXTURE_SLOTS[slot];
    const source = field === "textureUrl" || field === "map"
      ? materialJson
      : { ...materialJson, textureUrl: rawUrl.trim(), textureKind: "image", mapSourceKind: "image" };
    const texture = loadTextureFromMaterialJson(source, {
      ...opts,
      replicas: materialJson.textureResources?.[slot]?.replicas
    });
    if (!texture) continue;
    if (definition.color && "colorSpace" in texture) {
      texture.colorSpace = THREE.SRGBColorSpace;
    } else if ("colorSpace" in texture) {
      texture.colorSpace = THREE.NoColorSpace;
    }
    bindTextureWhenReady(threeMaterial, definition.runtimeField, texture, opts);
    applied[slot] = texture;
  }
  return applied;
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
  whenTextureReady,
  createVideoTextureFromMaterialJson,
  normalizeMaterialTextureKind,
  applyTextureRepeatToMap,
  materialJsonHasAnyTexture,
  applyMaterialTextureSetFromJson
};

/**
 * sceneConfig.intro normalization and activation checks.
 */
import { log } from "../util/logger.js";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function positiveMs(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function normalizeSlide(raw) {
  if (!isPlainObject(raw)) {
    return null;
  }
  const type = raw.type === "image" || raw.type === "text" ? raw.type : null;
  if (!type) {
    log.warn("[sceneIntro] slide skipped: type must be image or text");
    return null;
  }
  if (type === "image") {
    const url = typeof raw.url === "string" ? raw.url.trim() : "";
    if (!url) {
      log.warn("[sceneIntro] image slide skipped: url required");
      return null;
    }
    const durationMs = positiveMs(raw.durationMs, 0);
    if (durationMs <= 0) {
      log.warn("[sceneIntro] image slide skipped: durationMs must be > 0 for postLoad");
      return null;
    }
    return { type: "image", url, durationMs };
  }
  const content = raw.content != null ? String(raw.content) : "";
  if (!content) {
    log.warn("[sceneIntro] text slide skipped: content required");
    return null;
  }
  const durationMs = positiveMs(raw.durationMs, 0);
  if (durationMs <= 0) {
    log.warn("[sceneIntro] text slide skipped: durationMs must be > 0 for postLoad");
    return null;
  }
  const slide = { type: "text", content, durationMs };
  if (isPlainObject(raw.textStyle)) {
    slide.textStyle = { ...raw.textStyle };
  }
  return slide;
}

function normalizePostLoad(raw) {
  if (!isPlainObject(raw)) {
    return null;
  }
  const slidesIn = Array.isArray(raw.slides) ? raw.slides : [];
  const slides = [];
  for (let i = 0; i < slidesIn.length; i++) {
    const slide = normalizeSlide(slidesIn[i]);
    if (slide) {
      slides.push(slide);
    }
  }
  if (slides.length === 0) {
    return null;
  }
  const excludeFromLoadWait = raw.excludeFromLoadWait === true;
  const blockInteraction =
    raw.blockInteraction !== undefined
      ? raw.blockInteraction !== false
      : !excludeFromLoadWait;
  return {
    slides,
    fadeInMs: positiveMs(raw.fadeInMs, 300),
    fadeOutMs: positiveMs(raw.fadeOutMs, 600),
    skipOnClick: raw.skipOnClick !== false,
    blockInteraction,
    excludeFromLoadWait
  };
}

/**
 * @param {object} [raw]
 * @returns {object|null}
 */
export function normalizeIntroConfig(raw) {
  if (!isPlainObject(raw)) {
    return null;
  }
  if (raw.enabled === false) {
    return null;
  }
  const postLoad = normalizePostLoad(raw.postLoad);
  if (!postLoad) {
    if (raw.enabled === true || raw.postLoad) {
      log.warn("[sceneIntro] intro enabled but postLoad has no valid slides; intro disabled");
    }
    return null;
  }
  const out = {
    enabled: true,
    postLoad
  };
  if (typeof raw.backgroundColor === "string" && raw.backgroundColor.trim()) {
    out.backgroundColor = raw.backgroundColor.trim();
  }
  return out;
}

/**
 * @param {object} [intro]
 * @returns {boolean}
 */
export function isIntroEnabled(intro) {
  return intro?.enabled === true && Array.isArray(intro?.postLoad?.slides) && intro.postLoad.slides.length > 0;
}

/**
 * When true, intro runs detached and does not block createJsonScene / onSceneReady.
 * @param {object} [intro]
 * @returns {boolean}
 */
export function isIntroExcludedFromLoadWait(intro) {
  return isIntroEnabled(intro) && intro.postLoad.excludeFromLoadWait === true;
}

/**
 * @param {object} [intro]
 * @param {string} [syncLabel]
 */
export function warnIntroSkippedOnSyncPath(intro, syncLabel = "createJsonSceneSimple") {
  if (isIntroEnabled(intro)) {
    log.warn(
      `[ThreeJSON] ${syncLabel}: sceneConfig.intro requires createJsonScene (async); intro skipped`
    );
  }
}

/**
 * @param {object} [options]
 * @returns {HTMLElement|null}
 */
export function resolveIntroMountRoot(options = {}) {
  if (options.introRoot && options.introRoot.nodeType === 1) {
    return options.introRoot;
  }
  const canvas = options.canvas;
  if (canvas?.parentElement) {
    return canvas.parentElement;
  }
  return null;
}

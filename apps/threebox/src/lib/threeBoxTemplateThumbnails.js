/**
 * Template-card thumbnail pipeline, ported from tools/scene-host/threebox/js/threeBoxTemplateGallery.js's
 * thumbnail half (structure follows threebox-cloud's threeBoxTemplateThumbnails). An offscreen canvas
 * renders each template once via createJsonScene + captureSceneFrame, caches the JPEG data URL in
 * localStorage, and spreads a capture burst across idle windows. Module-level singleton state — this
 * genuinely is app-wide shared state (one offscreen canvas, one queue), not per-component, so it stays
 * a plain module rather than a hook. No @threejson/* package covers it, so the app carries it.
 */
import { resolveSceneHostUrl, sceneHostAssetUrl } from "@threejson/host-kit/js/sceneHostPaths.js";
import { enqueueSceneAgentLoad, isSceneAgentLoadBusy } from "@threejson/react-scene-agent/scene-load-queue";
import { loadThreeBoxSettingsBundle } from "./threeBoxSettingsStore.js";

const THUMB_CACHE_KEY = "threejson.threebox.thumbCache.v1";
const THUMB_CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const THUMB_WIDTH = 320;
const THUMB_HEIGHT = 200;
const THUMB_LOAD_TIMEOUT_MS = 8000;

export const PLACEHOLDER_THUMB_URL = sceneHostAssetUrl("assets/img/logo/threejson-logo-256.png");

let thumbCanvasHost = null;
let thumbCanvas = null;
let thumbQueue = [];
let thumbQueueRunning = false;
let thumbQueueScheduled = false;
let coreModulePromise = null;

function loadCoreModule() {
  coreModulePromise ||= import("threejson");
  return coreModulePromise;
}

function getThumbCanvas() {
  if (thumbCanvas?.isConnected) {
    return thumbCanvas;
  }
  // The off-screen positioning lives on a wrapping host div, not the canvas itself: core's
  // sceneConfig.intro postLoad overlay mounts into canvas.parentElement, so the host div is what
  // keeps any such overlay off-screen too.
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-99999px";
  host.style.top = "0";
  host.style.width = `${THUMB_WIDTH}px`;
  host.style.height = `${THUMB_HEIGHT}px`;
  host.style.overflow = "hidden";
  document.body.appendChild(host);
  thumbCanvasHost = host;
  thumbCanvas = document.createElement("canvas");
  thumbCanvas.width = THUMB_WIDTH;
  thumbCanvas.height = THUMB_HEIGHT;
  thumbCanvas.style.width = `${THUMB_WIDTH}px`;
  thumbCanvas.style.height = `${THUMB_HEIGHT}px`;
  host.appendChild(thumbCanvas);
  return thumbCanvas;
}

function withReducedQuality(payload) {
  const clone = structuredClone(payload || {});
  clone.sceneConfig = {
    ...clone.sceneConfig,
    renderer: { ...clone.sceneConfig?.renderer, antialias: false, ratioRate: 0.75 },
    textureDefaults: {
      ...clone.sceneConfig?.textureDefaults,
      ui: { generateMipmaps: false, anisotropy: 1, ...clone.sceneConfig?.textureDefaults?.ui },
      imageMap: { generateMipmaps: false, anisotropy: 1, ...clone.sceneConfig?.textureDefaults?.imageMap }
    }
  };
  // A thumbnail is a silent, offscreen, throwaway render — strip autoplay/looping audio entirely
  // rather than let it start playing the moment its card scrolls into view.
  if (clone.worldInfo?.audioList?.length) {
    clone.worldInfo = { ...clone.worldInfo, audioList: [] };
  }
  // Same reasoning for sceneConfig.intro postLoad slides: no viewer to show a welcome sequence to.
  if (clone.sceneConfig?.intro) {
    clone.sceneConfig = { ...clone.sceneConfig, intro: { ...clone.sceneConfig.intro, enabled: false } };
  }
  return clone;
}

function readThumbCache() {
  try {
    return JSON.parse(localStorage.getItem(THUMB_CACHE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function writeThumbCache(cache) {
  try {
    localStorage.setItem(THUMB_CACHE_KEY, JSON.stringify(cache));
  } catch {
    const entries = Object.entries(cache).sort((a, b) => (a[1]?.ts || 0) - (b[1]?.ts || 0));
    const trimmed = Object.fromEntries(entries.slice(Math.ceil(entries.length / 2)));
    try {
      localStorage.setItem(THUMB_CACHE_KEY, JSON.stringify(trimmed));
    } catch {
      /* give up */
    }
  }
}

/** Settings-modal toggle (general.templateThumbnailsEnabled, default on) — gates *automatic*
 * capture/cache reads only. The manual rebuild/clear actions bypass this. */
export function isThumbAutoCacheEnabled() {
  try {
    return loadThreeBoxSettingsBundle()?.general?.templateThumbnailsEnabled !== false;
  } catch {
    return true;
  }
}

/** Returns a cached thumbnail data URL if present and fresh, else null. */
export function getCachedThumbnail(jsonUrl) {
  const cache = readThumbCache();
  const cached = cache[jsonUrl];
  if (cached?.dataUrl && Date.now() - (cached.ts || 0) < THUMB_CACHE_TTL_MS) {
    return cached.dataUrl;
  }
  return null;
}

async function captureTemplateThumbnail(jsonUrl) {
  const { createJsonScene, captureSceneFrame } = await loadCoreModule();
  const resolvedUrl = resolveSceneHostUrl(jsonUrl);
  const response = await fetch(resolvedUrl);
  const payload = await response.json();
  const canvas = getThumbCanvas();
  let captured = null;
  const runtime = await enqueueSceneAgentLoad(() =>
    createJsonScene(withReducedQuality(payload), {
      canvas,
      resetScene: true,
      assetsBase: sceneHostAssetUrl("assets/"),
      onSceneReady: async (ctx) => {
        captured = await captureSceneFrame(ctx, {
          as: "dataUrl",
          mimeType: "image/jpeg",
          quality: 0.72,
          offscreen: true,
          offscreenWidth: THUMB_WIDTH,
          offscreenHeight: THUMB_HEIGHT
        });
      }
    })
  );
  runtime?.dispose?.();
  return captured?.dataUrl || null;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error("thumbnail timeout")), ms))
  ]);
}

/** Yields to the browser's idle time between captures so a multi-template burst is spread across
 * idle windows instead of running back-to-back. */
function idleYield() {
  return new Promise((resolve) => {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(() => resolve(), { timeout: 1000 });
    } else {
      setTimeout(resolve, 32);
    }
  });
}

async function runThumbQueue() {
  if (thumbQueueRunning) {
    return;
  }
  thumbQueueScheduled = false;
  thumbQueueRunning = true;
  const cache = readThumbCache();
  while (thumbQueue.length > 0) {
    const task = thumbQueue.shift();
    if (!task.isLive()) {
      continue;
    }
    try {
      const dataUrl = await withTimeout(captureTemplateThumbnail(task.jsonUrl), THUMB_LOAD_TIMEOUT_MS);
      if (dataUrl) {
        cache[task.jsonUrl] = { dataUrl, ts: Date.now() };
        writeThumbCache(cache);
        if (task.isLive()) {
          task.onCaptured(dataUrl);
        }
      }
    } catch (error) {
      console.warn("[threebox template gallery] thumbnail capture failed:", task.jsonUrl, error);
    }
    await idleYield();
  }
  thumbQueueRunning = false;
}

function scheduleThumbQueue() {
  if (thumbQueueRunning || thumbQueueScheduled) {
    return;
  }
  thumbQueueScheduled = true;
  const run = () => {
    if (isSceneAgentLoadBusy()) {
      thumbQueueScheduled = false;
      scheduleThumbQueue();
      return;
    }
    void runThumbQueue();
  };
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(run, { timeout: 2500 });
  } else {
    setTimeout(run, 600);
  }
}

/** Schedules a capture for `jsonUrl` (unless already fresh-cached — check getCachedThumbnail first).
 * `isLive`/`onCaptured` replace the original's direct DOM handle, since React components shouldn't
 * hand out live DOM refs into a module-level queue that may outlive them. */
export function enqueueThumbnail(jsonUrl, isLive, onCaptured) {
  thumbQueue.push({ jsonUrl, isLive, onCaptured });
  scheduleThumbQueue();
}

/** Settings-modal "清空缩略图缓存" action. */
export function clearThumbnailCache() {
  try {
    localStorage.removeItem(THUMB_CACHE_KEY);
  } catch {
    /* ignore */
  }
  thumbQueue = [];
}

/** Fired after clearThumbnailCache() so already-mounted TemplateCards (whose captured thumbnail lives
 * in local React state, not read live from the cache) know to drop it and re-capture. */
export const TEMPLATE_THUMB_CACHE_CLEARED_EVENT = "threejson:threebox:thumbCacheCleared";

/** Settings-modal "重建缩略图缓存" action: clears the cache, then lets each visible TemplateCard's
 * own IntersectionObserver-driven capture repopulate it. */
export function rebuildAllTemplateThumbnails() {
  clearThumbnailCache();
  window.dispatchEvent(new CustomEvent(TEMPLATE_THUMB_CACHE_CLEARED_EVENT));
}

export function disposeThumbCanvas() {
  thumbCanvasHost?.remove();
  thumbCanvasHost = null;
  thumbCanvas = null;
}

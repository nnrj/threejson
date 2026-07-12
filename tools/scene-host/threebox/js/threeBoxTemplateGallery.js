import { resolveSceneHostUrl, sceneHostAssetUrl } from "../../shared/js/sceneHostPaths.js";
import { showToast } from "./threeBoxUiFeedback.js";
import { t, getHostLocale } from "../../shared/i18n/index.js";
import { enqueueThreeBoxSceneLoad, isThreeBoxSceneLoadBusy } from "./threeBoxSceneLoadQueue.js";
import { loadThreeBoxSettingsBundle } from "./threeBoxSettingsStore.js";

/**
 * Template-card thumbnail pipeline: clone of website/js/site.js's examples-page pipeline
 * (hidden offscreen canvas + createJsonScene + captureSceneFrame + localStorage cache +
 * IntersectionObserver lazy capture), repointed at ThreeBox's own manifest/cache namespace.
 * Placeholder image + settings.general.templateThumbnailsEnabled gate + rebuild/clear actions
 * also mirror that page's `PLACEHOLDER_IMG` / `AUTO_THUMB_CACHE_STORAGE_KEY` / rebuild+clear
 * button pattern (website/js/site.js), wired through ThreeBox's own schema-driven settings
 * store instead of a standalone localStorage flag.
 */
const THUMB_CACHE_KEY = "threejson.threebox.thumbCache.v1";
const THUMB_CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const THUMB_WIDTH = 320;
const THUMB_HEIGHT = 200;
const THUMB_LOAD_TIMEOUT_MS = 8000;
const MANIFEST_REPO_RELATIVE_PATH = "assets/json/other/threebox/manifest.json";
const PLACEHOLDER_THUMB_URL = sceneHostAssetUrl("assets/img/ThreeJSON.png");

let thumbCanvas = null;
let thumbObserver = null;
let thumbQueue = [];
let thumbQueueRunning = false;
let thumbQueueScheduled = false;
let coreModulePromise = null;

function loadCoreModule() {
  coreModulePromise ||= import("threejson");
  return coreModulePromise;
}

function getThumbCanvas() {
  if (thumbCanvas && thumbCanvas.isConnected) {
    return thumbCanvas;
  }
  // The off-screen positioning lives on a wrapping host div, not the canvas itself: core's
  // sceneConfig.intro postLoad overlay (core/runtime/sceneIntroOverlay.js) mounts into
  // `canvas.parentElement`, not the canvas — if the canvas were appended straight to
  // document.body (as it used to be), that overlay's parent would be document.body itself,
  // and its `position:absolute; inset:0` would cover the real visible viewport instead of
  // following the canvas off-screen. Giving the canvas its own off-screen parent means any
  // DOM overlay a captured scene mounts this way inherits the same off-screen positioning.
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-99999px";
  host.style.top = "0";
  host.style.width = `${THUMB_WIDTH}px`;
  host.style.height = `${THUMB_HEIGHT}px`;
  host.style.overflow = "hidden";
  document.body.appendChild(host);
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
  // Some templates (e.g. the port scene) carry autoplay/looping background audio for full-page
  // shower-style viewing — a thumbnail is a silent, offscreen, throwaway render, so strip audio
  // entirely rather than let it start playing (and looping) the moment its card scrolls into view.
  if (clone.worldInfo?.audioList?.length) {
    clone.worldInfo = { ...clone.worldInfo, audioList: [] };
  }
  // Same reasoning for sceneConfig.intro postLoad slides (e.g. the port scene's model-credit
  // text): a thumbnail has no viewer to show a welcome/credits sequence to, and with
  // excludeFromLoadWait it would keep running detached — with its own fade timers — after this
  // capture's runtime is disposed, potentially overlapping a later capture that reuses the same
  // offscreen canvas host.
  if (clone.sceneConfig?.intro) {
    clone.sceneConfig = { ...clone.sceneConfig, intro: { ...clone.sceneConfig.intro, enabled: false } };
  }
  return clone;
}

function readThumbCache() {
  try {
    return JSON.parse(localStorage.getItem(THUMB_CACHE_KEY) || "{}") || {};
  } catch (_error) {
    return {};
  }
}

function writeThumbCache(cache) {
  try {
    localStorage.setItem(THUMB_CACHE_KEY, JSON.stringify(cache));
  } catch (_error) {
    const entries = Object.entries(cache).sort((a, b) => (a[1]?.ts || 0) - (b[1]?.ts || 0));
    const trimmed = Object.fromEntries(entries.slice(Math.ceil(entries.length / 2)));
    try {
      localStorage.setItem(THUMB_CACHE_KEY, JSON.stringify(trimmed));
    } catch (_error2) {
      /* give up */
    }
  }
}

/** Settings-modal toggle (general.templateThumbnailsEnabled, default on) — gates *automatic*
 * capture/cache reads only. The manual rebuild/clear actions in the settings modal bypass this
 * so a user who's turned auto-capture off can still populate the cache on demand. */
function isThumbAutoCacheEnabled() {
  try {
    return loadThreeBoxSettingsBundle()?.general?.templateThumbnailsEnabled !== false;
  } catch (_error) {
    return true;
  }
}

function resetThumbToPlaceholder(imgEl) {
  if (!imgEl) {
    return;
  }
  imgEl.src = PLACEHOLDER_THUMB_URL;
  imgEl.classList.remove("captured");
}

/** Template titles come from manifest.json, which carries a Chinese `title` plus an optional
 * English `titleEn` — falls back to `title` for templates that haven't been given an English
 * variant yet. */
function localizedTitle(item) {
  if (getHostLocale() === "en-US" && item.titleEn) {
    return item.titleEn;
  }
  return item.title || item.id;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error("thumbnail timeout")), ms))
  ]);
}

async function captureTemplateThumbnail(jsonUrl) {
  const { createJsonScene, captureSceneFrame } = await loadCoreModule();
  const resolvedUrl = resolveSceneHostUrl(jsonUrl);
  const response = await fetch(resolvedUrl);
  const payload = await response.json();
  const canvas = getThumbCanvas();
  let captured = null;
  const runtime = await enqueueThreeBoxSceneLoad(() =>
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

/** Yields to the browser's idle time between captures (rather than just the next microtask) so a
 * multi-template capture burst (e.g. all 5 template cards after a cold cache) is spread across
 * idle windows instead of running back-to-back — this is what keeps the UI responsive *during*
 * the capture run itself, on top of `scheduleThumbQueue` only starting the run once idle. */
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
    if (!task.imgEl.isConnected) {
      continue;
    }
    try {
      const dataUrl = await withTimeout(captureTemplateThumbnail(task.jsonUrl), THUMB_LOAD_TIMEOUT_MS);
      if (dataUrl) {
        cache[task.jsonUrl] = { dataUrl, ts: Date.now() };
        writeThumbCache(cache);
        if (task.imgEl.isConnected) {
          task.imgEl.src = dataUrl;
          task.imgEl.classList.add("captured");
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
    if (isThreeBoxSceneLoadBusy()) {
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

function enqueueThumbnail(jsonUrl, imgEl) {
  const cache = readThumbCache();
  const cached = cache[jsonUrl];
  if (cached?.dataUrl && Date.now() - (cached.ts || 0) < THUMB_CACHE_TTL_MS) {
    imgEl.src = cached.dataUrl;
    imgEl.classList.add("captured");
    return;
  }
  thumbQueue.push({ jsonUrl, imgEl });
  scheduleThumbQueue();
}

function getThumbObserver() {
  if (thumbObserver) {
    return thumbObserver;
  }
  thumbObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          continue;
        }
        thumbObserver.unobserve(entry.target);
        const jsonUrl = entry.target.dataset.jsonUrl;
        const imgEl = entry.target.querySelector("img");
        if (jsonUrl && imgEl) {
          enqueueThumbnail(jsonUrl, imgEl);
        }
      }
    },
    { rootMargin: "150px" }
  );
  return thumbObserver;
}

/**
 * @param {{ onSelectTemplate?: (item: object, payload: object) => void }} [host]
 */
export function createThreeBoxTemplateGallery(host = {}) {
  const templateGrid = document.getElementById("templateGrid");
  let items = [];

  async function loadManifest() {
    const url = resolveSceneHostUrl(MANIFEST_REPO_RELATIVE_PATH);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`manifest fetch failed: ${response.status}`);
    }
    const manifest = await response.json();
    return Array.isArray(manifest?.items) ? manifest.items : [];
  }

  function buildCardEl(item) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "templateCard";
    card.dataset.jsonUrl = item.json;
    card.dataset.templateId = item.id;

    const img = document.createElement("img");
    img.className = "templateCardThumb";
    img.alt = localizedTitle(item);
    img.loading = "lazy";
    img.src = PLACEHOLDER_THUMB_URL;
    card.appendChild(img);

    const label = document.createElement("div");
    label.className = "templateCardLabel";
    label.textContent = localizedTitle(item);
    card.appendChild(label);

    card.addEventListener("click", () => {
      void openTemplate(item);
    });

    return card;
  }

  async function openTemplate(item) {
    try {
      const url = resolveSceneHostUrl(item.json);
      const response = await fetch(url);
      const payload = await response.json();
      if (host.onSelectTemplate) {
        host.onSelectTemplate(item, payload);
      } else {
        showToast(
          t("threebox.gallery.selectedComingSoon", "已选择模板「{title}」，聊天区接入将在后续里程碑完成。", {
            title: localizedTitle(item)
          }),
          "info"
        );
      }
    } catch (error) {
      console.warn("[threebox template gallery] open failed:", error);
      showToast(t("threebox.gallery.loadFailed", "模板加载失败，请稍后重试。"), "warning");
    }
  }

  let lastFilterQuery = "";

  function renderCards(filterQuery = "") {
    if (!templateGrid) {
      return;
    }
    lastFilterQuery = filterQuery;
    templateGrid.innerHTML = "";
    const q = filterQuery.trim().toLowerCase();
    const filtered = q ? items.filter((item) => localizedTitle(item).toLowerCase().includes(q)) : items;
    // Cards always render with the placeholder thumb immediately (see buildCardEl); only the
    // *automatic* lazy-capture observation is gated by the setting, so turning it off just means
    // cards keep the placeholder (or whatever a manual rebuild last captured) instead of
    // recapturing on every visit.
    const autoCaptureEnabled = isThumbAutoCacheEnabled();
    const observer = autoCaptureEnabled ? getThumbObserver() : null;
    for (const item of filtered) {
      const card = buildCardEl(item);
      templateGrid.appendChild(card);
      observer?.observe(card);
    }
    if (filtered.length === 0) {
      const hint = document.createElement("div");
      hint.className = "sidebarStubHint";
      hint.textContent = t("threebox.gallery.noResults", "未找到匹配的模板。");
      templateGrid.appendChild(hint);
    }
  }

  function filter(query) {
    renderCards(query || "");
  }

  async function init() {
    try {
      items = await loadManifest();
    } catch (error) {
      console.warn("[threebox template gallery] manifest load failed:", error);
      items = [];
    }
    renderCards("");
  }

  /** Re-renders cards after a locale switch so titles/empty-state text pick up the new language,
   * preserving whatever search query was active. Also re-evaluates the auto-thumbnail-capture
   * setting, so toggling it in the settings modal takes effect on the very next save (settings
   * modal calls this via threeBoxApp.js's onSave, same as the locale-switch path). */
  function refresh() {
    renderCards(lastFilterQuery);
  }

  /** Settings-modal "清空缩略图缓存" action: drops the cache and resets every currently-rendered
   * card back to the placeholder image. Bypasses the auto-capture setting (it's just a cache
   * wipe, not a capture). */
  function clearThumbnailCache() {
    try {
      localStorage.removeItem(THUMB_CACHE_KEY);
    } catch (_error) {
      /* ignore */
    }
    thumbQueue = [];
    if (!templateGrid) {
      return;
    }
    templateGrid.querySelectorAll(".templateCardThumb").forEach((img) => resetThumbToPlaceholder(img));
  }

  /** Settings-modal "重建缩略图缓存" action: wipes the cache then re-queues every currently
   * rendered card for a fresh capture — runs in the background via the same idle-scheduled
   * queue as automatic capture, and bypasses the auto-capture setting so it works even when
   * that's turned off. */
  function rebuildThumbnailCache() {
    clearThumbnailCache();
    if (!templateGrid) {
      return;
    }
    const cards = Array.from(templateGrid.querySelectorAll(".templateCard"));
    for (const card of cards) {
      const jsonUrl = card.dataset.jsonUrl;
      const imgEl = card.querySelector("img");
      if (jsonUrl && imgEl) {
        thumbQueue.push({ jsonUrl, imgEl });
      }
    }
    scheduleThumbQueue();
  }

  return { init, filter, refresh, clearThumbnailCache, rebuildThumbnailCache };
}

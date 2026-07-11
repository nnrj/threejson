import { resolveSceneHostUrl, sceneHostAssetUrl } from "../../shared/js/sceneHostPaths.js";
import { showToast } from "./threeBoxUiFeedback.js";
import { t, getHostLocale } from "../../shared/i18n/index.js";

/**
 * Template-card thumbnail pipeline: clone of website/js/site.js's examples-page pipeline
 * (hidden offscreen canvas + createJsonScene + captureSceneFrame + localStorage cache +
 * IntersectionObserver lazy capture), repointed at ThreeBox's own manifest/cache namespace.
 */
const THUMB_CACHE_KEY = "threejson.threebox.thumbCache.v1";
const THUMB_CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const THUMB_WIDTH = 320;
const THUMB_HEIGHT = 200;
const THUMB_LOAD_TIMEOUT_MS = 8000;
const MANIFEST_REPO_RELATIVE_PATH = "assets/json/other/threebox/manifest.json";

let thumbCanvas = null;
let thumbObserver = null;
let thumbQueue = [];
let thumbQueueRunning = false;
let thumbQueueScheduled = false;
let coreModulePromise = null;

function loadCoreModule() {
  coreModulePromise ||= import("threejson/core");
  return coreModulePromise;
}

function getThumbCanvas() {
  if (thumbCanvas && thumbCanvas.isConnected) {
    return thumbCanvas;
  }
  thumbCanvas = document.createElement("canvas");
  thumbCanvas.width = THUMB_WIDTH;
  thumbCanvas.height = THUMB_HEIGHT;
  thumbCanvas.style.position = "fixed";
  thumbCanvas.style.left = "-99999px";
  thumbCanvas.style.width = `${THUMB_WIDTH}px`;
  thumbCanvas.style.height = `${THUMB_HEIGHT}px`;
  document.body.appendChild(thumbCanvas);
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
  const runtime = await createJsonScene(withReducedQuality(payload), {
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
  });
  runtime?.dispose?.();
  return captured?.dataUrl || null;
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
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  thumbQueueRunning = false;
}

function scheduleThumbQueue() {
  if (thumbQueueRunning || thumbQueueScheduled) {
    return;
  }
  thumbQueueScheduled = true;
  const run = () => {
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
    const observer = getThumbObserver();
    for (const item of filtered) {
      const card = buildCardEl(item);
      templateGrid.appendChild(card);
      observer.observe(card);
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
   * preserving whatever search query was active. */
  function refresh() {
    renderCards(lastFilterQuery);
  }

  return { init, filter, refresh };
}

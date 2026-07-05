/**
 * DOM overlay for sceneConfig.intro postLoad slides.
 */
import { log } from "../util/logger.js";
import { isIntroEnabled, isIntroExcludedFromLoadWait, resolveIntroMountRoot } from "./sceneIntroConfig.js";

const OVERLAY_CLASS = "threejson-scene-intro-overlay";

function sleep(ms, signal) {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      if (signal.aborted) {
        clearTimeout(timer);
        resolve();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

function preloadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load intro image: ${url}`));
    img.src = url;
  });
}

function ensureHostPosition(host) {
  const style = getComputedStyle(host);
  if (style.position === "static") {
    host.style.position = "relative";
  }
}

function createOverlayElement(introConfig) {
  const overlay = document.createElement("div");
  overlay.className = OVERLAY_CLASS;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-live", "polite");
  overlay.setAttribute("aria-label", "Scene introduction");
  const phase = introConfig.postLoad ?? {};
  const blockInteraction = phase.blockInteraction !== false;
  Object.assign(overlay.style, {
    position: "absolute",
    inset: "0",
    zIndex: "30",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "column",
    padding: "24px",
    boxSizing: "border-box",
    background: introConfig.backgroundColor || "rgba(16, 24, 32, 0.96)",
    color: "#e8eaed",
    opacity: "0",
    transition: "opacity 0ms linear",
    pointerEvents: blockInteraction ? "auto" : "none",
    cursor: blockInteraction && phase.skipOnClick !== false ? "pointer" : "default",
    userSelect: "none"
  });
  return overlay;
}

function bindIntroSkipHandler(introConfig, overlay, contentHost, abortController) {
  const phase = introConfig.postLoad ?? {};
  if (phase.skipOnClick === false) {
    return;
  }
  const blockInteraction = phase.blockInteraction !== false;
  const skipTarget = blockInteraction ? overlay : contentHost;
  if (!blockInteraction) {
    skipTarget.style.pointerEvents = "auto";
    skipTarget.style.cursor = "pointer";
  }
  skipTarget.addEventListener(
    "click",
    () => abortController.abort(),
    { once: true }
  );
}

function renderSlideContent(slide) {
  if (slide.type === "image") {
    const img = document.createElement("img");
    img.src = slide.url;
    img.alt = "";
    Object.assign(img.style, {
      maxWidth: "min(420px, 80vw)",
      maxHeight: "min(240px, 40vh)",
      objectFit: "contain"
    });
    return img;
  }
  const text = document.createElement("div");
  text.textContent = slide.content;
  const style = slide.textStyle && typeof slide.textStyle === "object" ? slide.textStyle : {};
  Object.assign(text.style, {
    fontSize: style.fontSizePx != null ? `${Number(style.fontSizePx)}px` : "22px",
    color: style.color || "#e8eaed",
    fontFamily: style.fontFamily || 'Arial, "Microsoft YaHei", sans-serif',
    textAlign: style.align || "center",
    lineHeight: "1.45",
    maxWidth: "min(640px, 88vw)",
    whiteSpace: "pre-wrap"
  });
  return text;
}

async function fadeOpacity(element, opacity, durationMs) {
  if (!element) {
    return;
  }
  element.style.transition = durationMs > 0 ? `opacity ${durationMs}ms ease` : "opacity 0ms linear";
  element.style.opacity = String(opacity);
  await sleep(durationMs);
}

/**
 * @param {object} introConfig normalized intro
 * @param {HTMLElement} mountRoot
 * @returns {Promise<void>}
 */
export async function runPostLoadIntro(introConfig, mountRoot) {
  if (!isIntroEnabled(introConfig) || !mountRoot || typeof document === "undefined") {
    return;
  }
  const phase = introConfig.postLoad;
  ensureHostPosition(mountRoot);
  const overlay = createOverlayElement(introConfig);
  const contentHost = document.createElement("div");
  contentHost.style.display = "flex";
  contentHost.style.flexDirection = "column";
  contentHost.style.alignItems = "center";
  contentHost.style.gap = "12px";
  overlay.appendChild(contentHost);
  mountRoot.appendChild(overlay);

  const abortController = new AbortController();
  const { signal } = abortController;

  bindIntroSkipHandler(introConfig, overlay, contentHost, abortController);

  try {
    await fadeOpacity(overlay, 1, phase.fadeInMs);

    for (let i = 0; i < phase.slides.length; i++) {
      if (signal.aborted) {
        break;
      }
      const slide = phase.slides[i];
      contentHost.replaceChildren();
      try {
        if (slide.type === "image") {
          await preloadImage(slide.url);
        }
        contentHost.appendChild(renderSlideContent(slide));
      } catch (err) {
        log.warn("[sceneIntro] slide skipped:", err?.message || err);
        continue;
      }
      await sleep(slide.durationMs, signal);
    }

    await fadeOpacity(overlay, 0, phase.fadeOutMs);
  } finally {
    overlay.remove();
  }
}

/**
 * @param {object} normalized payload slice with sceneConfig
 * @param {object} [options] createJsonScene options
 * @returns {Promise<void>}
 */
export async function runScenePostLoadIntroIfConfigured(normalized, options = {}) {
  const intro = normalized?.sceneConfig?.intro;
  if (!isIntroEnabled(intro)) {
    return;
  }
  const mountRoot = resolveIntroMountRoot(options);
  if (!mountRoot) {
    log.warn("[sceneIntro] postLoad intro skipped: no canvas parent or options.introRoot");
    return;
  }
  const task = runPostLoadIntro(intro, mountRoot);
  if (isIntroExcludedFromLoadWait(intro)) {
    void task.catch((err) => {
      log.warn("[sceneIntro] detached intro failed:", err?.message || err);
    });
    return;
  }
  await task;
}

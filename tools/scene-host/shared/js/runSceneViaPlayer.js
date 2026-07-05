import { buildEditorScenePayload } from "./buildEditorRuntimeConfig.js";
import {
  isScenePreviewMessageEvent,
  postScenePreviewMessage,
  SCENE_PREVIEW_CHANNEL
} from "./scenePreviewProtocol.js";
import {
  resolvePreviewBindSceneEvents,
  resolvePreviewHotReloadEnabled,
  resolvePreviewPlayerUrl
} from "./resolveEditorEventBinding.js";

const PREVIEW_WINDOW_NAME = "threejson-scene-preview";
const READY_TIMEOUT_MS = 15000;
const HOT_RELOAD_DEBOUNCE_MS = 700;

function defaultPlayerUrl() {
  return new URL("../player/index.html", window.location.href).href;
}

/**
 * @param {object} host
 */
export function createRunScenePreviewController(host) {
  /** @type {Window|null} */
  let previewWindow = null;
  let readyListener = null;
  let hotReloadTimer = null;
  let pushGeneration = 0;

  function cleanupReadyListener() {
    if (readyListener) {
      window.removeEventListener("message", readyListener);
      readyListener = null;
    }
  }

  function getEditorSettings() {
    return host.getEditorSettings?.() ?? null;
  }

  function resolvePlayerUrl() {
    return resolvePreviewPlayerUrl(getEditorSettings(), defaultPlayerUrl());
  }

  async function buildPayload() {
    await host.ensureCanvasSyncedBeforeExport?.();
    const sysConfig = host.getSysConfig?.();
    const editorSettings = getEditorSettings();
    return buildEditorScenePayload(sysConfig, editorSettings);
  }

  function resolveBindFlag(payload) {
    return resolvePreviewBindSceneEvents(getEditorSettings(), payload);
  }

  /**
   * @param {object} payload
   * @param {{ label?: string, bindSceneEvents?: boolean }} [options]
   */
  function sendLoadMessage(payload, options = {}) {
    if (!previewWindow || previewWindow.closed) {
      return false;
    }
    const label =
      String(options.label || payload?.label || payload?.name || "").trim() || "编辑器预览";
    return postScenePreviewMessage(previewWindow, {
      action: "load",
      payload,
      bindSceneEvents: options.bindSceneEvents ?? resolveBindFlag(payload),
      label
    });
  }

  function waitForPreviewReady(win) {
    cleanupReadyListener();
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        cleanupReadyListener();
        reject(new Error("播放器预览窗口未在时限内就绪。"));
      }, READY_TIMEOUT_MS);

      readyListener = (event) => {
        if (!isScenePreviewMessageEvent(event)) {
          return;
        }
        if (event.source !== win) {
          return;
        }
        if (event.data?.action !== "ready") {
          return;
        }
        window.clearTimeout(timer);
        cleanupReadyListener();
        resolve(true);
      };
      window.addEventListener("message", readyListener);
    });
  }

  async function pushPayload(options = {}) {
    const { silent = false } = options;
    if (!previewWindow || previewWindow.closed) {
      previewWindow = null;
      return false;
    }
    const gen = ++pushGeneration;
    let payload;
    try {
      payload = await buildPayload();
    } catch (error) {
      if (!silent) {
        host.showMessage?.(String(error.message || error), "error");
      }
      return false;
    }
    if (gen !== pushGeneration) {
      return false;
    }
    const ok = sendLoadMessage(payload, options);
    if (ok && !silent) {
      host.showMessage?.("已推送到播放器预览。", "success");
    }
    return ok;
  }

  function scheduleHotReload() {
    if (!resolvePreviewHotReloadEnabled(getEditorSettings())) {
      return;
    }
    if (!previewWindow || previewWindow.closed) {
      previewWindow = null;
      return;
    }
    window.clearTimeout(hotReloadTimer);
    hotReloadTimer = window.setTimeout(() => {
      void pushPayload({ silent: true });
    }, HOT_RELOAD_DEBOUNCE_MS);
  }

  async function runScene() {
    if (!host.getScene?.()?.isScene) {
      host.showMessage?.("请先加载或创建场景。", "warning");
      return false;
    }

    let payload;
    try {
      payload = await buildPayload();
    } catch (error) {
      host.showMessage?.(String(error.message || error), "error");
      return false;
    }

    const playerUrl = resolvePlayerUrl();
    const url = new URL(playerUrl, window.location.href);
    url.searchParams.set("editorPreview", "1");

    const reuse =
      previewWindow &&
      !previewWindow.closed &&
      previewWindow.location.href.startsWith(new URL(url.origin + url.pathname, url.href).href.split("?")[0]);

    if (!reuse) {
      previewWindow = window.open(url.href, PREVIEW_WINDOW_NAME);
    } else {
      previewWindow.focus?.();
    }

    if (!previewWindow) {
      host.showMessage?.("无法打开播放器窗口（可能被浏览器拦截弹窗）。", "warning");
      return false;
    }

    try {
      await waitForPreviewReady(previewWindow);
    } catch (error) {
      host.showMessage?.(String(error.message || error), "warning");
      return false;
    }

    const ok = sendLoadMessage(payload, {
      label: payload?.label || payload?.name || "编辑器预览"
    });
    if (ok) {
      host.showMessage?.("已在播放器中运行场景。", "success");
    }
    return ok;
  }

  function dispose() {
    cleanupReadyListener();
    window.clearTimeout(hotReloadTimer);
    hotReloadTimer = null;
    previewWindow = null;
  }

  return {
    runScene,
    pushPayload,
    scheduleHotReload,
    dispose,
    isPreviewOpen: () => Boolean(previewWindow && !previewWindow.closed)
  };
}

export { SCENE_PREVIEW_CHANNEL };

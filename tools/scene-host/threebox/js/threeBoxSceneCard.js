import { sceneHostAssetUrl } from "../../shared/js/sceneHostPaths.js";
import { showToast } from "./threeBoxUiFeedback.js";
import { t } from "../../shared/i18n/index.js";
import { enqueueThreeBoxSceneLoad } from "./threeBoxSceneLoadQueue.js";
import {
  openThreeBoxMeshExportDialog,
  showThreeBoxMeshExportWarningDialog
} from "./threeBoxMeshExportDialog.js";
import { syncThreeBoxPreviewAuxiliaryLights } from "./threeBoxPreviewLights.js";

const EDITOR_OPEN_SCENE_BRIDGE_PREFIX = "threejson.editor.openScene.";
const SCENE_PREVIEW_CHANNEL = "threejson:scene-preview";
const SCENE_PREVIEW_VERSION = 1;

function isScenePreviewMessageEvent(event) {
  if (!event || typeof event.data !== "object" || event.data === null) {
    return false;
  }
  if (event.origin && event.origin !== window.location.origin) {
    return false;
  }
  const data = event.data;
  return data.channel === SCENE_PREVIEW_CHANNEL && data.version === SCENE_PREVIEW_VERSION;
}

function postScenePreviewMessage(target, message) {
  if (!target || target.closed) {
    return false;
  }
  target.postMessage({ channel: SCENE_PREVIEW_CHANNEL, version: SCENE_PREVIEW_VERSION, ...message }, window.location.origin);
  return true;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function actionBtnHtml(title, glyph) {
  return `<button type="button" class="sceneCardActionBtn" title="${title}" aria-label="${title}">${glyph}</button>`;
}

/**
 * Inline scene canvas embedded at the end of an AI-generated chat reply, with an always-visible
 * action bar below the canvas (download JSON / export .tjz / export 3D model / open in editor / open in player /
 * fullscreen). Placed below rather than as a canvas hover overlay so it stays reliably reachable
 * regardless of pointer/touch input and doesn't compete with orbit-control drag gestures on the
 * canvas itself.
 */
export function createThreeBoxSceneCard(cardOptions = {}) {
  const el = document.createElement("div");
  el.className = "sceneCard";
  const canvasWrap = document.createElement("div");
  canvasWrap.className = "sceneCardCanvasWrap";
  el.appendChild(canvasWrap);
  const canvas = document.createElement("canvas");
  canvas.className = "sceneCardCanvas";
  canvasWrap.appendChild(canvas);
  const loadingMask = document.createElement("div");
  loadingMask.className = "sceneCardLoadingMask";
  loadingMask.textContent = t("threebox.sceneCard.waitingForDraft", "等待场景草稿…");
  canvasWrap.appendChild(loadingMask);

  const actionBar = document.createElement("div");
  actionBar.className = "sceneCardActionBar";
  actionBar.innerHTML = [
    actionBtnHtml(t("threebox.sceneCard.downloadJson", "下载 JSON"), "&#8681;"),
    actionBtnHtml(t("threebox.sceneCard.exportTjz", "导出 .tjz 场景包"), "&#128230;"),
    actionBtnHtml(t("threebox.sceneCard.exportMesh", "导出三方模型"), "&#9672;"),
    actionBtnHtml(t("threebox.sceneCard.openInEditor", "在编辑器内打开"), "&#9998;"),
    actionBtnHtml(t("threebox.sceneCard.openInPlayer", "在播放器内打开"), "&#9654;"),
    actionBtnHtml(t("threebox.sceneCard.refresh", "刷新画布"), "&#8635;"),
    actionBtnHtml(t("threebox.sceneCard.fullscreen", "全屏"), "&#10021;")
  ].join("");
  el.appendChild(actionBar);
  const [downloadBtn, exportBtn, exportMeshBtn, openEditorBtn, openPlayerBtn, refreshBtn, fullscreenBtn] =
    actionBar.querySelectorAll(".sceneCardActionBtn");

  let runtime = null;
  let liveResizeObserver = null;
  let currentSceneJson = null;
  let renderSeq = 0;
  let currentLabel = t("threebox.sceneCard.defaultLabel", "ThreeBox 场景");

  function setLabel(label) {
    const nextLabel = String(label || "").trim();
    if (nextLabel) {
      currentLabel = nextLabel;
    }
    return currentLabel;
  }

  /** Keeps the canvas in sync with its container's actual size after first paint (e.g. the left
   * dock being pinned/unpinned reflows the message column width) — createJsonScene's own
   * autoResize is force-disabled above so it never follows window resizes, so this is the only
   * thing that keeps the card responsive post-render. */
  function watchLiveResize() {
    liveResizeObserver?.disconnect();
    liveResizeObserver = new ResizeObserver((entries) => {
      if (!runtime) {
        return;
      }
      const entry = entries[0];
      const box = entry.contentBoxSize?.[0];
      const width = Math.max(1, Math.round(box ? box.inlineSize : entry.contentRect.width));
      const height = Math.max(1, Math.round(box ? box.blockSize : entry.contentRect.height));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      runtime.resize?.({ width, height });
    });
    liveResizeObserver.observe(canvasWrap);
  }

  /** Resolves with the element's actual laid-out content-box size. More reliable than
   * requestAnimationFrame-counting for catching the moment CSS (aspect-ratio, flex, an ancestor's
   * `hidden` toggle) has actually settled — ResizeObserver's first callback fires with the real
   * computed size, whereas a fixed number of rAFs can still race ahead of layout in some cases. */
  function waitForStableSize(target) {
    const readSize = () => {
      const rect = target?.getBoundingClientRect?.();
      const width = Math.round(rect?.width || target?.clientWidth || 0);
      const height = Math.round(rect?.height || target?.clientHeight || 0);
      return width > 0 && height > 0 ? { width, height } : null;
    };
    const immediate = readSize();
    if (immediate) {
      return Promise.resolve(immediate);
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = (size) => {
        if (settled) {
          return;
        }
        settled = true;
        ro.disconnect();
        clearTimeout(timeoutId);
        resolve(size);
      };
      const ro = new ResizeObserver((entries) => {
        const entry = entries[0];
        const box = entry.contentBoxSize?.[0];
        const width = box ? Math.round(box.inlineSize) : Math.round(entry.contentRect.width);
        const height = box ? Math.round(box.blockSize) : Math.round(entry.contentRect.height);
        if (width > 0 && height > 0) {
          finish({ width, height });
        }
      });
      ro.observe(target);
      // A hidden/collapsed chat container should not hold scene startup forever. The aspect-ratio
      // CSS gives us a safe fallback until the live ResizeObserver catches the real size later.
      const timeoutId = setTimeout(() => {
        const fallback = readSize() || { width: 320, height: 180 };
        finish(fallback);
      }, 250);
    });
  }

  /** Gives the browser one real paint opportunity after the card and loading mask are laid out,
   * before structuredClone/createJsonScene begin potentially heavy main-thread work. Two frames
   * are intentional: an rAF callback runs before its frame is painted, so resuming on the next
   * rAF guarantees the first frame (with the mask) had a chance to reach the screen. */
  function waitForLoadingMaskPaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(resolve);
    });
  }

  function showCompactLoadingProgress(deploy = null) {
    loadingMask.classList.add("sceneCardLoadingMaskCompact");
    const done = Number(deploy?.done);
    const total = Number(deploy?.total);
    loadingMask.textContent = Number.isFinite(done) && Number.isFinite(total) && total > 0
      ? t(
          "threebox.sceneCard.loadingProgress",
          "正在装载场景内容 {done}/{total}（不消耗 Token）…",
          { done, total }
        )
      : t(
          "threebox.sceneCard.loadingContent",
          "画布已启动，正在装载场景内容（不消耗 Token）…"
        );
  }

  async function render(sceneJsonPayload, options = {}) {
    const seq = ++renderSeq;
    liveResizeObserver?.disconnect();
    liveResizeObserver = null;
    runtime?.dispose?.();
    runtime = null;
    currentSceneJson = sceneJsonPayload;
    setLabel(
      options.label || sceneJsonPayload?.label || sceneJsonPayload?.name || t("threebox.sceneCard.defaultLabel", "ThreeBox 场景")
    );
    loadingMask.textContent = t("threebox.sceneCard.rendering", "场景渲染中（不消耗 Token）…");
    loadingMask.classList.remove("sceneCardLoadingMaskCompact");
    loadingMask.hidden = false;
    const { createJsonScene } = await import("threejson");
    const { width, height } = await waitForStableSize(canvasWrap);
    // Pin the canvas's own CSS box explicitly: core's render loop resizes against
    // canvas.clientWidth/clientHeight on its first frame regardless of payload.canvasWidth/Height
    // (see core/handler/frameLoopHandler.js), so a canvas that merely inherits width:100% from an
    // as-yet-unsettled ancestor can catch a stale full-viewport size on that first frame.
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = width;
    canvas.height = height;
    await waitForLoadingMaskPaint();
    const payload = structuredClone(sceneJsonPayload || {});
    payload.canvasWidth = width;
    payload.canvasHeight = height;
    // Source scenes (e.g. full-page templates like roomShow.json) often set
    // sceneConfig.renderLoop.autoResize for a full-window host; an inline embedded card must not
    // follow window resizes, so this is force-disabled regardless of what the scene JSON says.
    payload.sceneConfig = {
      ...payload.sceneConfig,
      renderLoop: { ...payload.sceneConfig?.renderLoop, autoResize: false, firstAutoResize: false }
    };
    let auxiliaryLightsSynced = false;
    const syncAuxiliaryLights = (nextRuntime) => {
      if (auxiliaryLightsSynced || seq !== renderSeq || !nextRuntime?.scene) {
        return;
      }
      const auxiliaryLightsEnabled = typeof cardOptions.shouldUsePreviewAuxiliaryLights === "function"
        ? cardOptions.shouldUsePreviewAuxiliaryLights() !== false
        : cardOptions.previewAuxiliaryLights !== false;
      syncThreeBoxPreviewAuxiliaryLights(nextRuntime.scene, auxiliaryLightsEnabled);
      auxiliaryLightsSynced = true;
    };
    const activateRuntime = (nextRuntime) => {
      if (!nextRuntime || seq !== renderSeq) {
        return false;
      }
      if (runtime !== nextRuntime) {
        runtime = nextRuntime;
        runtime.start?.();
        watchLiveResize();
      }
      runtime.resize?.({ width, height });
      showCompactLoadingProgress();
      return true;
    };
    try {
      const nextRuntime = await enqueueThreeBoxSceneLoad(() =>
        createJsonScene(payload, {
          canvas,
          resetScene: true,
          assetsBase: sceneHostAssetUrl("assets/"),
          autoFillLights: true,
          autoFillCamera: true,
          autoFitCamera: true,
          onRuntimeReady: ({ runtime: readyRuntime }) => {
            activateRuntime(readyRuntime);
          },
          onDeployProgress: ({ runtime: deployingRuntime, deploy }) => {
            if (seq !== renderSeq) {
              return;
            }
            syncAuxiliaryLights(deployingRuntime);
            showCompactLoadingProgress(deploy);
          },
          onSceneReady: ({ runtime: readyRuntime }) => {
            syncAuxiliaryLights(readyRuntime);
          }
        })
      );
      if (seq !== renderSeq) {
        nextRuntime?.dispose?.();
        return null;
      }
      activateRuntime(nextRuntime);
      syncAuxiliaryLights(nextRuntime);
    } finally {
      if (seq === renderSeq) {
        loadingMask.hidden = true;
      }
    }
    return runtime;
  }

  function dispose() {
    renderSeq += 1;
    liveResizeObserver?.disconnect();
    liveResizeObserver = null;
    runtime?.dispose?.();
    runtime = null;
  }

  function requireSceneJson() {
    if (!currentSceneJson) {
      showToast(t("threebox.sceneCard.notReady", "场景尚未生成完成。"), "warning");
      return null;
    }
    return currentSceneJson;
  }

  downloadBtn.addEventListener("click", () => {
    const sceneJson = requireSceneJson();
    if (!sceneJson) {
      return;
    }
    const blob = new Blob([JSON.stringify(sceneJson, null, 2)], { type: "application/json" });
    downloadBlob(blob, `${currentLabel}.json`);
  });

  exportBtn.addEventListener("click", async () => {
    const sceneJson = requireSceneJson();
    if (!sceneJson) {
      return;
    }
    exportBtn.disabled = true;
    try {
      const { packJsonSceneArchive } = await import("threejson");
      const blob = await packJsonSceneArchive(sceneJson, { outputType: "blob" });
      downloadBlob(blob, `${currentLabel}.tjz`);
    } catch (error) {
      showToast(t("threebox.sceneCard.exportFailed", "导出失败：{error}", { error: error?.message || error }), "error");
    } finally {
      exportBtn.disabled = false;
    }
  });

  exportMeshBtn.addEventListener("click", async () => {
    const sceneJson = requireSceneJson();
    if (!sceneJson) {
      return;
    }
    const format = await openThreeBoxMeshExportDialog();
    if (!format) {
      return;
    }
    if (!runtime?.scene?.isScene) {
      showToast(t("threebox.sceneCard.modelNotReady", "画布场景尚未渲染完成。"), "warning");
      return;
    }
    exportMeshBtn.disabled = true;
    const formatLabel = format.toUpperCase();
    showToast(t("threebox.sceneCard.exportMeshStarted", "正在导出 {format}…", { format: formatLabel }), "info");
    try {
      const { exportMesh } = await import("threejson");
      const result = await exportMesh(runtime.scene, {
        format,
        scope: "scene",
        externalModelPolicy: "include",
        renderer: runtime.renderer,
        fileNameStem: currentLabel
      });
      const payload = result.data instanceof ArrayBuffer ? result.data : String(result.data || "");
      const blob = new Blob([payload], { type: result.mimeType || "application/octet-stream" });
      downloadBlob(blob, result.fileNameHint || `${currentLabel}.${result.extension || format}`);
      const warnings = Array.isArray(result.warnings)
        ? result.warnings.filter((entry) => String(entry?.message || "").trim())
        : [];
      const showWarningDialog = typeof cardOptions.shouldShowMeshExportWarnings === "function"
        ? cardOptions.shouldShowMeshExportWarnings() !== false
        : cardOptions.showMeshExportWarnings !== false;
      if (warnings.length && showWarningDialog) {
        await showThreeBoxMeshExportWarningDialog(warnings);
      } else {
        showToast(t("threebox.sceneCard.exportMeshSuccess", "三方模型已导出。"), "success");
      }
    } catch (error) {
      console.error("[threebox] mesh export failed:", error);
      showToast(
        t("threebox.sceneCard.exportMeshFailed", "导出三方模型失败：{error}", { error: error?.message || error }),
        "error"
      );
    } finally {
      exportMeshBtn.disabled = false;
    }
  });

  openEditorBtn.addEventListener("click", () => {
    const sceneJson = requireSceneJson();
    if (!sceneJson) {
      return;
    }
    try {
      const bridgeId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(
        `${EDITOR_OPEN_SCENE_BRIDGE_PREFIX}${bridgeId}`,
        JSON.stringify({ source: "threebox", createdAt: Date.now(), label: currentLabel, sceneJson })
      );
      const url = `../editor/index.html?openFrom=threebox&sceneKey=${encodeURIComponent(bridgeId)}`;
      window.open(url, "_blank", "noopener");
    } catch (error) {
      showToast(
        t("threebox.sceneCard.openInEditorFailed", "在编辑器内打开失败：{error}", { error: error?.message || error }),
        "error"
      );
    }
  });

  openPlayerBtn.addEventListener("click", () => {
    const sceneJson = requireSceneJson();
    if (!sceneJson) {
      return;
    }
    const win = window.open("../player/index.html?editorPreview=1", "_blank");
    if (!win) {
      showToast(t("threebox.sceneCard.popupBlocked", "无法打开新窗口，请检查浏览器弹窗拦截设置。"), "warning");
      return;
    }
    let sent = false;
    const onMessage = (event) => {
      if (!isScenePreviewMessageEvent(event) || event.source !== win) {
        return;
      }
      if (event.data?.action === "ready" && !sent) {
        sent = true;
        postScenePreviewMessage(win, { action: "load", payload: sceneJson, label: currentLabel, bindSceneEvents: false });
      }
      if (event.data?.action === "loaded") {
        window.removeEventListener("message", onMessage);
        if (!event.data.ok) {
          showToast(
            t("threebox.sceneCard.openInPlayerFailed", "在播放器内打开失败：{error}", { error: event.data.error || "" }),
            "error"
          );
        }
      }
    };
    window.addEventListener("message", onMessage);
    setTimeout(() => window.removeEventListener("message", onMessage), 15000);
  });

  /** Reloads the SAME JSON this card currently holds back into the canvas, from scratch. This is
   * a plain re-render of `currentSceneJson` (whatever this card instance was last rendered with) —
   * not a re-fetch of anything — so a card showing a live turn's freshly-adjusted result reloads
   * that result, and a card showing a past conversation's history (rendered by switchToConversation
   * from cached/reconstructed JSON) reloads that same historical JSON, never today's latest turn. */
  refreshBtn.addEventListener("click", async () => {
    const sceneJson = requireSceneJson();
    if (!sceneJson) {
      return;
    }
    refreshBtn.disabled = true;
    try {
      await render(sceneJson, { label: currentLabel });
    } finally {
      refreshBtn.disabled = false;
    }
  });

  fullscreenBtn.addEventListener("click", () => {
    if (document.fullscreenElement === canvasWrap) {
      void document.exitFullscreen();
      return;
    }
    canvasWrap.requestFullscreen?.().catch((error) => {
      showToast(t("threebox.sceneCard.fullscreenFailed", "进入全屏失败：{error}", { error: error?.message || error }), "warning");
    });
  });

  return {
    el,
    canvas,
    render,
    dispose,
    setLabel,
    setPreviewAuxiliaryLightsEnabled: (enabled) =>
      syncThreeBoxPreviewAuxiliaryLights(runtime?.scene, enabled !== false),
    getRuntime: () => runtime
  };
}

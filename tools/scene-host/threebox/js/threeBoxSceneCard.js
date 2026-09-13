import { sceneHostAssetUrl } from "../../shared/js/sceneHostPaths.js";
import {
  isScenePreviewMessageEvent,
  postScenePreviewMessage,
  resolveScenePreviewPeerOrigin
} from "../../shared/js/scenePreviewProtocol.js";
import { showToast } from "./threeBoxUiFeedback.js";
import { t } from "../../shared/i18n/index.js";
import { enqueueThreeBoxSceneLoad } from "./threeBoxSceneLoadQueue.js";
import {
  openThreeBoxMeshExportDialog,
  showThreeBoxMeshExportWarningDialog
} from "./threeBoxMeshExportDialog.js";
import { syncThreeBoxPreviewAuxiliaryLights } from "./threeBoxPreviewLights.js";
import { ensureThreeBoxSceneCapabilitiesForPayload } from "./threeBoxAiCapabilities.js";
import { captureMeshReviewViews } from "../../shared/js/meshViewCapture.js";
import { createCanvasRenderActivity } from "../../shared/js/canvasRenderActivity.js";
import { createSceneCardSession, createSceneCardViewport } from "../../shared/js/sceneCardSession.js";
import { createSceneResourceDiagnosticsView } from "../../shared/js/sceneResourceDiagnostics.js";
import { sharedSceneViewportPool } from "../../shared/js/sceneViewportPool.js";

const EDITOR_OPEN_SCENE_BRIDGE_PREFIX = "threejson.editor.openScene.";

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
  const viewportMount = document.createElement("div");
  Object.assign(viewportMount.style, { position: "absolute", inset: "0" });
  canvasWrap.appendChild(viewportMount);
  const activateButton = document.createElement("button");
  activateButton.type = "button";
  activateButton.hidden = true;
  activateButton.className = "sceneCardActivate";
  Object.assign(activateButton.style, { position: "absolute", inset: "0", width: "100%", height: "100%", border: "0", padding: "0", color: "inherit", background: "var(--panel-bg, #282b33)", cursor: "pointer" });
  const previewImage = document.createElement("img");
  previewImage.alt = ""; previewImage.hidden = true;
  Object.assign(previewImage.style, { width: "100%", height: "100%", objectFit: "contain" });
  const activateLabel = document.createElement("span");
  activateLabel.textContent = t("threebox.sceneCard.activate", "点击查看并交互");
  Object.assign(activateLabel.style, { position: "absolute", bottom: "16px", left: "50%", transform: "translateX(-50%)", padding: "7px 12px", borderRadius: "8px", color: "#fff", background: "#222c", whiteSpace: "nowrap" });
  activateButton.append(previewImage, activateLabel); canvasWrap.appendChild(activateButton);
  let canvas = null;
  const loadingMask = document.createElement("div");
  loadingMask.className = "sceneCardLoadingMask";
  loadingMask.textContent = t("threebox.sceneCard.waitingForDraft", "等待场景草稿…");
  canvasWrap.appendChild(loadingMask);

  // Shown only when automatic negotiation selected incremental construction (or a complete output
  // genuinely overflowed and fell back to it). Distinct from loadingMask: the canvas is already
  // interactive and showing real content while follow-up construction is in progress.
  const draftBadge = document.createElement("div");
  draftBadge.className = "sceneCardDraftBadge";
  draftBadge.textContent = t("threebox.sceneCard.draftBadge", "草稿 · 自动细化中…");
  draftBadge.hidden = true;
  canvasWrap.appendChild(draftBadge);

  const textureBadge = document.createElement("div");
  textureBadge.className = "sceneCardTextureBadge";
  textureBadge.hidden = true;
  canvasWrap.appendChild(textureBadge);
  let textureBadgeTimer = null;

  function setDraftStatus(status = "") {
    const state = String(status || "").trim().toLowerCase();
    if (!state) {
      draftBadge.hidden = true;
      delete draftBadge.dataset.state;
      return;
    }
    draftBadge.textContent = state === "paused"
      ? t("threebox.sceneCard.draftPausedBadge", "草稿 · 细化已暂停")
      : t("threebox.sceneCard.draftBadge", "草稿 · 自动细化中…");
    draftBadge.dataset.state = state;
    draftBadge.hidden = false;
  }

  function setDraftState(isDraft) {
    setDraftStatus(isDraft ? "refining" : "");
  }

  function setTextureProgress(event = {}) {
    clearTimeout(textureBadgeTimer);
    textureBadgeTimer = null;
    const total = Math.max(0, Number(event.total) || 0);
    const completed = Math.max(0, Number(event.completed) || 0);
    if (event.phase === "planned" && total > 0) {
      textureBadge.title = "";
      textureBadge.textContent = t("threebox.sceneCard.texturePlanned", "正在完善纹理 · 0/{total}", { total });
      textureBadge.dataset.state = "working";
      textureBadge.hidden = false;
      return;
    }
    if (event.phase === "acquiring" || event.phase === "task-complete") {
      textureBadge.title = "";
      textureBadge.textContent = t("threebox.sceneCard.textureProgress", "正在完善纹理 · {completed}/{total}", {
        completed,
        total
      });
      textureBadge.dataset.state = "working";
      textureBadge.hidden = total === 0;
      return;
    }
    if (event.phase === "complete") {
      const assignments = Math.max(0, Number(event.assignments) || 0);
      const pendingLicense = Math.max(0, Number(event.pendingLicense) || 0);
      const pendingItems = Array.isArray(event.pendingLicenseItems) ? event.pendingLicenseItems : [];
      if (!total) {
        textureBadge.hidden = true;
        return;
      }
      textureBadge.textContent = pendingLicense
        ? t("threebox.sceneCard.textureLicensePending", "已完善 {assignments} 项 · {pendingLicense} 项需许可确认", {
            assignments,
            pendingLicense
          })
        : assignments
          ? t("threebox.sceneCard.textureComplete", "纹理已完善 · {assignments}/{total}", { assignments, total })
          : t("threebox.sceneCard.textureUnchanged", "未找到可安全应用的纹理");
      textureBadge.dataset.state = pendingLicense ? "neutral" : assignments ? "complete" : "neutral";
      textureBadge.title = pendingItems
        .map((item) => [
          item.objectName || item.query || item.taskId,
          item.candidateName || item.candidateId,
          item.source,
          item.license?.id || item.license?.name || item.license?.status || "unknown"
        ].filter(Boolean).join(" · "))
        .join("\n");
      textureBadge.hidden = false;
      // Unknown-license candidates require an explicit user decision, so their details must stay
      // inspectable instead of disappearing like a transient success notification.
      if (!pendingLicense) {
        textureBadgeTimer = setTimeout(() => { textureBadge.hidden = true; }, 4200);
      }
      return;
    }
    if (event.phase === "failed") {
      textureBadge.title = "";
      textureBadge.textContent = t("threebox.sceneCard.textureFailed", "纹理服务暂不可用，已保留基础材质");
      textureBadge.dataset.state = "warning";
      textureBadge.hidden = false;
      textureBadgeTimer = setTimeout(() => { textureBadge.hidden = true; }, 5200);
      return;
    }
    textureBadge.title = "";
    textureBadge.hidden = true;
  }

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
  const diagnosticsView = createSceneResourceDiagnosticsView();
  el.appendChild(diagnosticsView.element);
  const [downloadBtn, exportBtn, exportMeshBtn, openEditorBtn, openPlayerBtn, refreshBtn, fullscreenBtn] =
    actionBar.querySelectorAll(".sceneCardActionBtn");

  let runtime = null;
  let liveResizeObserver = null;
  let currentSceneJson = null;
  let renderSeq = 0;
  let currentLabel = t("threebox.sceneCard.defaultLabel", "ThreeBox 场景");
  const renderActivity = createCanvasRenderActivity({
    element: canvasWrap,
    getRuntime: () => runtime
  });
  renderActivity.start();

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
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      requestAnimationFrame(finish);
      setTimeout(finish, 80);
    });
  }

  function showCompactLoadingProgress(deploy = null) {
    loadingMask.classList.toggle("sceneCardLoadingMaskCompact", Boolean(runtime));
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

  const cardSession = createSceneCardSession({
    onDiagnosticsChanged: diagnosticsView.update,
    viewportPool: sharedSceneViewportPool,
    getViewportLimit: cardOptions.getViewportLimit,
    onViewportStateChanged: ({ dormant, preview }) => {
      activateButton.hidden = !dormant;
      previewImage.hidden = !preview;
      if (preview) previewImage.src = preview;
    },
    ensureCapabilities: ensureThreeBoxSceneCapabilitiesForPayload,
    beforePrepare: waitForLoadingMaskPaint,
    createViewport: async () => {
      await waitForStableSize(canvasWrap);
      return createSceneCardViewport(viewportMount, { onCanvasChanged: (next) => { canvas = next; } });
    },
    getRuntimeOptions: (options) => ({
      resetScene: true,
      assetsBase: sceneHostAssetUrl("assets/"),
      assetGateway: typeof cardOptions.assetGateway === "function" ? cardOptions.assetGateway() : cardOptions.assetGateway,
      resolveResourceUrl: cardOptions.resolveResourceUrl,
      autoFillLights: options.authoritative !== true,
      autoFillCamera: options.authoritative !== true,
      autoFitCamera: options.authoritative !== true,
      onDeployProgress: ({ deploy }) => showCompactLoadingProgress(deploy)
    }),
    createRuntime: async (source, options) => {
      const { createJsonScene } = await import("threejson");
      const size = options.viewportSize || { width: 320, height: 180 };
      const payload = { ...source, canvasWidth: size.width, canvasHeight: size.height,
        sceneConfig: { ...source.sceneConfig, renderLoop: { ...source.sceneConfig?.renderLoop, autoResize: false, firstAutoResize: false } } };
      return enqueueThreeBoxSceneLoad(() => createJsonScene(payload, options));
    },
    commandOptions: {
      renderMeshViews: (request) => {
        const enabled = typeof cardOptions.shouldProvideMeshVisionFeedback === "function"
          ? cardOptions.shouldProvideMeshVisionFeedback() === true : cardOptions.meshVisionFeedback === true;
        if (!enabled) throw new Error("mesh.renderViews is unavailable for the selected AI provider.");
        return captureMeshReviewViews({ ...request, renderer: runtime.renderer });
      }
    },
    onRuntimeChanged: (next) => {
      runtime = next;
      if (runtime) {
        syncThreeBoxPreviewAuxiliaryLights(runtime.scene, typeof cardOptions.shouldUsePreviewAuxiliaryLights === "function"
          ? cardOptions.shouldUsePreviewAuxiliaryLights() !== false : cardOptions.previewAuxiliaryLights !== false);
        watchLiveResize();
      } else { liveResizeObserver?.disconnect(); liveResizeObserver = null; }
      renderActivity.sync({ forceFrame: true });
    },
    onDocumentChanged: (document) => { currentSceneJson = document; }
  });

  async function activate() {
    const seq = ++renderSeq;
    loadingMask.textContent = t("threebox.sceneCard.rendering", "场景渲染中（不消耗 Token）…");
    loadingMask.classList.remove("sceneCardLoadingMaskCompact"); loadingMask.hidden = false;
    try { return await cardSession.resume(); }
    finally { if (seq === renderSeq) loadingMask.hidden = true; }
  }
  activateButton.addEventListener("click", () => void activate().catch((error) => showToast(String(error?.message || error), "error")));

  async function render(sceneJsonPayload, options = {}) {
    const seq = ++renderSeq;
    setDraftState(options.draft === true);
    setLabel(options.label || sceneJsonPayload?.label || sceneJsonPayload?.name);
    loadingMask.textContent = t("threebox.sceneCard.rendering", "场景渲染中（不消耗 Token）…");
    loadingMask.classList.toggle("sceneCardLoadingMaskCompact", Boolean(runtime));
    loadingMask.hidden = false;
    try { return await cardSession.render(sceneJsonPayload, options); }
    finally { if (seq === renderSeq) loadingMask.hidden = true; }
  }

  async function updateSceneJson(sceneJson) {
    if (sceneJson && typeof sceneJson === "object") return cardSession.update(sceneJson);
    return currentSceneJson;
  }

  async function executeCommandBatch(commands, options = {}) {
    if (!Array.isArray(commands) || !commands.length) {
      return { ok: false, sceneMutated: false, results: [], error: "Scene preview runtime is not ready." };
    }
    const { formatObjectGetFeedbackFromBatch, extractVisualFeedbackFromBatch } = await import("threejson/ai");
    const execResult = await cardSession.execute(commands, options);
    const results = execResult.results || [];
    if (!execResult.ok) return { ...execResult, execResult, error: execResult.error?.message || execResult.error || results.find((entry) => !entry.ok)?.error || "Scene command transaction failed." };
    setLabel(options.label); setDraftState(options.draft === true);
    renderActivity.sync({ forceFrame: true });
    return { ok: true, sceneMutated: execResult.sceneMutated, execResult, results,
      objectGetFeedback: formatObjectGetFeedbackFromBatch(results), visualFeedback: extractVisualFeedbackFromBatch(results), runtime };
  }

  async function applyCommands(commands, options = {}) {
    const result = await executeCommandBatch(commands, options);
    if (!result.ok) {
      if (result.error === "Scene preview runtime is not ready.") return null;
      throw new Error(result.error);
    }
    return result.runtime;
  }

  async function applyCommandsWithResult(commands, options = {}) { return executeCommandBatch(commands, options); }

  // Save the authoring snapshot, never animation poses, helper lights or transient proxy URLs.
  async function exportSceneJsonString(options = {}) {
    const document = cardSession.export();
    if (!document) return "";
    currentSceneJson = document; setLabel(options.label);
    if (Object.prototype.hasOwnProperty.call(options, "draft")) setDraftState(options.draft === true);
    return JSON.stringify(document, null, 2);
  }

  async function finalize(sceneJsonPayload, options = {}) {
    return render(sceneJsonPayload, { ...options, draft: false });
  }

  function dispose() {
    renderSeq++;
    clearTimeout(textureBadgeTimer); textureBadgeTimer = null;
    liveResizeObserver?.disconnect(); liveResizeObserver = null;
    renderActivity.dispose(); cardSession.dispose(); diagnosticsView.dispose(); runtime = null; canvas = null;
  }

  function requireSceneJson() {
    try { currentSceneJson = cardSession.export(); }
    catch (error) { showToast(String(error?.message || error), "error"); return null; }
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
      const archiveOptions = typeof cardOptions.archiveOptions === "function"
        ? await cardOptions.archiveOptions(sceneJson)
        : (cardOptions.archiveOptions || {});
      const blob = await packJsonSceneArchive(sceneJson, { ...archiveOptions, outputType: "blob" });
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
    exportMeshBtn.disabled = true;
    const formatLabel = format.toUpperCase();
    showToast(t("threebox.sceneCard.exportMeshStarted", "正在导出 {format}…", { format: formatLabel }), "info");
    try {
      const { exportMesh } = await import("threejson");
      const result = await cardSession.withRuntime((runtime) => exportMesh(runtime.scene, {
        format,
        scope: "scene",
        externalModelPolicy: "include",
        renderer: runtime.renderer,
        fileNameStem: currentLabel
      }));
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
    const playerUrl = new URL("../player/index.html", window.location.href);
    const playerOrigin = resolveScenePreviewPeerOrigin(
      playerUrl.href,
      window.location.href,
      [playerUrl.origin]
    );
    const openerOrigin = resolveScenePreviewPeerOrigin(window.location.origin);
    if (!playerOrigin || !openerOrigin) {
      showToast(
        t("threebox.sceneCard.openInPlayerFailed", "在播放器内打开失败：{error}", {
          error: "播放器或 ThreeBox 地址不在允许通信的来源白名单中。"
        }),
        "error"
      );
      return;
    }
    playerUrl.searchParams.set("editorPreview", "1");
    playerUrl.searchParams.set("openerOrigin", openerOrigin);
    const win = window.open(playerUrl.href, "_blank");
    if (!win) {
      showToast(t("threebox.sceneCard.popupBlocked", "无法打开新窗口，请检查浏览器弹窗拦截设置。"), "warning");
      return;
    }
    let sent = false;
    const onMessage = (event) => {
      if (
        !isScenePreviewMessageEvent(event, [playerOrigin])
        || event.origin !== playerOrigin
        || event.source !== win
      ) {
        return;
      }
      if (event.data?.action === "ready" && !sent) {
        sent = true;
        postScenePreviewMessage(
          win,
          { action: "load", payload: sceneJson, label: currentLabel, bindSceneEvents: false },
          playerOrigin,
          [playerOrigin]
        );
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
      await render(sceneJson, { label: currentLabel, force: true });
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
    get canvas() { return canvas; },
    render,
    applyCommands,
    applyCommandsWithResult,
    exportSceneJsonString,
    finalize,
    dispose,
    setTextureProgress,
    setDraftStatus,
    setLabel,
    updateSceneJson,
    activate,
    setViewportLimit: (value) => cardSession.setViewportLimit(value),
    applyTextureAssignment: (assignment, options) => cardSession.applyTextureAssignment(assignment, options),
    setPreviewAuxiliaryLightsEnabled: (enabled) =>
      syncThreeBoxPreviewAuxiliaryLights(runtime?.scene, enabled !== false),
    getRuntime: () => runtime
  };
}

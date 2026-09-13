/** React scene-card UI backed by the shared immutable document/session controller. */
import { useCallback, useEffect, useRef, useState } from "react";
import { sceneHostAssetUrl } from "@threejson/host-kit/js/sceneHostPaths.js";
import { createCanvasRenderActivity } from "@threejson/host-kit/js/canvasRenderActivity.js";
import { enqueueSceneAgentLoad } from "./sceneLoadQueue.js";
import { syncSceneAgentPreviewLights } from "./previewLights.js";
import { createSceneCardSession, createSceneCardViewport } from "@threejson/host-kit/js/sceneCardSession.js";
import { captureMeshReviewViews } from "@threejson/host-kit/js/meshViewCapture.js";
import { sharedSceneViewportPool } from "@threejson/host-kit/js/sceneViewportPool.js";
import { ensureSceneHostSceneCapabilitiesForPayload } from "@threejson/host-kit/js/sceneCapabilities.js";

function interpolate(text, params) {
  let result = String(text || "");
  for (const [key, value] of Object.entries(params || {})) result = result.replaceAll(`{${key}}`, String(value));
  return result;
}

function translate(options, key, fallback, params) {
  return options?.translate?.(key, fallback, params) || interpolate(fallback, params);
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
    if (target) {
      ro.observe(target);
    }
    const timeoutId = window.setTimeout(() => finish(readSize() || { width: 320, height: 180 }), 250);
  });
}

function waitForLoadingMaskPaint() {
  // Gives the loading mask one paint before heavy work begins. requestAnimationFrame does NOT fire
  // while the tab is hidden, so a bare rAF here would hang the whole render on a backgrounded tab —
  // fall back to a short timer so the render always proceeds.
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) {
        return;
      }
      done = true;
      resolve();
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(finish);
    }
    setTimeout(finish, 80);
  });
}

export function useSceneCardRuntime(options = {}) {
  const canvasRef = useRef(null);
  const canvasMountRef = useRef(null);
  const sessionRef = useRef(null);
  const canvasWrapRef = useRef(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const runtimeRef = useRef(null);
  const liveResizeObserverRef = useRef(null);
  const renderActivityRef = useRef(null);
  const renderSeqRef = useRef(0);
  const currentSceneJsonRef = useRef(null);
  const currentLabelRef = useRef(translate(options, "sceneAgent.sceneCard.defaultLabel", "Scene"));
  const textureProgressTimerRef = useRef(null);

  const [loadingText, setLoadingText] = useState(translate(options, "sceneAgent.sceneCard.waitingForDraft", "等待场景草稿…"));
  const [loadingCompact, setLoadingCompact] = useState(false);
  const [exporting, setExporting] = useState(null);
  const [draft, setDraft] = useState(false);
  const [textureProgress, setTextureProgressState] = useState(null);
  const [viewportState, setViewportState] = useState({ dormant: false, preview: null });
  const [resourceDiagnostics, setResourceDiagnostics] = useState([]);

  const toast = useCallback((msg, kind) => optionsRef.current.showToast?.(msg, kind), []);

  const syncRuntimeActivity = useCallback((forceFrame = false) => {
    if (renderActivityRef.current) {
      return renderActivityRef.current.sync({ forceFrame });
    }
    const runtime = runtimeRef.current;
    if (!runtime) return false;
    runtime.start?.();
    if (forceFrame) runtime.renderOnce?.();
    return true;
  }, []);

  useEffect(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap) return undefined;
    const activity = createCanvasRenderActivity({
      element: wrap,
      getRuntime: () => runtimeRef.current
    });
    renderActivityRef.current = activity;
    activity.start();
    return () => {
      activity.dispose();
      if (renderActivityRef.current === activity) renderActivityRef.current = null;
    };
  }, []);

  const setLabel = useCallback((label) => {
    const next = String(label || "").trim();
    if (next) {
      currentLabelRef.current = next;
    }
    return currentLabelRef.current;
  }, []);

  const watchLiveResize = useCallback(() => {
    liveResizeObserverRef.current?.disconnect();
    const wrap = canvasWrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) {
      return;
    }
    liveResizeObserverRef.current = new ResizeObserver((entries) => {
      if (!runtimeRef.current) {
        return;
      }
      const entry = entries[0];
      const box = entry.contentBoxSize?.[0];
      const width = Math.max(1, Math.round(box ? box.inlineSize : entry.contentRect.width));
      const height = Math.max(1, Math.round(box ? box.blockSize : entry.contentRect.height));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      runtimeRef.current.resize?.({ width, height });
    });
    liveResizeObserverRef.current.observe(wrap);
  }, []);

  const showCompactLoadingProgress = useCallback((deploy = null) => {
    setLoadingCompact(Boolean(runtimeRef.current));
    const done = Number(deploy?.done);
    const total = Number(deploy?.total);
    setLoadingText(
      Number.isFinite(done) && Number.isFinite(total) && total > 0
        ? translate(optionsRef.current, "sceneAgent.sceneCard.loadingProgress", "正在装载场景内容 {done}/{total}（不消耗 Token）…", { done, total })
        : translate(optionsRef.current, "sceneAgent.sceneCard.loadingContent", "画布已启动，正在装载场景内容（不消耗 Token）…")
    );
  }, []);

  const getCardSession = useCallback(() => {
    if (!sessionRef.current) sessionRef.current = createSceneCardSession({
      onDiagnosticsChanged: setResourceDiagnostics,
      viewportPool: sharedSceneViewportPool,
      getViewportLimit: () => optionsRef.current.getViewportLimit?.() ?? optionsRef.current.maxActiveViewports ?? 1,
      onViewportStateChanged: setViewportState,
      ensureCapabilities: (document) => (optionsRef.current.ensureSceneCapabilities || ensureSceneHostSceneCapabilitiesForPayload)(document),
      beforePrepare: waitForLoadingMaskPaint,
      createViewport: async () => {
        await waitForStableSize(canvasWrapRef.current);
        return createSceneCardViewport(canvasMountRef.current, { onCanvasChanged: (canvas) => { canvasRef.current = canvas; } });
      },
      getRuntimeOptions: (renderOptions) => ({
        resetScene: true,
        assetsBase: optionsRef.current.assetsBase || sceneHostAssetUrl("assets/"),
        assetGateway: typeof optionsRef.current.assetGateway === "function" ? optionsRef.current.assetGateway() : optionsRef.current.assetGateway,
        resolveResourceUrl: optionsRef.current.resolveResourceUrl,
        autoFillLights: renderOptions.authoritative !== true,
        autoFillCamera: renderOptions.authoritative !== true,
        autoFitCamera: renderOptions.authoritative !== true,
        onDeployProgress: ({ deploy }) => showCompactLoadingProgress(deploy)
      }),
      createRuntime: async (source, runtimeOptions) => {
        const { createJsonScene } = await import("threejson");
        const size = runtimeOptions.viewportSize || { width: 320, height: 180 };
        const payload = { ...source, canvasWidth: size.width, canvasHeight: size.height,
          sceneConfig: { ...source.sceneConfig, renderLoop: { ...source.sceneConfig?.renderLoop, autoResize: false, firstAutoResize: false } } };
        return enqueueSceneAgentLoad(() => createJsonScene(payload, runtimeOptions));
      },
      commandOptions: {
        renderMeshViews: (request) => {
          if (optionsRef.current.renderMeshViews) return optionsRef.current.renderMeshViews(request);
          const enabled = optionsRef.current.shouldProvideMeshVisionFeedback?.() ?? optionsRef.current.meshVisionFeedback;
          if (!enabled) throw new Error("mesh.renderViews is unavailable for the selected AI provider.");
          return captureMeshReviewViews({ ...request, renderer: runtimeRef.current.renderer });
        }
      },
      onRuntimeChanged: (next) => {
        runtimeRef.current = next;
        if (next) {
          syncSceneAgentPreviewLights(next.scene, typeof optionsRef.current.shouldUsePreviewAuxiliaryLights === "function"
            ? optionsRef.current.shouldUsePreviewAuxiliaryLights() !== false : optionsRef.current.previewAuxiliaryLights !== false);
          watchLiveResize();
        } else { liveResizeObserverRef.current?.disconnect(); liveResizeObserverRef.current = null; }
        syncRuntimeActivity(true);
      },
      onDocumentChanged: (document) => { currentSceneJsonRef.current = document; }
    });
    return sessionRef.current;
  }, [showCompactLoadingProgress, syncRuntimeActivity, watchLiveResize]);

  const render = useCallback(async (sceneJsonPayload, renderOptions = {}) => {
    const seq = ++renderSeqRef.current;
    setDraft(renderOptions.draft === true);
    setLabel(renderOptions.label || sceneJsonPayload?.label || sceneJsonPayload?.name);
    setLoadingCompact(Boolean(runtimeRef.current));
    setLoadingText(translate(optionsRef.current, "sceneAgent.sceneCard.rendering", "场景渲染中（不消耗 Token）…"));
    try { return await getCardSession().render(sceneJsonPayload, renderOptions); }
    finally { if (seq === renderSeqRef.current) setLoadingText(null); }
  }, [getCardSession, setLabel]);

  const activate = useCallback(async () => {
    const seq = ++renderSeqRef.current;
    setLoadingCompact(false);
    setLoadingText(translate(optionsRef.current, "sceneAgent.sceneCard.rendering", "场景渲染中（不消耗 Token）…"));
    try { return await getCardSession().resume(); }
    finally { if (seq === renderSeqRef.current) setLoadingText(null); }
  }, [getCardSession]);

  const updateSceneJson = useCallback(async (sceneJson) => {
    if (sceneJson && typeof sceneJson === "object") return getCardSession().update(sceneJson);
    return currentSceneJsonRef.current;
  }, [getCardSession]);

  const executeCommandBatch = useCallback(async (commands, commandOptions = {}) => {
    const execResult = await getCardSession().execute(commands, commandOptions);
    const results = execResult.results || [];
    if (!execResult.ok) return { ...execResult, execResult,
      error: execResult.error?.message || execResult.error || results.find((entry) => !entry.ok)?.error || "Scene command transaction failed." };
    const { formatObjectGetFeedbackFromBatch, extractVisualFeedbackFromBatch } = await import("threejson/ai");
    setLabel(commandOptions.label); setDraft(commandOptions.draft === true); syncRuntimeActivity(true);
    return { ok: true, sceneMutated: execResult.sceneMutated, execResult, results,
      objectGetFeedback: formatObjectGetFeedbackFromBatch(results), visualFeedback: extractVisualFeedbackFromBatch(results),
      runtime: runtimeRef.current };
  }, [getCardSession, setLabel, syncRuntimeActivity]);

  const applyCommandsWithResult = useCallback((commands, commandOptions = {}) =>
    executeCommandBatch(commands, commandOptions), [executeCommandBatch]);

  const applyCommands = useCallback(async (commands, commandOptions = {}) => {
    const result = await executeCommandBatch(commands, commandOptions);
    if (!result.ok) {
      if (result.error === "Scene preview runtime is not ready.") return null;
      throw new Error(result.error);
    }
    return result.runtime;
  }, [executeCommandBatch]);

  const exportSceneJsonString = useCallback(async (exportOptions = {}) => {
    const document = sessionRef.current?.export();
    if (!document) return "";
    currentSceneJsonRef.current = document; setLabel(exportOptions.label);
    if (Object.prototype.hasOwnProperty.call(exportOptions, "draft")) setDraft(exportOptions.draft === true);
    return JSON.stringify(document, null, 2);
  }, [setLabel]);

  const finalize = useCallback((sceneJsonPayload, finalOptions = {}) =>
    render(sceneJsonPayload, { ...finalOptions, draft: false }), [render]);

  const setTextureProgress = useCallback((event = {}) => {
    clearTimeout(textureProgressTimerRef.current);
    textureProgressTimerRef.current = null;
    const sourcePhase = String(event.phase || "");
    const total = Math.max(0, Number(event.total) || 0);
    const completed = Math.max(0, Number(event.completed) || 0);
    if (sourcePhase === "planned" && total > 0) {
      setTextureProgressState({
        sourcePhase,
        phase: "working",
        title: "",
        message: translate(optionsRef.current, "sceneAgent.sceneCard.texturePlanned", "正在完善纹理 · 0/{total}", { total })
      });
      return;
    }
    if ((sourcePhase === "acquiring" || sourcePhase === "task-complete") && total > 0) {
      setTextureProgressState({
        sourcePhase,
        phase: "working",
        title: "",
        message: translate(optionsRef.current, "sceneAgent.sceneCard.textureProgress", "正在完善纹理 · {completed}/{total}", { completed, total })
      });
      return;
    }
    if (sourcePhase === "complete" && total > 0) {
      const assignments = Math.max(0, Number(event.assignments) || 0);
      const pendingLicense = Math.max(0, Number(event.pendingLicense) || 0);
      const pendingItems = Array.isArray(event.pendingLicenseItems) ? event.pendingLicenseItems : [];
      setTextureProgressState({
        sourcePhase,
        phase: pendingLicense ? "neutral" : assignments ? "complete" : "neutral",
        title: pendingItems
          .map((item) => [
            item.objectName || item.query || item.taskId,
            item.candidateName || item.candidateId,
            item.source,
            item.license?.id || item.license?.name || item.license?.status || "unknown"
          ].filter(Boolean).join(" · "))
          .join("\n"),
        message: pendingLicense
          ? translate(optionsRef.current, "sceneAgent.sceneCard.textureLicensePending", "已完善 {assignments} 项 · {pendingLicense} 项需许可确认", { assignments, pendingLicense })
          : assignments
            ? translate(optionsRef.current, "sceneAgent.sceneCard.textureComplete", "纹理已完善 · {assignments}/{total}", { assignments, total })
            : translate(optionsRef.current, "sceneAgent.sceneCard.textureUnchanged", "未找到可安全应用的纹理")
      });
      if (!pendingLicense) {
        textureProgressTimerRef.current = setTimeout(() => setTextureProgressState(null), 4200);
      }
      return;
    }
    if (sourcePhase === "failed") {
      setTextureProgressState({
        sourcePhase,
        phase: "warning",
        title: "",
        message: translate(optionsRef.current, "sceneAgent.sceneCard.textureFailed", "纹理服务暂不可用，已保留基础材质")
      });
      textureProgressTimerRef.current = setTimeout(() => setTextureProgressState(null), 5200);
      return;
    }
    setTextureProgressState(null);
  }, []);

  const setPreviewAuxiliaryLightsEnabled = useCallback((enabled) => {
    syncSceneAgentPreviewLights(runtimeRef.current?.scene, enabled !== false);
  }, []);

  const dispose = useCallback(() => {
    clearTimeout(textureProgressTimerRef.current);
    textureProgressTimerRef.current = null;
    renderSeqRef.current += 1;
    liveResizeObserverRef.current?.disconnect();
    liveResizeObserverRef.current = null;
    sessionRef.current?.dispose(); sessionRef.current = null;
    runtimeRef.current = null; canvasRef.current = null;
  }, []);

  useEffect(() => () => dispose(), [dispose]);

  const requireSceneJson = useCallback(() => {
    try { currentSceneJsonRef.current = sessionRef.current?.export() || null; }
    catch (error) { toast(String(error?.message || error), "error"); return null; }
    if (!currentSceneJsonRef.current) {
      toast(translate(optionsRef.current, "sceneAgent.sceneCard.notReady", "场景尚未生成完成。"), "warning");
      return null;
    }
    return currentSceneJsonRef.current;
  }, [toast]);

  const handleDownloadJson = useCallback(() => {
    const sceneJson = requireSceneJson();
    if (!sceneJson) {
      return;
    }
    // Honour io.exportJsonIndent (0 = compact); default to 2 when unset.
    const indent = Number.isFinite(optionsRef.current.exportJsonIndent) ? optionsRef.current.exportJsonIndent : 2;
    const blob = new Blob([JSON.stringify(sceneJson, null, indent)], { type: "application/json" });
    downloadBlob(blob, `${currentLabelRef.current}.json`);
  }, [requireSceneJson]);

  const handleExportTjz = useCallback(async () => {
    const sceneJson = requireSceneJson();
    if (!sceneJson) {
      return;
    }
    setExporting("tjz");
    try {
      const { packJsonSceneArchive } = await import("threejson");
      const archiveOptions = typeof optionsRef.current.archiveOptions === "function"
        ? await optionsRef.current.archiveOptions(sceneJson)
        : (optionsRef.current.archiveOptions || {});
      const blob = await packJsonSceneArchive(sceneJson, { ...archiveOptions, outputType: "blob" });
      downloadBlob(blob, `${currentLabelRef.current}.tjz`);
    } catch (error) {
      toast(translate(optionsRef.current, "sceneAgent.sceneCard.exportFailed", "导出失败：{error}", { error: error?.message || error }), "error");
    } finally {
      setExporting(null);
    }
  }, [requireSceneJson, toast]);

  const handleExportMesh = useCallback(async () => {
    const sceneJson = requireSceneJson();
    if (!sceneJson) {
      return;
    }
    const format = await optionsRef.current.selectMeshFormat?.();
    if (!format) {
      return;
    }
    setExporting("mesh");
    toast(translate(optionsRef.current, "sceneAgent.sceneCard.exportMeshStarted", "正在导出 {format}…", { format: format.toUpperCase() }), "info");
    try {
      const { exportMesh } = await import("threejson");
      const result = await getCardSession().withRuntime((runtime) => exportMesh(runtime.scene, {
        format,
        scope: "scene",
        externalModelPolicy: "include",
        renderer: runtime.renderer,
        fileNameStem: currentLabelRef.current
      }));
      const payload = result.data instanceof ArrayBuffer ? result.data : String(result.data || "");
      const blob = new Blob([payload], { type: result.mimeType || "application/octet-stream" });
      downloadBlob(blob, result.fileNameHint || `${currentLabelRef.current}.${result.extension || format}`);
      const warnings = Array.isArray(result.warnings)
        ? result.warnings.filter((entry) => String(entry?.message || "").trim())
        : [];
      const showWarn =
        typeof optionsRef.current.shouldShowMeshExportWarnings === "function"
          ? optionsRef.current.shouldShowMeshExportWarnings() !== false
          : optionsRef.current.showMeshExportWarnings !== false;
      if (warnings.length && showWarn) {
        await optionsRef.current.showMeshWarnings?.(warnings);
      } else {
        toast(translate(optionsRef.current, "sceneAgent.sceneCard.exportMeshSuccess", "三方模型已导出。"), "success");
      }
    } catch (error) {
      console.error("[scene-agent] mesh export failed:", error);
      toast(translate(optionsRef.current, "sceneAgent.sceneCard.exportMeshFailed", "导出三方模型失败：{error}", { error: error?.message || error }), "error");
    } finally {
      setExporting(null);
    }
  }, [getCardSession, requireSceneJson, toast]);

  const handleOpenEditor = useCallback(async () => {
    const sceneJson = requireSceneJson();
    if (!sceneJson) {
      return;
    }
    try {
      if (!optionsRef.current.openInEditor) throw new Error("Editor navigation is not configured.");
      await optionsRef.current.openInEditor(sceneJson, currentLabelRef.current);
      toast(translate(optionsRef.current, "sceneAgent.sceneCard.openInEditorSuccess", "已将场景发送到编辑器。"), "success");
    } catch (error) {
      const message = String(error?.message || error);
      toast(
        translate(optionsRef.current, "sceneAgent.sceneCard.openInEditorFailed", "在编辑器内打开失败：{error}", { error: message }),
        "error"
      );
    }
  }, [requireSceneJson, toast]);

  const handleOpenPlayer = useCallback(async () => {
    const sceneJson = requireSceneJson();
    if (!sceneJson) {
      return;
    }
    try {
      if (!optionsRef.current.openInPlayer) throw new Error("Player navigation is not configured.");
      await optionsRef.current.openInPlayer(sceneJson, currentLabelRef.current);
      toast(translate(optionsRef.current, "sceneAgent.sceneCard.openInPlayerSuccess", "已将场景发送到播放器。"), "success");
    } catch (error) {
      const message = String(error?.message || error);
      toast(
        translate(optionsRef.current, "sceneAgent.sceneCard.openInPlayerFailed", "在播放器内打开失败：{error}", { error: message }),
        "error"
      );
    }
  }, [requireSceneJson, toast]);

  const handleRefresh = useCallback(async () => {
    const sceneJson = requireSceneJson();
    if (!sceneJson) {
      return;
    }
    setExporting("refresh");
    try {
      await render(sceneJson, { label: currentLabelRef.current, force: true });
    } finally {
      setExporting(null);
    }
  }, [requireSceneJson, render]);

  const handleFullscreen = useCallback(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap) {
      return;
    }
    if (document.fullscreenElement === wrap) {
      void document.exitFullscreen();
      return;
    }
    wrap.requestFullscreen?.().catch((error) => {
      toast(translate(optionsRef.current, "sceneAgent.sceneCard.fullscreenFailed", "进入全屏失败：{error}", { error: error?.message || error }), "warning");
    });
  }, [toast]);

  return {
    canvasRef,
    canvasMountRef,
    canvasWrapRef,
    loadingText,
    loadingCompact,
    exporting,
    draft,
    textureProgress,
    viewportState,
    resourceDiagnostics,
    activate,
    setViewportLimit: (value) => getCardSession().setViewportLimit(value),
    render,
    setLabel,
    applyCommands,
    applyCommandsWithResult,
    exportSceneJsonString,
    finalize,
    updateSceneJson,
    applyTextureAssignment: (assignment, options) => getCardSession().applyTextureAssignment(assignment, options),
    setTextureProgress,
    setPreviewAuxiliaryLightsEnabled,
    dispose,
    getRuntime: () => runtimeRef.current,
    handleDownloadJson,
    handleExportTjz,
    handleExportMesh,
    handleOpenEditor,
    handleOpenPlayer,
    handleRefresh,
    handleFullscreen
  };
}

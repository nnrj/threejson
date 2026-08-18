/**
 * Unbranded React scene-card runtime for a conversational scene workbench. Renders an inline LIVE
 * Three.js canvas per generated/adjusted scene —
 * each card owns its own canvas + runtime, exactly as the original does (this is why there is no
 * shared viewport). Uses the engine (threejson) directly; host-kit only supplies the asset base and
 * i18n. Actions: download JSON / export .tjz / export mesh / open in editor / open in player /
 * refresh / fullscreen.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { sceneHostAssetUrl } from "@threejson/host-kit/js/sceneHostPaths.js";
import { enqueueSceneAgentLoad } from "./sceneLoadQueue.js";
import { removeSceneAgentPreviewLights, syncSceneAgentPreviewLights } from "./previewLights.js";

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
  const canvasWrapRef = useRef(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const runtimeRef = useRef(null);
  const commandContextRef = useRef(null);
  const liveResizeObserverRef = useRef(null);
  const renderSeqRef = useRef(0);
  const currentSceneJsonRef = useRef(null);
  const currentLabelRef = useRef(translate(options, "sceneAgent.sceneCard.defaultLabel", "Scene"));

  const [loadingText, setLoadingText] = useState(translate(options, "sceneAgent.sceneCard.waitingForDraft", "等待场景草稿…"));
  const [loadingCompact, setLoadingCompact] = useState(false);
  const [exporting, setExporting] = useState(null);
  const [draft, setDraft] = useState(false);
  const [textureProgress, setTextureProgressState] = useState(null);

  const toast = useCallback((msg, kind) => optionsRef.current.showToast?.(msg, kind), []);

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
    setLoadingCompact(true);
    const done = Number(deploy?.done);
    const total = Number(deploy?.total);
    setLoadingText(
      Number.isFinite(done) && Number.isFinite(total) && total > 0
        ? translate(optionsRef.current, "sceneAgent.sceneCard.loadingProgress", "正在装载场景内容 {done}/{total}（不消耗 Token）…", { done, total })
        : translate(optionsRef.current, "sceneAgent.sceneCard.loadingContent", "画布已启动，正在装载场景内容（不消耗 Token）…")
    );
  }, []);

  const render = useCallback(
    async (sceneJsonPayload, renderOptions = {}) => {
      const seq = ++renderSeqRef.current;
      liveResizeObserverRef.current?.disconnect();
      liveResizeObserverRef.current = null;
      runtimeRef.current?.dispose?.();
      runtimeRef.current = null;
      commandContextRef.current = null;
      currentSceneJsonRef.current = sceneJsonPayload;
      setDraft(renderOptions.draft === true);
      setLabel(
        renderOptions.label ||
          sceneJsonPayload?.label ||
          sceneJsonPayload?.name ||
          translate(optionsRef.current, "sceneAgent.sceneCard.defaultLabel", "Scene")
      );
      setLoadingCompact(false);
      setLoadingText(translate(optionsRef.current, "sceneAgent.sceneCard.rendering", "场景渲染中（不消耗 Token）…"));

      const { createJsonScene } = await import("threejson");
      const canvas = canvasRef.current;
      const { width, height } = await waitForStableSize(canvasWrapRef.current);
      if (!canvas) {
        return null;
      }
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.width = width;
      canvas.height = height;
      await waitForLoadingMaskPaint();

      const payload = structuredClone(sceneJsonPayload || {});
      payload.canvasWidth = width;
      payload.canvasHeight = height;
      // An inline embedded card must not follow window resizes regardless of what the scene says.
      payload.sceneConfig = {
        ...payload.sceneConfig,
        renderLoop: { ...payload.sceneConfig?.renderLoop, autoResize: false, firstAutoResize: false }
      };

      let auxiliaryLightsSynced = false;
      const syncAuxiliaryLights = (nextRuntime) => {
        if (auxiliaryLightsSynced || seq !== renderSeqRef.current || !nextRuntime?.scene) {
          return;
        }
        const enabled =
          typeof optionsRef.current.shouldUsePreviewAuxiliaryLights === "function"
            ? optionsRef.current.shouldUsePreviewAuxiliaryLights() !== false
            : optionsRef.current.previewAuxiliaryLights !== false;
        syncSceneAgentPreviewLights(nextRuntime.scene, enabled);
        auxiliaryLightsSynced = true;
      };
      const activateRuntime = (nextRuntime) => {
        if (!nextRuntime || seq !== renderSeqRef.current) {
          return false;
        }
        if (runtimeRef.current !== nextRuntime) {
          runtimeRef.current = nextRuntime;
          runtimeRef.current.start?.();
          watchLiveResize();
        }
        runtimeRef.current.resize?.({ width, height });
        showCompactLoadingProgress();
        return true;
      };

      try {
        const nextRuntime = await enqueueSceneAgentLoad(() =>
          createJsonScene(payload, {
            canvas,
            resetScene: true,
            assetsBase: optionsRef.current.assetsBase || sceneHostAssetUrl("assets/"),
            assetGateway: typeof optionsRef.current.assetGateway === "function" ? optionsRef.current.assetGateway() : optionsRef.current.assetGateway,
            autoFillLights: renderOptions.authoritative !== true,
            autoFillCamera: renderOptions.authoritative !== true,
            autoFitCamera: renderOptions.authoritative !== true,
            onRuntimeReady: ({ runtime: readyRuntime }) => activateRuntime(readyRuntime),
            onDeployProgress: ({ runtime: deployingRuntime, deploy }) => {
              if (seq !== renderSeqRef.current) {
                return;
              }
              syncAuxiliaryLights(deployingRuntime);
              showCompactLoadingProgress(deploy);
            },
            onSceneReady: ({ runtime: readyRuntime }) => syncAuxiliaryLights(readyRuntime)
          })
        );
        if (seq !== renderSeqRef.current) {
          nextRuntime?.dispose?.();
          return null;
        }
        activateRuntime(nextRuntime);
        syncAuxiliaryLights(nextRuntime);
      } finally {
        if (seq === renderSeqRef.current) {
          setLoadingText(null);
        }
      }
      return runtimeRef.current;
    },
    [setLabel, showCompactLoadingProgress, watchLiveResize]
  );

  const updateSceneJson = useCallback((sceneJson) => {
    if (!sceneJson || typeof sceneJson !== "object") return;
    currentSceneJsonRef.current = sceneJson;
    if (commandContextRef.current) commandContextRef.current.document = sceneJson;
  }, []);

  const executeCommandBatch = useCallback(async (commands, commandOptions = {}) => {
    const runtime = runtimeRef.current;
    if (!runtime || !Array.isArray(commands) || commands.length === 0) {
      return { ok: false, sceneMutated: false, results: [], error: "Scene preview runtime is not ready." };
    }
    const { createCommandContext, executeCommands } = await import("threejson/commands");
    if (!commandContextRef.current || commandContextRef.current.scene !== runtime.scene) {
      commandContextRef.current = createCommandContext({
        scene: runtime.scene,
        camera: runtime.camera,
        renderer: runtime.renderer,
        controls: runtime.controls,
        runtime,
        document: currentSceneJsonRef.current
      });
    }
    const execResult = await executeCommands(commandContextRef.current, commands);
    if (commandContextRef.current.runtime && commandContextRef.current.runtime !== runtimeRef.current) {
      runtimeRef.current = commandContextRef.current.runtime;
      runtimeRef.current.start?.();
      watchLiveResize();
    }
    const results = Array.isArray(execResult?.results) ? execResult.results : [];
    const failed = results.find((entry) => entry?.ok === false);
    if (failed || execResult?.ok === false) {
      return { ok: false, sceneMutated: false, execResult, results, error: failed?.error || "Scene preview command application failed." };
    }
    if (commandOptions.sceneJson) updateSceneJson(commandOptions.sceneJson);
    setLabel(commandOptions.label);
    setDraft(commandOptions.draft === true);
    syncSceneAgentPreviewLights(
      runtimeRef.current?.scene,
      typeof optionsRef.current.shouldUsePreviewAuxiliaryLights === "function"
        ? optionsRef.current.shouldUsePreviewAuxiliaryLights() !== false
        : optionsRef.current.previewAuxiliaryLights !== false
    );
    const objectGetFeedback = results
      .filter((entry) => entry?.ok && entry.op === "object.get" && entry.data)
      .map((entry) => JSON.stringify({
        threeJsonId: entry.data?.threeJsonId || entry.data?.id || "",
        path: entry.data?.path ?? null,
        value: entry.data?.value
      }, null, 2))
      .join("\n\n");
    return {
      ok: true,
      sceneMutated: commandOptions.readOnly === true ? false : results.some((entry) => entry?.ok !== false),
      execResult,
      results,
      objectGetFeedback,
      runtime: runtimeRef.current
    };
  }, [setLabel, updateSceneJson, watchLiveResize]);

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
    if (!runtimeRef.current?.scene?.isScene) return "";
    const { sceneToStandardJsonSimple } = await import("threejson/scene-export");
    const basePayload = commandContextRef.current?.document || currentSceneJsonRef.current;
    const previewLightsEnabled =
      typeof optionsRef.current.shouldUsePreviewAuxiliaryLights === "function"
        ? optionsRef.current.shouldUsePreviewAuxiliaryLights() !== false
        : optionsRef.current.previewAuxiliaryLights !== false;
    removeSceneAgentPreviewLights(runtimeRef.current.scene);
    let sceneJson;
    try {
      sceneJson = sceneToStandardJsonSimple(runtimeRef.current.scene, {
        merge: false,
        runtimeTarget: runtimeRef.current,
        basePayload
      });
    } finally {
      syncSceneAgentPreviewLights(runtimeRef.current.scene, previewLightsEnabled);
    }
    updateSceneJson(sceneJson);
    setLabel(exportOptions.label);
    if (Object.prototype.hasOwnProperty.call(exportOptions, "draft")) setDraft(exportOptions.draft === true);
    return JSON.stringify(sceneJson, null, 2);
  }, [setLabel, updateSceneJson]);

  const finalize = useCallback(async (sceneJsonPayload, finalOptions = {}) => {
    const sameScene = runtimeRef.current && currentSceneJsonRef.current &&
      JSON.stringify(currentSceneJsonRef.current) === JSON.stringify(sceneJsonPayload);
    if (!sameScene) return render(sceneJsonPayload, { ...finalOptions, draft: false });
    updateSceneJson(sceneJsonPayload);
    setLabel(finalOptions.label);
    setDraft(false);
    setLoadingText(null);
    return runtimeRef.current;
  }, [render, setLabel, updateSceneJson]);

  const setTextureProgress = useCallback((event = {}) => {
    const sourcePhase = String(event.phase || "");
    if (!sourcePhase || sourcePhase === "complete" || sourcePhase === "skipped") {
      setTextureProgressState(null);
      return;
    }
    const phase = sourcePhase === "failed" || sourcePhase === "warning" ? sourcePhase : "working";
    setTextureProgressState({ ...event, sourcePhase, phase });
  }, []);

  const setPreviewAuxiliaryLightsEnabled = useCallback((enabled) => {
    syncSceneAgentPreviewLights(runtimeRef.current?.scene, enabled !== false);
  }, []);

  const dispose = useCallback(() => {
    renderSeqRef.current += 1;
    liveResizeObserverRef.current?.disconnect();
    liveResizeObserverRef.current = null;
    runtimeRef.current?.dispose?.();
    runtimeRef.current = null;
    commandContextRef.current = null;
  }, []);

  useEffect(() => () => dispose(), [dispose]);

  const requireSceneJson = useCallback(() => {
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
    if (!runtimeRef.current?.scene?.isScene) {
      toast(translate(optionsRef.current, "sceneAgent.sceneCard.modelNotReady", "画布场景尚未渲染完成。"), "warning");
      return;
    }
    setExporting("mesh");
    toast(translate(optionsRef.current, "sceneAgent.sceneCard.exportMeshStarted", "正在导出 {format}…", { format: format.toUpperCase() }), "info");
    try {
      const { exportMesh } = await import("threejson");
      const result = await exportMesh(runtimeRef.current.scene, {
        format,
        scope: "scene",
        externalModelPolicy: "include",
        renderer: runtimeRef.current.renderer,
        fileNameStem: currentLabelRef.current
      });
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
  }, [requireSceneJson, toast]);

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
      await render(sceneJson, { label: currentLabelRef.current });
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
    canvasWrapRef,
    loadingText,
    loadingCompact,
    exporting,
    draft,
    textureProgress,
    render,
    setLabel,
    applyCommands,
    applyCommandsWithResult,
    exportSceneJsonString,
    finalize,
    updateSceneJson,
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

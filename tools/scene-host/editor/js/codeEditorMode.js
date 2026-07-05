import {
  isLoadableScenePayload,
  parseSceneJsonString,
  resolveScenePayloadForLoad,
  sceneToJson
} from "threejson";

const PIP_MIN_WIDTH = 220;
const PIP_MIN_HEIGHT = 140;

export function createCodeEditorMode(host) {
  const rootContainer = document.getElementById("rootContainer");
  const stageShell = document.getElementById("stageShell");
  const canvasWrap = document.getElementById("canvasWrap");
  const codeEditorHost = document.getElementById("codeEditorHost");
  const codeEditorFallbackTextarea = document.getElementById("codeEditorFallbackTextarea");
  const codeEditorStage = document.getElementById("codeEditorStage");
  const editModeToggle = document.getElementById("editModeToggle");
  const editModeSeg3d = document.getElementById("editModeSeg3d");
  const editModeSegCode = document.getElementById("editModeSegCode");
  const pipControlBar = document.getElementById("pipControlBar");
  const modeSwitchMask = document.getElementById("modeSwitchMask");
  const modeSwitchMaskMessage = document.getElementById("modeSwitchMaskMessage");
  const codeEditorRenderBtn = document.getElementById("codeEditorRenderBtn");
  const codeEditorCameraLockCheckbox = document.getElementById("codeEditorCameraLockCheckbox");
  const codeEditorAutoRenderCheckbox = document.getElementById("codeEditorAutoRenderCheckbox");

  let codeMirrorModulePromise = null;
  let codeMirrorView = null;
  let codeMirrorEditorViewClass = null;
  let codeMirrorUnavailable = false;
  let modeSwitchInProgress = false;
  let pipSavedGeometry = null;
  let autoRenderTimer = null;

  function isCodeEditMode() {
    return Boolean(rootContainer?.classList.contains("codeEditMode"));
  }

  function getAutoRenderDelayMs() {
    const n = Number(host.getEditorSettings()?.sceneJson?.autoRenderDelayMs);
    return Number.isFinite(n) && n >= 0 ? n : 1000;
  }

  function resolveCodeViewFormat() {
    const fromHost = host.getScenePayloadFormat?.()?.resolveEditorSceneJsonDisplayFormat?.();
    if (fromHost) {
      return fromHost;
    }
    const setting = host.getEditorSettings()?.sceneJson?.codeViewFormat || "auto";
    if (setting === "friendly" || setting === "standard") {
      return setting;
    }
    return "standard";
  }

  function buildSceneToJsonOptions(extra = {}) {
    const format = resolveCodeViewFormat();
    const options = {
      jsonData: host.getSysConfig()?.jsonData,
      optimizeJson: host.getSysConfig()?.optimizeJson,
      merge: false,
      format,
      ...extra
    };
    if (format === "friendly") {
      options.friendlyMap =
        host.getScenePayloadFormat?.()?.resolveEditorSceneJsonFriendlyMapForDisplay?.() ??
        host.resolveFriendlyMapFromPayload?.(host.getSysConfig()?.jsonData);
    }
    return options;
  }

  async function getSceneJsonTextForCodeView() {
    await host.ensureCanvasSyncedBeforeExport?.();
    const scene = host.getScene();
    if (!scene?.isScene) {
      return "{}";
    }
    const displayOpts =
      host.buildSceneToJsonOptionsForDisplay?.({ merge: false }) ??
      buildSceneToJsonOptions({ format: "standard" });
    const indent = host.getEditorSettings()?.io?.exportJsonIndent ?? 2;
    const payload = await sceneToJson(scene, displayOpts);
    return JSON.stringify(payload, null, indent);
  }

  function getActiveCodeJsonText() {
    if (codeMirrorView) {
      return codeMirrorView.state.doc.toString();
    }
    return String(codeEditorFallbackTextarea?.value || "");
  }

  function setActiveCodeJsonText(text) {
    const value = String(text || "");
    if (codeMirrorView) {
      codeMirrorView.dispatch({
        changes: { from: 0, to: codeMirrorView.state.doc.length, insert: value }
      });
      return;
    }
    if (codeEditorFallbackTextarea) {
      codeEditorFallbackTextarea.value = value;
    }
  }

  function activateCodeEditorFallback() {
    if (codeEditorHost) {
      codeEditorHost.style.display = "none";
    }
    if (codeEditorFallbackTextarea) {
      codeEditorFallbackTextarea.hidden = false;
    }
  }

  function locateThreeJsonIdInCodeEditor(threeJsonId) {
    const id = String(threeJsonId || "").trim();
    if (!id) {
      return false;
    }
    if (codeMirrorView) {
      const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp('"threeJsonId"\\s*:\\s*"' + escaped + '"');
      const text = codeMirrorView.state.doc.toString();
      const match = re.exec(text);
      if (!match) {
        return false;
      }
      const anchor = match.index;
      const head = anchor + match[0].length;
      const transaction = { selection: { anchor, head } };
      const scrollFx = codeMirrorEditorViewClass?.scrollIntoView?.(anchor, { y: "center" });
      if (scrollFx != null) {
        transaction.effects = scrollFx;
      } else {
        transaction.scrollIntoView = true;
      }
      codeMirrorView.dispatch(transaction);
      codeMirrorView.focus();
      return true;
    }
    if (codeEditorFallbackTextarea) {
      const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp('"threeJsonId"\\s*:\\s*"' + escaped + '"');
      const text = String(codeEditorFallbackTextarea.value || "");
      const match = re.exec(text);
      if (!match) {
        return false;
      }
      codeEditorFallbackTextarea.focus();
      codeEditorFallbackTextarea.setSelectionRange(match.index, match.index + match[0].length);
      codeEditorFallbackTextarea.scrollTop = Math.max(
        0,
        (codeEditorFallbackTextarea.value.slice(0, match.index).split("\n").length - 5) *
          (parseFloat(getComputedStyle(codeEditorFallbackTextarea).lineHeight) || 18)
      );
      return true;
    }
    return false;
  }

  function maybeLocateThreeJsonIdInCodeEditor(obj) {
    if (!isCodeEditMode() || !obj) {
      return;
    }
    locateThreeJsonIdInCodeEditor(obj.userData?.objJson?.threeJsonId);
  }

  async function ensureCodeMirrorReady() {
    if (codeMirrorView) {
      return true;
    }
    if (codeMirrorUnavailable || !codeEditorHost) {
      return false;
    }
    if (!codeMirrorModulePromise) {
      codeMirrorModulePromise = Promise.all([
        import("codemirror"),
        import("@codemirror/state"),
        import("@codemirror/view"),
        import("@codemirror/lang-json"),
        import("@codemirror/theme-one-dark")
      ]);
    }
    try {
      const [cm, stateMod, viewMod, langMod, themeMod] = await codeMirrorModulePromise;
      codeMirrorEditorViewClass = viewMod.EditorView;
      codeMirrorView = new viewMod.EditorView({
        state: stateMod.EditorState.create({
          doc: "",
          extensions: [
            cm.basicSetup,
            langMod.json(),
            themeMod.oneDark,
            viewMod.EditorView.updateListener.of((update) => {
              if (update.docChanged) {
                onCodeEditorDocChanged();
              }
            })
          ]
        }),
        parent: codeEditorHost
      });
      return true;
    } catch (error) {
      codeMirrorUnavailable = true;
      codeMirrorModulePromise = null;
      console.warn("[scene-editor] CodeMirror load failed:", error);
      activateCodeEditorFallback();
      host.showMessage("代码高亮组件加载失败，已降级为纯文本编辑。", "warning");
      return false;
    }
  }

  function syncCodeModeCheckboxesFromSettings() {
    const sj = host.getEditorSettings()?.sceneJson;
    if (codeEditorCameraLockCheckbox && sj) {
      codeEditorCameraLockCheckbox.checked = sj.cameraLockDefault !== false;
    }
    if (codeEditorAutoRenderCheckbox && sj) {
      codeEditorAutoRenderCheckbox.checked = Boolean(sj.autoRenderDefault);
    }
  }

  function syncEditModeToggleUi() {
    const codeOn = isCodeEditMode();
    editModeSeg3d?.classList.toggle("editModeSegActive", !codeOn);
    editModeSegCode?.classList.toggle("editModeSegActive", codeOn);
    editModeSeg3d?.setAttribute("aria-pressed", codeOn ? "false" : "true");
    editModeSegCode?.setAttribute("aria-pressed", codeOn ? "true" : "false");
    if (codeEditorStage) {
      codeEditorStage.setAttribute("aria-hidden", codeOn ? "false" : "true");
    }
    const menuBtn = document.getElementById("menuCodeEditMode");
    if (menuBtn) {
      menuBtn.textContent = codeOn ? "退出代码编辑模式" : "代码编辑模式";
    }
    const menuToggleEdit = document.getElementById("menuToggleEditModeFromMenu");
    if (menuToggleEdit) {
      menuToggleEdit.textContent = codeOn ? "编辑 3D" : "编辑 JSON";
    }
    host.getEditorInteraction?.()?.syncTransModeButtonsVisibility?.();
  }

  function clearPipInlineGeometry() {
    if (!canvasWrap) {
      return;
    }
    canvasWrap.style.left = "";
    canvasWrap.style.top = "";
    canvasWrap.style.right = "";
    canvasWrap.style.width = "";
    canvasWrap.style.height = "";
  }

  function savePipGeometryFromCurrent() {
    if (!canvasWrap || !stageShell) {
      return;
    }
    const pipRect = canvasWrap.getBoundingClientRect();
    const stageRect = stageShell.getBoundingClientRect();
    pipSavedGeometry = {
      left: pipRect.left - stageRect.left,
      top: pipRect.top - stageRect.top,
      width: pipRect.width,
      height: pipRect.height
    };
  }

  function applyPipGeometry(geo) {
    if (!canvasWrap || !stageShell || !geo) {
      return;
    }
    const stageRect = stageShell.getBoundingClientRect();
    const stageW = stageRect.width;
    const stageH = stageRect.height;
    const width = Math.max(PIP_MIN_WIDTH, Math.min(geo.width, stageW || geo.width));
    const height = Math.max(PIP_MIN_HEIGHT, Math.min(geo.height, stageH || geo.height));
    const left = Math.max(0, Math.min(geo.left, Math.max(0, stageW - width)));
    const top = Math.max(0, Math.min(geo.top, Math.max(0, stageH - height)));
    canvasWrap.style.right = "auto";
    canvasWrap.style.left = `${left}px`;
    canvasWrap.style.top = `${top}px`;
    canvasWrap.style.width = `${width}px`;
    canvasWrap.style.height = `${height}px`;
  }

  function restorePipGeometryForCodeMode() {
    if (pipSavedGeometry) {
      applyPipGeometry(pipSavedGeometry);
    } else {
      clearPipInlineGeometry();
    }
  }

  function beginModeSwitch(message) {
    modeSwitchInProgress = true;
    if (modeSwitchMaskMessage) {
      modeSwitchMaskMessage.textContent = String(message || "正在切换…");
    }
    if (modeSwitchMask) {
      modeSwitchMask.hidden = false;
    }
    editModeToggle?.classList.add("editModeBusy");
  }

  function endModeSwitch() {
    modeSwitchInProgress = false;
    if (modeSwitchMask) {
      modeSwitchMask.hidden = true;
    }
    editModeToggle?.classList.remove("editModeBusy");
  }

  async function refreshFromScene() {
    if (!isCodeEditMode()) {
      return;
    }
    try {
      const text = await getSceneJsonTextForCodeView();
      setActiveCodeJsonText(text);
    } catch (error) {
      console.warn("[scene-editor] refresh code editor failed:", error);
    }
  }

  function normalizeJsonForCompare(raw) {
    try {
      return JSON.stringify(JSON.parse(String(raw || "")));
    } catch {
      return String(raw || "").trim();
    }
  }

  async function codeJsonDiffersFromScene() {
    if (!host.getScene()?.isScene) {
      return false;
    }
    const codeRaw = String(getActiveCodeJsonText() || "").trim();
    if (!codeRaw) {
      return false;
    }
    try {
      const sceneText = await getSceneJsonTextForCodeView();
      return normalizeJsonForCompare(codeRaw) !== normalizeJsonForCompare(sceneText);
    } catch {
      return true;
    }
  }

  async function confirmLeaveCodeModeIfNeeded() {
    if (!(await codeJsonDiffersFromScene())) {
      return true;
    }
    const choice = await host.openTriChoiceModal?.({
      message:
        "代码编辑器中的 JSON 与当前 3D 场景不一致。\n切换回 3D 模式前请选择：先渲染 JSON 到画布，或放弃未应用的修改。",
      saveLabel: "渲染 JSON 到画布",
      confirmLabel: "放弃修改并切换",
      cancelLabel: "取消"
    });
    if (choice === "cancel") {
      return false;
    }
    if (choice === "save") {
      try {
        await renderJsonToCanvas({ silent: true, skipDirtyConfirm: true });
      } catch (error) {
        host.showMessage(`渲染失败：${error?.message || error}`, "error");
        return false;
      }
    }
    return true;
  }

  async function enterCodeMode() {
    if (isCodeEditMode() || modeSwitchInProgress) {
      return;
    }
    beginModeSwitch("正在切换到代码编辑模式…");
    try {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      let codeText = "";
      if (host.getScene()?.isScene) {
        try {
          codeText = await getSceneJsonTextForCodeView();
        } catch (error) {
          console.warn("[scene-editor] code view serialize failed:", error);
        }
      }
      const ready = await ensureCodeMirrorReady();
      if (!ready) {
        activateCodeEditorFallback();
      }
      setActiveCodeJsonText(codeText);
      syncCodeModeCheckboxesFromSettings();
      rootContainer?.classList.add("codeEditMode");
      syncEditModeToggleUi();
      host.closeAllDropdowns?.();
      restorePipGeometryForCodeMode();
      requestAnimationFrame(() => {
        host.windowResize?.();
        requestAnimationFrame(() => {
          host.windowResize?.();
          if (codeMirrorView) {
            codeMirrorView.requestMeasure();
            codeMirrorView.focus();
          } else {
            codeEditorFallbackTextarea?.focus();
          }
          endModeSwitch();
        });
      });
    } catch (error) {
      console.warn("[scene-editor] enter code mode failed:", error);
      endModeSwitch();
    }
  }

  function isCodeMirrorFocused() {
    if (!codeMirrorView) {
      return false;
    }
    try {
      return codeMirrorView.hasFocus?.() === true;
    } catch {
      return false;
    }
  }

  async function enterThreeMode() {
    if (!isCodeEditMode() || modeSwitchInProgress) {
      return;
    }
    beginModeSwitch("正在切换到 3D 编辑模式…");
    cancelAutoRenderTimer();
    rootContainer?.classList.remove("codeEditMode");
    clearPipInlineGeometry();
    syncEditModeToggleUi();
    requestAnimationFrame(() => {
      host.windowResize?.();
      requestAnimationFrame(() => {
        host.windowResize?.();
        endModeSwitch();
      });
    });
  }

  function toggleEditMode() {
    if (isCodeEditMode()) {
      void enterThreeMode();
    } else {
      void enterCodeMode();
    }
  }

  function cancelAutoRenderTimer() {
    if (autoRenderTimer) {
      window.clearTimeout(autoRenderTimer);
      autoRenderTimer = null;
    }
  }

  function scheduleAutoRenderDebounced() {
    if (!codeEditorAutoRenderCheckbox?.checked || !isCodeEditMode()) {
      return;
    }
    cancelAutoRenderTimer();
    autoRenderTimer = window.setTimeout(() => {
      autoRenderTimer = null;
      void (async () => {
        try {
          await host.runWithLoadingMask?.("正在自动渲染 JSON...", () =>
            renderJsonToCanvas({ silent: true })
          );
          host.showMessage("自动渲染完成。", "success");
        } catch (error) {
          host.showMessage(`自动渲染失败：${error?.message || error}`, "warning");
          console.warn(error);
        }
      })();
    }, getAutoRenderDelayMs());
  }

  function onCodeEditorDocChanged() {
    if (!isCodeEditMode()) {
      return;
    }
    host.markSceneDirty?.();
    scheduleAutoRenderDebounced();
  }

  async function renderJsonToCanvas(options = {}) {
    const { silent = false, skipDirtyConfirm = false } = options;
    const aiOk = await host.getAiSidebar?.()?.interruptAiSessionIfActive?.("从 JSON 载入场景");
    if (!aiOk) {
      return false;
    }
    if (!skipDirtyConfirm) {
      const dirtyOk = await host.confirmOverwriteIfDirty?.({ actionLabel: "从 JSON 载入场景" });
      if (!dirtyOk) {
        return false;
      }
    }
    cancelAutoRenderTimer();
    const raw = String(getActiveCodeJsonText() || "").trim();
    if (!raw) {
      throw new Error("JSON 不能为空。");
    }
    const parsed = parseSceneJsonString(raw);
    let payload = resolveScenePayloadForLoad(parsed);
    if (!isLoadableScenePayload(payload)) {
      throw new Error("JSON 格式无效（需要 worldInfo 或非空 objectList）");
    }
    host.getScenePayloadFormat?.()?.recordEditorScenePayloadViewFormat?.(payload, "Code 模式");
    const loaded = await host.ingestScenePayload(payload, "Code 模式");
    if (!loaded) {
      throw new Error("场景载入失败。");
    }
    host.getSceneManagePanel()?.bindFromPayload();
    if (!silent) {
      host.showMessage("已从 JSON 载入场景。", "success");
    }
    if (isCodeEditMode()) {
      await refreshFromScene();
    }
    return true;
  }

  function initPipDrag() {
    if (!pipControlBar || !canvasWrap || !stageShell) {
      return;
    }
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let pipW = 0;
    let pipH = 0;
    let stageW = 0;
    let stageH = 0;

    pipControlBar.addEventListener("pointerdown", (event) => {
      if (!isCodeEditMode() || event.button !== 0) {
        return;
      }
      if (event.target?.closest?.("button, input, label")) {
        return;
      }
      const pipRect = canvasWrap.getBoundingClientRect();
      const stageRect = stageShell.getBoundingClientRect();
      startX = event.clientX;
      startY = event.clientY;
      startLeft = pipRect.left - stageRect.left;
      startTop = pipRect.top - stageRect.top;
      pipW = pipRect.width;
      pipH = pipRect.height;
      stageW = stageRect.width;
      stageH = stageRect.height;
      canvasWrap.style.right = "auto";
      canvasWrap.style.left = `${startLeft}px`;
      canvasWrap.style.top = `${startTop}px`;
      dragging = true;
      try {
        pipControlBar.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      event.preventDefault();
    });

    pipControlBar.addEventListener("pointermove", (event) => {
      if (!dragging) {
        return;
      }
      let nextLeft = startLeft + (event.clientX - startX);
      let nextTop = startTop + (event.clientY - startY);
      nextLeft = Math.max(0, Math.min(nextLeft, Math.max(0, stageW - pipW)));
      nextTop = Math.max(0, Math.min(nextTop, Math.max(0, stageH - pipH)));
      canvasWrap.style.left = `${nextLeft}px`;
      canvasWrap.style.top = `${nextTop}px`;
    });

    const endPipDrag = (event) => {
      if (!dragging) {
        return;
      }
      dragging = false;
      try {
        pipControlBar.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      savePipGeometryFromCurrent();
    };
    pipControlBar.addEventListener("pointerup", endPipDrag);
    pipControlBar.addEventListener("pointercancel", endPipDrag);
  }

  function initPipResize() {
    if (!canvasWrap || !stageShell) {
      return;
    }
    const handles = canvasWrap.querySelectorAll(".pipResizeHandle");
    if (!handles.length) {
      return;
    }
    let resizing = false;
    let dir = "";
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let startW = 0;
    let startH = 0;
    let stageW = 0;
    let stageH = 0;
    let activeHandle = null;
    let rafId = 0;

    const scheduleResizeRender = () => {
      if (rafId) {
        return;
      }
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        host.windowResize?.();
      });
    };

    const onMove = (event) => {
      if (!resizing) {
        return;
      }
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      let left = startLeft;
      let top = startTop;
      let width = startW;
      let height = startH;
      if (dir.includes("e")) {
        width = Math.max(PIP_MIN_WIDTH, startW + dx);
      }
      if (dir.includes("s")) {
        height = Math.max(PIP_MIN_HEIGHT, startH + dy);
      }
      if (dir.includes("w")) {
        width = Math.max(PIP_MIN_WIDTH, startW - dx);
        left = startLeft + (startW - width);
      }
      if (dir.includes("n")) {
        height = Math.max(PIP_MIN_HEIGHT, startH - dy);
        top = startTop + (startH - height);
      }
      width = Math.min(width, stageW);
      height = Math.min(height, stageH);
      left = Math.max(0, Math.min(left, Math.max(0, stageW - width)));
      top = Math.max(0, Math.min(top, Math.max(0, stageH - height)));
      canvasWrap.style.right = "auto";
      canvasWrap.style.left = `${left}px`;
      canvasWrap.style.top = `${top}px`;
      canvasWrap.style.width = `${width}px`;
      canvasWrap.style.height = `${height}px`;
      scheduleResizeRender();
    };

    const endResize = () => {
      if (!resizing) {
        return;
      }
      resizing = false;
      dir = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", endResize);
      window.removeEventListener("pointercancel", endResize);
      if (activeHandle) {
        try {
          activeHandle.releasePointerCapture?.();
        } catch {
          /* ignore */
        }
        activeHandle = null;
      }
      savePipGeometryFromCurrent();
      host.windowResize?.();
    };

    handles.forEach((handle) => {
      handle.addEventListener("pointerdown", (event) => {
        if (!isCodeEditMode() || event.button !== 0) {
          return;
        }
        const pipRect = canvasWrap.getBoundingClientRect();
        const stageRect = stageShell.getBoundingClientRect();
        dir = String(handle.dataset.resizeDir || "");
        startX = event.clientX;
        startY = event.clientY;
        startLeft = pipRect.left - stageRect.left;
        startTop = pipRect.top - stageRect.top;
        startW = pipRect.width;
        startH = pipRect.height;
        stageW = stageRect.width;
        stageH = stageRect.height;
        resizing = true;
        activeHandle = handle;
        try {
          handle.setPointerCapture(event.pointerId);
        } catch {
          /* ignore */
        }
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", endResize);
        window.addEventListener("pointercancel", endResize);
        event.preventDefault();
        event.stopPropagation();
      });
    });
  }

  function init() {
    editModeSeg3d?.addEventListener("click", () => enterThreeMode());
    editModeSegCode?.addEventListener("click", () => {
      void enterCodeMode();
    });
    document.getElementById("menuCodeEditMode")?.addEventListener("click", () => {
      toggleEditMode();
      host.closeAllDropdowns?.();
    });
    document.getElementById("menuToggleEditModeFromMenu")?.addEventListener("click", () => {
      toggleEditMode();
      host.closeAllDropdowns?.();
    });
    codeEditorRenderBtn?.addEventListener("click", () => {
      void (async () => {
        try {
          await host.runWithLoadingMask?.("正在从 JSON 载入场景...", () => renderJsonToCanvas());
        } catch (error) {
          host.showMessage(String(error?.message || error), "error");
        }
      })();
    });
    codeEditorFallbackTextarea?.addEventListener("input", () => {
      onCodeEditorDocChanged();
    });
    codeEditorAutoRenderCheckbox?.addEventListener("change", () => {
      if (!codeEditorAutoRenderCheckbox.checked) {
        cancelAutoRenderTimer();
      }
    });
    initPipDrag();
    initPipResize();
    syncEditModeToggleUi();
  }

  return {
    init,
    isCodeEditMode,
    toggleEditMode,
    enterCodeMode,
    enterThreeMode,
    refreshFromScene,
    renderJsonToCanvas,
    locateThreeJsonIdInCodeEditor,
    maybeLocateThreeJsonIdInCodeEditor,
    cancelAutoRenderTimer,
    getActiveCodeJsonText,
    setActiveCodeJsonText,
    isCodeMirrorFocused,
    syncCodeModeCheckboxesFromSettings
  };
}

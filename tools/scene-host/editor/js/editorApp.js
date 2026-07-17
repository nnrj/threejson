import {
  buildAdaptiveContentBoundingBoxTHREE,
  configureLogger,
  createJsonScene,
  createJsonSceneFromArchive,
  deployJsonSceneFromArchive,
  disposeTrackedResources,
  ensureDefaultSceneLightsInScene,
  ensureThreeJsonIdsOnScenePayload,
  fitPerspectiveCameraToContentBoundsTHREE,
  getObjectByThreeJsonId,
  importMeshBlob,
  inferMeshImportFormatFromFileName,
  inspectJsonSceneArchiveEntry,
  isThreeJsObjectExportJson,
  openOrCloseProgressManager,
  parseSceneJsonString,
  pauseAllThreeJsonSceneAudio,
  resolveScenePayloadForLoad,
  resumeAllThreeJsonSceneAudio,
  sceneToFriendlyJson,
  sceneToJson,
  sceneToStandardJsonSimple,
  teardownThreeJsonSceneAudioFromRuntime,
  trackDisposableResource,
  bindProgressElement
} from "threejson";
import {
  createJsonSceneFromObjectRecord,
  deployObjectRecordIntoRuntime,
  isObjectRecordEntry as isObjectRecordEntryHandler
} from "../../../../core/handler/sceneLoadHandler.js";
import { isLoadableScenePayload } from "../../../../core/handler/sceneFriendlyNormalizer.js";
import { buildEditorScenePayload } from "../../shared/js/buildEditorRuntimeConfig.js";
import { createEditorSysConfig } from "../../shared/js/createEditorSysConfig.js";
import { resolveSceneHostUrl, sceneHostAssetUrl } from "../../shared/js/sceneHostPaths.js";
import {
  applyEditorSettingsToSysConfig,
  clearEditorSettingsCache,
  cloneEditorSettings,
  deepMergeEditorSettings,
  fetchEditorSettingsFileDefaults,
  getDefaultSceneJsonUrl,
  getLoadingMaskDefaultText,
  getSceneLoadDoneDelayMs,
  loadEditorSettingsBundle,
  persistEditorSettings
} from "../../shared/js/editorSettingsStore.js";
import { EDITOR_SETTINGS_DEFAULTS } from "../../shared/js/editorSettingsSchema.js";
import { initHostI18n, applyShellI18n, t } from "../../shared/i18n/index.js";
import { resolveEditorRuntimeFlags, resolveEditorRuntimeFlagsSync } from "./runtimeFlags.js";
import { createRunScenePreviewController } from "../../shared/js/runSceneViaPlayer.js";
import { createSettingsModalController } from "./settingsModal.js";
import { createUiFeedback } from "./uiFeedback.js";
import { createSceneTreePanel } from "./sceneTreePanel.js";
import { createCommandLayer } from "./commandLayer.js";
import { createAiSidebar } from "./aiSidebar.js";
import { createEditorInteraction } from "./editorInteraction.js";
import { createEditorHistory } from "./editorHistory.js";
import { createRightDockPanel } from "./rightDockPanel.js";
import { createSceneManagePanel } from "./sceneManagePanel.js";
import { createEventEditorPanel } from "./eventEditorPanel.js";
import { createAssetLibraryPanel } from "./assetLibraryPanel.js";
import { createRecentScenesController } from "./recentScenes.js";
import { createCodeEditorMode } from "./codeEditorMode.js";
import { createEditorThreeView } from "./editorThreeView.js";
import { createEditorDocumentState } from "./editorDocumentState.js";
import { createModelGroupPanel } from "./modelGroupPanel.js";
import { createPresetScenePanel } from "./presetScenePanel.js";
import { createSceneDocumentOps } from "./sceneDocumentOps.js";
import { createEditorSceneNameModals } from "./editorSceneNameModals.js";
import { createEditorSessionRecovery } from "./editorSessionRecovery.js";
import { createEditorCacheClear } from "./editorCacheClear.js";
import { createEditorDomainExport } from "./editorDomainExport.js";
import { createEditorDomainDrillIn } from "./editorDomainDrillIn.js";
import { createEditorMeshExportModal } from "./editorMeshExportModal.js";
import { createEditorExportDownload } from "./editorExportDownload.js";
import { createEditorTjzExportModal } from "./editorTjzExportModal.js";
import { createEditorTemplateExportModal } from "./editorTemplateExportModal.js";
import { createEditorCapture } from "./editorCapture.js";
import { createSceneTreeContextMenu } from "./sceneTreeContextMenu.js";
import { exportNativeSceneJson } from "./editorNativeJsonExport.js";
import { createEditorHelpAndSceneJson } from "./editorHelpAndSceneJson.js";
import { initTopMenubarExclusiveOpen } from "../../shared/js/topMenubarExclusiveOpen.js";
import { createEditorChromeUi } from "./editorChromeUi.js";
import { createEditorViewChrome } from "./editorViewChrome.js";
import { createEditorSceneReserialize } from "./editorSceneReserialize.js";
import { createEditorGridHelper } from "./editorGridHelper.js";
import {
  createViewportGizmoOverlay,
  disposeViewportGizmoOverlay,
  renderViewportGizmoOverlay
} from "../../shared/js/viewportGizmoOverlay.js";
import { createEditorViewPreserve } from "./editorViewPreserve.js";
import {
  formatEditorTopBarSceneTitle,
  pickEditorSceneTitleSuffix
} from "./editorSceneTitle.js";
import { createEditorScenePayloadFormat } from "./editorScenePayloadFormat.js";
import { createEditorRightSidebarCache } from "./editorRightSidebarCache.js";
import { createEditorSuppressCanvasDirty } from "./editorSuppressCanvasDirty.js";
import { bindEditorKeyboardShortcuts } from "./editorKeyboardShortcuts.js";
import { injectCurrentCameraIntoScenePayload } from "../../shared/js/injectCurrentCameraIntoScenePayload.js";
import { buildCaptureOptionsForContext } from "./editorSessionCapture.js";
import * as THREE from "three";
import { sceneToNativeJson, buildRoomSavePayload } from "../../../../core/handler/sceneJsonHandler.js";

const EDITOR_OPEN_SCENE_BRIDGE_PREFIX = "threejson.editor.openScene.";

function readFileExtension(fileName = "") {
  const normalized = String(fileName || "").trim().toLowerCase();
  const idx = normalized.lastIndexOf(".");
  if (idx < 0 || idx === normalized.length - 1) {
    return "";
  }
  return normalized.slice(idx);
}

function isLikelyBinaryBuffer(bytes) {
  if (!bytes || bytes.length === 0) {
    return false;
  }
  const sampleLen = Math.min(bytes.length, 4096);
  let suspicious = 0;
  for (let i = 0; i < sampleLen; i++) {
    const one = bytes[i];
    if (one === 0) {
      return true;
    }
    const isTabOrLineBreak = one === 9 || one === 10 || one === 13;
    if ((one < 32 && !isTabOrLineBreak) || one === 127) {
      suspicious += 1;
    }
  }
  return suspicious / sampleLen > 0.1;
}

function isScenePayloadEntry(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return false;
  }
  return Boolean(parsed.worldInfo || parsed.objectList || parsed.sceneConfig);
}

function isSingleObjectJsonImport(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return false;
  }
  if (isThreeJsObjectExportJson(parsed)) {
    return false;
  }
  if (isScenePayloadEntry(parsed)) {
    return false;
  }
  return isObjectRecordEntryHandler(parsed);
}

function formatWebGLInitError(err) {
  const raw = String(err?.message || err);
  if (/blocked|context loss|WebGL|webgl/i.test(raw)) {
    return `无法创建 WebGL 上下文：${raw}。请完全刷新本页（Ctrl+F5），并关闭其他占用 GPU 的浏览器标签后重试。`;
  }
  return raw;
}

export async function bootstrapSceneHostEditor() {
  const rootContainer = document.getElementById("rootContainer");

  const canvasContainer = document.getElementById("canvasContainer");
  const canvasWrap = document.getElementById("canvasWrap");
  const stageShell = document.getElementById("stageShell");
  const topBarSceneTitle = document.getElementById("topBarSceneTitle");
  const editorStartupEmptyState = document.getElementById("editorStartupEmptyState");

  const fileInputs = {
    sceneJson: document.getElementById("sceneJsonFileInput"),
    topBarOpen: document.getElementById("topBarOpenFileInput"),
    nativeThree: document.getElementById("nativeThreeJsonFileInput"),
    tjz: document.getElementById("tjzArchiveFileInput"),
    mesh: document.getElementById("meshModelFileInput")
  };

  const modals = {
    fullSceneLoad: document.getElementById("fullSceneLoadPromptModal"),
    fullSceneLoadLights: document.getElementById("fullSceneLoadFillLightsRow"),
    fullSceneLoadCamera: document.getElementById("fullSceneLoadFillCameraRow"),
    fullSceneLoadLightsCb: document.getElementById("fullSceneLoadFillLightsCheckbox"),
    fullSceneLoadCameraCb: document.getElementById("fullSceneLoadFillCameraCheckbox"),
    fullSceneLoadConfirm: document.getElementById("fullSceneLoadPromptConfirmBtn"),
    fullSceneLoadCancel: document.getElementById("fullSceneLoadPromptCancelBtn"),
    objectImport: document.getElementById("tjzImportModeModal"),
    objectImportConfirm: document.getElementById("tjzImportModeConfirmBtn"),
    objectImportCancel: document.getElementById("tjzImportModeCancelBtn"),
    objectImportMode: document.getElementById("tjzImportModeSelect"),
    objectImportFitView: document.getElementById("objectImportFitViewCheckbox"),
    objectImportFillLightsRow: document.getElementById("objectImportFillLightsRow"),
    objectImportFillLightsCb: document.getElementById("objectImportFillLightsCheckbox"),
    objectImportFillCameraRow: document.getElementById("objectImportFillCameraRow"),
    objectImportFillCameraCb: document.getElementById("objectImportFillCameraCheckbox")
  };

  const OBJECT_IMPORT_SESSION_FILL_LIGHTS = "sceneEditor_objectImportFillLights";
  const OBJECT_IMPORT_SESSION_FILL_CAMERA = "sceneEditor_objectImportFillCamera";

  function readObjectImportSessionBool(key, fallback = true) {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw === "0" || raw === "false") {
        return false;
      }
      if (raw === "1" || raw === "true") {
        return true;
      }
    } catch {
      /* ignore */
    }
    return fallback;
  }

  function writeObjectImportSessionBool(key, value) {
    try {
      sessionStorage.setItem(key, value ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  let editorSettingsFileDefaults = null;
  let editorSettings = null;
  let sysConfig = createEditorSysConfig();
  let sceneRuntime = null;
  let scene = null;
  let camera = null;
  let renderer = null;
  let controls = null;
  let renderLoop = null;
  let pendingCreateJsonSceneFlags = null;
  let currentSceneLabel = "";
  let audioMuted = false;
  let selectedObj = null;
  let sceneTree = null;
  let commandLayer = null;
  let aiSidebar = null;
  let editorInteraction = null;
  let editorHistory = null;
  let rightDockPanel = null;
  let sceneManagePanel = null;
  let eventEditorPanel = null;
  let runScenePreview = null;
  let assetLibraryPanel = null;
  let recentScenes = null;
  let codeEditor = null;
  let sceneDocumentOps = null;
  let sceneNameModals = null;
  let presetScenePanel = null;
  let modelGroupPanel = null;
  let editorDocumentState = null;
  let editorThreeView = null;
  let editorSessionRecovery = null;
  let editorCacheClear = null;
  let editorDomainExport = null;
  let editorDomainDrillIn = null;
  let editorMeshExportModal = null;
  let editorExportDownload = null;
  let editorTjzExportModal = null;
  let editorTemplateExportModal = null;
  let editorCapture = null;
  let editorHelpAndSceneJson = null;
  let editorViewChrome = null;
  let sceneReserialize = null;
  let gridHelper = null;
  let viewPreserve = null;
  let scenePayloadFormat = null;
  let rightSidebarCache = null;
  let sceneLoadGeneration = 0;
  let editorChromeUi = null;
  let sceneTreeContextMenu = null;
  const suppressCanvasDirty = createEditorSuppressCanvasDirty();

  const BLANK_SCENE_PRESET_ID = "preset-blank-orbit";

  const host = {
    getScene: () => scene,
    getCamera: () => camera,
    getRenderer: () => renderer,
    getControls: () => controls,
    getRenderLoop: () => renderLoop,
    getSceneRuntime: () => sceneRuntime,
    hasRuntimeReady,
    getSysConfig: () => sysConfig,
    getSelectedObject: () => selectedObj,
    setSelectedObject: (obj) => {
      selectedObj = obj;
    },
    getEditorSettings: () => editorSettings,
    showMessage: (...args) => ui.showMessage(...args),
    ingestScenePayload,
    runEditorCommands,
    fitViewToScene,
    fitViewToSelectionBounds,
    getSuppressCanvasDirty: () => suppressCanvasDirty,
    markSceneDirty: () => {
      editorDocumentState?.markDirty?.();
      editorSessionRecovery?.onDirty?.();
      runScenePreview?.scheduleHotReload?.();
    },
    markSceneSaved: () => {
      editorDocumentState?.markSaved?.();
      editorSessionRecovery?.onSaved?.();
    },
    getEditorDocumentState: () => editorDocumentState,
    getSessionRecovery: () => editorSessionRecovery,
    getEditorCacheClear: () => editorCacheClear,
    toggleStartupEmptyState,
    confirmOverwriteIfDirty: (options) =>
      editorDocumentState?.confirmOverwriteIfDirty?.(options) ?? Promise.resolve(true),
    openTriChoiceModal: (options) =>
      editorDocumentState?.openTriChoiceModal?.(options) ?? Promise.resolve("overwrite"),
    persistSettings: () => {
      if (editorSettings) {
        persistEditorSettings(editorSettings);
      }
    },
    getSceneTree: () => sceneTree,
    getCommandLayer: () => commandLayer,
    getAiSidebar: () => aiSidebar,
    getEditorThreeView: () => editorThreeView,
    getEditorInteraction: () => editorInteraction,
    getSceneReserialize: () => sceneReserialize,
    getGridHelper: () => gridHelper,
    getViewPreserve: () => viewPreserve,
    getScenePayloadFormat: () => scenePayloadFormat,
    getRightSidebarCache: () => rightSidebarCache,
    getRightDockPanel: () => rightDockPanel,
    getSceneLoadGeneration: () => sceneLoadGeneration,
    buildSceneToJsonOptionsForDisplay: (extra) =>
      scenePayloadFormat?.buildSceneToJsonOptionsForDisplay?.(extra) ?? buildSceneToJsonOptions(extra),
    resolveFriendlyMapFromPayload,
    ensureCanvasSyncedBeforeExport: () =>
      sceneReserialize?.ensureCanvasSyncedBeforeExport?.(),
    getEditorHistory: () => editorHistory,
    getSceneManagePanel: () => sceneManagePanel,
    getEventEditorPanel: () => eventEditorPanel,
    getRunScenePreview: () => runScenePreview,
    getAssetLibraryPanel: () => assetLibraryPanel,
    getRecentScenes: () => recentScenes,
    getCodeEditor: () => codeEditor,
    getPresetScenePanel: () => presetScenePanel,
    getModelGroupPanel: () => modelGroupPanel,
    getSceneNameModals: () => sceneNameModals,
    getSceneDocumentOps: () => sceneDocumentOps,
    getExportDownload: () => editorExportDownload,
    getEditorChromeUi: () => editorChromeUi,
    getEditorViewChrome: () => editorViewChrome,
    getAudioMuted: () => audioMuted,
    setAudioMuted: (value) => {
      audioMuted = Boolean(value);
    },
    getEditorAudioRoots: () => ({ camera, scene }),
    pauseSceneAudio: (cam, scn) => pauseAllThreeJsonSceneAudio(cam, scn),
    resumeSceneAudio: (cam, scn) => resumeAllThreeJsonSceneAudio(cam, scn),
    setEventNotice: (message) => editorChromeUi?.setEventNotice?.(message),
    buildSceneToJsonOptions: (extra) => buildSceneToJsonOptions(extra),
    getEditorDomainExport: () => editorDomainExport,
    getEditorDomainDrillIn: () => editorDomainDrillIn,
    getSceneTreeContextMenu: () => sceneTreeContextMenu,
    getUi: () => ui,
    getEditorExportDownload: () => editorExportDownload,
    getTransformControlsHelper: () => editorInteraction?.getTransformControlsHelper?.(),
    getBoxEdgeHelper: () => editorInteraction?.getBoxEdgeHelper?.(),
    getCurrentSceneLabel: () => currentSceneLabel,
    updateSceneTitle,
    clearLoadingUi() {
      ui.setLoading(false);
      openOrCloseProgressManager(false);
    },
    async runWithLoadingMask(message, task, options) {
      return ui.runWithLoadingMask(message, task, options);
    }
  };

  const settingsRef = { current: null };
  const ui = createUiFeedback({
    editorSettingsRef: settingsRef,
    getEditorSettings: () => editorSettings,
    getSysConfig: () => sysConfig
  });

  const modalUi = {
    openFullSceneLoadPrompt({ needsLights, needsCamera }) {
      return new Promise((resolve) => {
        modals.fullSceneLoadLights?.toggleAttribute("hidden", !needsLights);
        modals.fullSceneLoadCamera?.toggleAttribute("hidden", !needsCamera);
        if (modals.fullSceneLoadLightsCb) modals.fullSceneLoadLightsCb.checked = true;
        if (modals.fullSceneLoadCameraCb) modals.fullSceneLoadCameraCb.checked = true;
        modals.fullSceneLoad?.classList.add("visible");
        const cleanup = () => modals.fullSceneLoad?.classList.remove("visible");
        const onConfirm = () => {
          resolve({
            fillLights: needsLights ? modals.fullSceneLoadLightsCb?.checked !== false : true,
            fillCamera: needsCamera ? modals.fullSceneLoadCameraCb?.checked !== false : true
          });
          cleanup();
        };
        const onCancel = () => {
          resolve(null);
          cleanup();
        };
        const once = { once: true };
        modals.fullSceneLoadConfirm?.addEventListener("click", onConfirm, once);
        modals.fullSceneLoadCancel?.addEventListener("click", onCancel, once);
        modals.fullSceneLoad?.addEventListener(
          "click",
          (e) => {
            if (e.target === modals.fullSceneLoad) onCancel();
          },
          once
        );
      });
    },
    openObjectImportModeModal() {
      return new Promise((resolve) => {
        const render = editorSettings?.render || {};
        const lightsMode = render.objectRecordFillLightsMode || "prompt";
        const cameraMode = render.objectRecordFillCameraMode || "prompt";
        const showLights = lightsMode === "prompt";
        const showCamera = cameraMode === "prompt";
        if (modals.objectImportMode) {
          modals.objectImportMode.value = "append";
        }
        if (modals.objectImportFitView) {
          modals.objectImportFitView.checked = editorSettings?.io?.objectImportFitViewDefault !== false;
        }
        modals.objectImportFillLightsRow?.toggleAttribute("hidden", !showLights);
        modals.objectImportFillCameraRow?.toggleAttribute("hidden", !showCamera);
        if (modals.objectImportFillLightsCb) {
          modals.objectImportFillLightsCb.checked = readObjectImportSessionBool(
            OBJECT_IMPORT_SESSION_FILL_LIGHTS,
            true
          );
        }
        if (modals.objectImportFillCameraCb) {
          modals.objectImportFillCameraCb.checked = readObjectImportSessionBool(
            OBJECT_IMPORT_SESSION_FILL_CAMERA,
            true
          );
        }
        modals.objectImport?.classList.add("visible");
        const cleanup = () => modals.objectImport?.classList.remove("visible");
        const onConfirm = () => {
          let mode = modals.objectImportMode?.value || "append";
          if (mode === "replaceWithRelight") {
            mode = "replaceOnly";
          }
          const pick = {
            mode: mode === "replaceOnly" ? "replaceOnly" : "append",
            fitView: modals.objectImportFitView?.checked !== false
          };
          if (showLights) {
            pick.fillLights = modals.objectImportFillLightsCb?.checked !== false;
            writeObjectImportSessionBool(OBJECT_IMPORT_SESSION_FILL_LIGHTS, pick.fillLights);
          }
          if (showCamera) {
            pick.fillCamera = modals.objectImportFillCameraCb?.checked !== false;
            writeObjectImportSessionBool(OBJECT_IMPORT_SESSION_FILL_CAMERA, pick.fillCamera);
          }
          resolve(pick);
          cleanup();
        };
        const onCancel = () => {
          resolve(null);
          cleanup();
        };
        const once = { once: true };
        modals.objectImportConfirm?.addEventListener("click", onConfirm, once);
        modals.objectImportCancel?.addEventListener("click", onCancel, once);
        modals.objectImport?.addEventListener(
          "click",
          (e) => {
            if (e.target === modals.objectImport) {
              onCancel();
            }
          },
          once
        );
      });
    }
  };

  function toggleStartupEmptyState(show) {
    if (!editorStartupEmptyState) {
      return;
    }
    editorStartupEmptyState.hidden = !show;
    if (show) {
      ui.setLoading(false);
      openOrCloseProgressManager(false);
    }
  }

  function updateSceneTitle(label = "") {
    const suffix = pickEditorSceneTitleSuffix(label, sysConfig.jsonData);
    if (suffix) {
      currentSceneLabel = suffix;
    } else {
      currentSceneLabel = String(label || "").trim();
    }
    if (topBarSceneTitle) {
      topBarSceneTitle.textContent = formatEditorTopBarSceneTitle(
        suffix,
        editorSettings?.general?.baseTitle
      );
    }
    editorDocumentState?.syncDocumentTitle?.();
  }

  function resolveEditorMergeBase() {
    return sysConfig.jsonData || {};
  }

  function resolveFriendlyMapFromPayload(payload = {}) {
    if (payload?.friendlyMap && typeof payload.friendlyMap === "object") {
      return payload.friendlyMap;
    }
    if (payload?.worldInfo?.friendlyMap && typeof payload.worldInfo.friendlyMap === "object") {
      return payload.worldInfo.friendlyMap;
    }
    return undefined;
  }

  function buildSceneToJsonOptions(extra = {}) {
    const basePayload = Object.prototype.hasOwnProperty.call(extra, "basePayload")
      ? extra.basePayload
      : resolveEditorMergeBase();
    const subSceneLayout = extra.subSceneLayout ?? editorSettings?.sceneJson?.subSceneLayout ?? "nested";
    const subSceneNormalizePolicy =
      extra.subSceneNormalizePolicy ?? editorSettings?.sceneJson?.subSceneNormalizePolicy ?? "warn";
    const committedFormat =
      editorSettings?.sceneJson?.codeViewFormatWriteback &&
      (editorSettings?.sceneJson?.codeViewFormat === "friendly" ||
        editorSettings?.sceneJson?.codeViewFormat === "standard")
        ? editorSettings.sceneJson.codeViewFormat
        : undefined;
    const format = extra.format ?? committedFormat;
    return {
      basePayload,
      shouldSkipObject: (obj) => sceneTree?.isRuntimeOnlyObject?.(obj) ?? false,
      merge: extra.merge !== false,
      ...(format ? { format } : {}),
      subSceneLayout,
      subSceneNormalizePolicy,
      ...extra,
      basePayload,
      subSceneLayout,
      subSceneNormalizePolicy
    };
  }

  function hasRuntimeReady() {
    return Boolean(sceneRuntime?.scene || scene?.isScene);
  }

  function assignRuntime(runtime) {
    if (!runtime) {
      return;
    }
    sceneRuntime = runtime;
    scene = runtime.scene ?? scene;
    camera = runtime.camera ?? camera;
    renderer = runtime.renderer ?? renderer;
    controls = runtime.controls ?? controls;
    renderLoop = runtime.renderLoop ?? renderLoop;
  }

  let viewportGizmoContainer = null;

  function ensureViewportGizmoContainer() {
    if (viewportGizmoContainer) {
      return viewportGizmoContainer;
    }
    if (!stageShell) {
      return null;
    }
    const el = document.createElement("div");
    el.id = "viewportGizmoOverlayRoot";
    // Sits above the docked side panels (.flyoutHost is z-index:55) so the gizmo isn't hidden
    // behind the properties panel's top-right corner; stays below the top chrome bar (z-index:200).
    el.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:60;";
    stageShell.appendChild(el);
    viewportGizmoContainer = el;
    return el;
  }

  function syncViewportGizmoFromSettings() {
    disposeViewportGizmoOverlay();
    if (editorSettings?.editing?.showViewportGizmo === false) {
      return;
    }
    createViewportGizmoOverlay({ camera, renderer, controls }, ensureViewportGizmoContainer(), {
      id: "viewportGizmoOverlay"
    });
  }

  function clearEditorCanvasSurface() {
    const canvasEl = canvasContainer;
    try {
      if (renderer && canvasEl && typeof renderer.getContext === "function") {
        const gl = renderer.getContext();
        if (gl) {
          gl.clearColor(47 / 255, 47 / 255, 47 / 255, 1);
          gl.viewport(0, 0, canvasEl.width, canvasEl.height);
          gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
        }
      }
    } catch {
      /* WebGL 可能已失效，忽略 */
    }
    try {
      if (canvasEl) {
        const w = canvasEl.width;
        canvasEl.width = w;
      }
    } catch {
      /* ignore */
    }
  }

  function startEditorRenderLoopEarly() {
    if (!renderLoop) {
      return;
    }
    renderLoop.setComposer(editorInteraction?.getComposer?.() ?? null);
    renderLoop.start();
  }

  function teardownGraphics() {
    renderLoop?.stop?.();
    editorInteraction?.dispose();
    gridHelper?.dispose?.();
    disposeViewportGizmoOverlay();
    try {
      teardownThreeJsonSceneAudioFromRuntime(sceneRuntime);
    } catch {
      /* ignore */
    }
    try {
      disposeTrackedResources();
    } catch (error) {
      console.warn("[scene-editor] dispose", error);
    }
    try {
      sceneRuntime?.dispose?.();
    } catch {
      /* ignore */
    }
    clearEditorCanvasSurface();
    sceneRuntime = null;
    scene = null;
    camera = null;
    renderer = null;
    controls = null;
    renderLoop = null;
    codeEditor?.cancelAutoRenderTimer?.();
    sysConfig.meshList = [];
    sysConfig.meshObjects = [];
    audioMuted = false;
    editorChromeUi?.syncEditorMuteUi?.();
    selectedObj = null;
    assetLibraryPanel?.clear();
    sceneTree?.clear();
  }

  function resetInitFlags() {
    for (const key of Object.keys(sysConfig.initFlags)) {
      if (key !== "highLightInitFlag") {
        sysConfig.initFlags[key] = true;
      }
    }
  }

  function primeCanvasLayout() {
    const w = canvasWrap?.clientWidth || canvasContainer?.clientWidth || window.innerWidth;
    const h = canvasWrap?.clientHeight || canvasContainer?.clientHeight || window.innerHeight;
    if (w > 0 && h > 0) {
      sysConfig.canvasWidth = w;
      sysConfig.canvasHeight = h;
      sysConfig.windowSizeNow.width = w;
      sysConfig.windowSizeNow.height = h;
    }
  }

  async function waitCanvasLayout() {
    primeCanvasLayout();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    primeCanvasLayout();
  }

  function windowResize() {
    const wrapRect = canvasWrap?.getBoundingClientRect?.();
    const myWidth = Math.round(
      (wrapRect?.width > 0 ? wrapRect.width : 0) ||
      canvasWrap?.clientWidth ||
      canvasContainer?.clientWidth ||
      Math.max(100, stageShell?.clientWidth ?? rootContainer?.clientWidth ?? window.innerWidth)
    );
    const myHeight = Math.round(
      (wrapRect?.height > 0 ? wrapRect.height : 0) ||
      canvasWrap?.clientHeight ||
      canvasContainer?.clientHeight ||
      window.innerHeight
    );
    if (!Number.isFinite(myWidth) || !Number.isFinite(myHeight) || myWidth < 1 || myHeight < 1) {
      return false;
    }
    sysConfig.windowSizeNow.width = myWidth;
    sysConfig.windowSizeNow.height = myHeight;
    sysConfig.canvasWidth = myWidth;
    sysConfig.canvasHeight = myHeight;
    // canvasWrap owns the responsive CSS size. Do not let WebGLRenderer replace
    // the canvas' 100% sizing with a stale inline pixel width during mode changes.
    renderLoop?.resize({ width: myWidth, height: myHeight, updateStyle: false });
    editorThreeView?.onWindowResize?.();
    return true;
  }
  host.windowResize = windowResize;

  async function syncCanvasViewportAfterLayout(options = {}) {
    const maxFrames = Math.max(2, Number(options.maxFrames) || 8);
    let previous = null;
    let stableFrames = 0;
    for (let frame = 0; frame < maxFrames; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const rect = canvasWrap?.getBoundingClientRect?.();
      const width = Math.round(rect?.width || canvasWrap?.clientWidth || 0);
      const height = Math.round(rect?.height || canvasWrap?.clientHeight || 0);
      if (width < 1 || height < 1) {
        previous = null;
        stableFrames = 0;
        continue;
      }
      if (previous && previous.width === width && previous.height === height) {
        stableFrames += 1;
      } else {
        previous = { width, height };
        stableFrames = 0;
      }
      if (stableFrames >= 1) {
        break;
      }
    }
    return windowResize();
  }
  host.syncCanvasViewportAfterLayout = syncCanvasViewportAfterLayout;

  function buildCreateJsonSceneOptions(flags = {}, extra = {}) {
    const renderLoopUserPolicy = {
      fps: sysConfig.fps,
      lowFps: sysConfig.lowFps,
      overrideSceneRenderLoop: editorSettings?.render?.overrideSceneRenderLoop === true
    };
    const opts = {
      canvas: canvasContainer,
      assetsBase: sceneHostAssetUrl("assets/"),
      cameraFallbackPosition: editorSettings?.render?.cameraFallbackPosition,
      defaultFov: editorSettings?.render?.defaultFov,
      orbitDampingFactor: editorSettings?.render?.orbitDampingFactor,
      orbitMaxPolarAngle: editorSettings?.render?.orbitMaxPolarAngle,
      sceneAutoRotate: sysConfig.sceneAutoRotate,
      renderLoopUserPolicy,
      subSceneNormalizePolicy: editorSettings?.sceneJson?.subSceneNormalizePolicy ?? "warn",
      afterRender: () => {
        editorThreeView?.afterRender?.();
        renderViewportGizmoOverlay();
      },
      async onRuntimeReady(ctx) {
        assignRuntime(ctx.runtime);
        syncViewportGizmoFromSettings();
        if (scene?.isScene) {
          trackDisposableResource(scene);
        }
        windowResize();
        if (editorSettings?.render?.earlyRenderWhileLoading !== false) {
          startEditorRenderLoopEarly();
        }
      },
      ...extra
    };
    if (flags.autoFillLights === false) opts.autoFillLights = false;
    else if (flags.autoFillLights === true) opts.autoFillLights = true;
    if (flags.autoFillCamera === true) opts.autoFillCamera = true;
    else if (flags.autoFillCamera === false) opts.autoFillCamera = false;
    if (flags.autoFitCamera === true) {
      opts.autoFitCamera = true;
      opts.autoFitCameraMode = flags.autoFitCameraMode || "positionAndTarget";
    }
    if (typeof flags.bindSceneEvents === "boolean") {
      opts.bindSceneEvents = flags.bindSceneEvents;
    }
    return opts;
  }

  async function initSceneRuntime() {
    await waitCanvasLayout();
    if (sceneRuntime) {
      teardownGraphics();
    }
    const payload = buildEditorScenePayload(sysConfig, editorSettings);
    let flags = pendingCreateJsonSceneFlags;
    if (!flags) {
      flags = await resolveEditorRuntimeFlags(editorSettings, "fullScene", payload, null, modalUi);
      if (!flags) {
        throw new Error("已取消载入场景。");
      }
    }
    pendingCreateJsonSceneFlags = null;
    try {
      sceneRuntime = await createJsonScene(payload, buildCreateJsonSceneOptions(flags));
    } catch (err) {
      throw new Error(formatWebGLInitError(err));
    }
    assignRuntime(sceneRuntime);
    resetInitFlags();
    trackDisposableResource(scene);
    editorInteraction?.refreshBoxEdgeColor?.();
    gridHelper?.syncEditorGridHelperFromSettings?.();
    editorChromeUi?.syncBottomBarHelperToggles?.();
    windowResize();
  }

  async function subInit() {
    ui.setLoadingMessage(t("editor.message.loadingSceneJson", "Loading scene JSON..."));
    await initSceneRuntime();
    editorInteraction?.initAfterSceneLoad?.();
    ensureRenderLoopStarted();
    finishEditorSceneLoad();
  }

  function ensureRenderLoopStarted() {
    if (!renderLoop) {
      return;
    }
    renderLoop.setComposer(editorInteraction?.getComposer?.() ?? null);
    renderLoop.start();
  }

  function finishEditorSceneLoad() {
    toggleStartupEmptyState(false);
    modelGroupPanel?.refreshBuiltinGroups?.();
    ui.setLoadingMessage(t("editor.message.sceneLoadDone", "3D scene loaded."));
    const delay = getSceneLoadDoneDelayMs(editorSettings);
    if (delay > 0) {
      window.setTimeout(() => ui.setLoading(false), delay);
    } else {
      ui.setLoading(false);
    }
    openOrCloseProgressManager(false);
    ui.showMessage(t("editor.message.sceneLoadDone", "3D scene loaded."), "success");
  }

  async function completeIngestAfterRuntime(hintLabel, ingestOptions, loadGeneration) {
    if (loadGeneration !== sceneLoadGeneration) {
      return false;
    }
    if (controls) {
      controls.enabled = true;
    }
    viewPreserve?.bindEditorViewPreserveListeners?.();
    updateSceneTitle(hintLabel);
    await viewPreserve?.postIngestSceneViewAdjust?.(ingestOptions, loadGeneration);
    if (loadGeneration !== sceneLoadGeneration) {
      return false;
    }
    sceneReserialize?.markSceneDocumentSynced?.();
    if (editorHistory?.shouldResetEditorHistoryBootstrap?.(hintLabel, ingestOptions)) {
      const bootSnap =
        (await editorHistory?.captureSceneSnapshotAsync?.()) ||
        editorHistory?.captureSceneSnapshot?.();
      editorHistory?.resetForFullSceneLoad?.(bootSnap);
    }
    if (ingestOptions.keepDirtyAfterLoad) {
      editorDocumentState?.markDirty?.();
      editorSessionRecovery?.onDirty?.();
    } else if (!aiSidebar?.isAgentSessionActive?.()) {
      editorDocumentState?.markDirty?.();
      editorSessionRecovery?.onDirty?.();
    }
    const snapshotCaptureOptions =
      ingestOptions.historyReplay === true
        ? buildCaptureOptionsForContext(host, "incremental")
        : buildCaptureOptionsForContext(host, "fullReplace");
    await recentScenes?.saveCurrentScene?.(hintLabel, snapshotCaptureOptions);
    toggleStartupEmptyState(false);
    await editorSessionRecovery?.writeInitialAutoSnapshot?.(snapshotCaptureOptions);
    editorHistory?.syncMenuState?.();
    return true;
  }

  async function ingestScenePayload(sceneJsonObject, hintLabel = "", ingestOptions = {}) {
    return suppressCanvasDirty.runAsync(async () => {
      toggleStartupEmptyState(false);
      const payload = resolveScenePayloadForLoad(sceneJsonObject, { label: hintLabel });
      if (!isLoadableScenePayload(payload)) {
        throw new Error(
          hintLabel
            ? `${hintLabel}: JSON 格式无效（需要 worldInfo 或非空 objectList）`
            : "JSON 格式无效（需要 worldInfo 或非空 objectList）"
        );
      }
      if (ingestOptions.historyReplay !== true) {
        scenePayloadFormat?.recordEditorScenePayloadViewFormat?.(payload, hintLabel);
      }
      const loadGeneration = ++sceneLoadGeneration;
      let runtimeFlags = ingestOptions.runtimeFlags;
      if (!runtimeFlags && ingestOptions.skipRuntimeResolve !== true) {
        runtimeFlags = await resolveEditorRuntimeFlags(editorSettings, "fullScene", payload, null, modalUi);
        if (!runtimeFlags) {
          return false;
        }
      }
      pendingCreateJsonSceneFlags = runtimeFlags || {};
      if (ingestOptions.historyReplay !== true) {
        void editorSessionRecovery?.clearAutoSnapshotOnNewIngest?.();
        rightSidebarCache?.invalidateRightSidebarSceneJsonTextCache?.();
      }
      if (
        ingestOptions.historyReplay !== true &&
        viewPreserve?.isEditorViewPreserveEnabled?.() &&
        camera &&
        controls
      ) {
        viewPreserve.captureEditorViewToSession();
      }
      teardownGraphics();
      ensureThreeJsonIdsOnScenePayload(payload);
      sysConfig.jsonData = payload;
      try {
        await subInit();
        return await completeIngestAfterRuntime(hintLabel, ingestOptions, loadGeneration);
      } catch (error) {
        ui.setLoading(false);
        openOrCloseProgressManager(false);
        ui.showMessage(String(error.message || error), "error");
        console.error(error);
        return false;
      }
    });
  }

  async function loadSceneFromUrl(url, hintLabel = "") {
    try {
      toggleStartupEmptyState(false);
      ui.setLoadingMessage("正在读取场景配置...");
      const response = await fetch(resolveSceneHostUrl(url));
      if (!response.ok) {
        throw new Error(`加载场景失败：${response.status}`);
      }
      const sceneJson = await response.json();
      scenePayloadFormat?.recordEditorScenePayloadViewFormat?.(sceneJson, hintLabel || url);
      ensureThreeJsonIdsOnScenePayload(sceneJson);
      sysConfig.jsonData = sceneJson;
      rightSidebarCache?.invalidateRightSidebarSceneJsonTextCache?.();
      await subInit();
      updateSceneTitle(hintLabel || url);
      const bootSnap =
        (await editorHistory?.captureSceneSnapshotAsync?.()) ||
        editorHistory?.captureSceneSnapshot?.();
      editorHistory?.resetForFullSceneLoad?.(bootSnap);
      editorDocumentState?.markSaved?.();
      editorSessionRecovery?.onSaved?.();
      editorDocumentState?.syncDocumentTitle?.();
      const snapshotCaptureOptions = buildCaptureOptionsForContext(host, "fullReplace");
      await editorSessionRecovery?.writeInitialAutoSnapshot?.(snapshotCaptureOptions);
      await recentScenes?.saveCurrentScene?.(hintLabel || url, snapshotCaptureOptions);
      toggleStartupEmptyState(false);
      editorHistory?.syncMenuState?.();
      return true;
    } catch (error) {
      ui.setLoading(false);
      openOrCloseProgressManager(false);
      ui.showMessage(`加载场景失败：${error.message}`, "error");
      console.error(error);
      return false;
    }
  }

  function ensureDefaultSceneLights(rootScene, autoFillLights = true) {
    return ensureDefaultSceneLightsInScene(rootScene, { autoFillLights: autoFillLights !== false });
  }

  async function applyLoadedRuntime(loadedRuntime, fileName, successMessage) {
    assignRuntime(loadedRuntime);
    resetInitFlags();
    if (loadedRuntime?.normalizedPayload) {
      sysConfig.jsonData = loadedRuntime.normalizedPayload;
    } else {
      sysConfig.jsonData = sysConfig.jsonData || {};
    }
    rightSidebarCache?.invalidateRightSidebarSceneJsonTextCache?.();
    assetLibraryPanel?.render?.();
    trackDisposableResource(scene);
    windowResize();
    editorInteraction?.ensureTransformControls?.();
    editorInteraction?.initAfterSceneLoad?.();
    ensureRenderLoopStarted();
    finishEditorSceneLoad();
    editorInteraction?.refreshMeshList?.();
    updateSceneTitle(fileName);
    toggleStartupEmptyState(false);
    sceneReserialize?.markSceneDocumentSynced?.();
    editorDocumentState?.markDirty?.();
    editorSessionRecovery?.onDirty?.();
    const bootSnap =
      (await editorHistory?.captureSceneSnapshotAsync?.()) ||
      editorHistory?.captureSceneSnapshot?.();
    editorHistory?.resetForFullSceneLoad?.(bootSnap);
    await recentScenes?.saveCurrentScene?.(fileName);
    await editorSessionRecovery?.writeInitialAutoSnapshot?.();
    if (successMessage) {
      ui.showMessage(successMessage, "success");
    }
  }

  async function finishObjectImport({ loadedRuntime, fileName, fitView }) {
    if (loadedRuntime) {
      assignRuntime(loadedRuntime);
      resetInitFlags();
      trackDisposableResource(scene);
      windowResize();
    }
    sceneReserialize?.forceMarkSceneNeedsReserialize?.();
    host.markSceneDirty?.();
    rightSidebarCache?.invalidateRightSidebarSceneJsonTextCache?.();
    editorInteraction?.refreshMeshList?.();
    editorInteraction?.detachGizmo?.();
    selectedObj = null;
    editorInteraction?.ensureTransformControls?.();
    updateSceneTitle(fileName);
    toggleStartupEmptyState(false);
    if (renderLoop && typeof renderLoop.start === "function") {
      renderLoop.start();
    }
    await codeEditor?.refreshFromScene?.();
    if (fitView) {
      await fitViewToScene({ silent: true });
    }
    modelGroupPanel?.refreshBuiltinGroups?.();
    await recentScenes?.saveCurrentScene?.(currentSceneLabel);
    await editorSessionRecovery?.writeInitialAutoSnapshot?.();
  }

  function getEditorFitViewAspectHints() {
    return (
      editorThreeView?.getFitViewAspectHints?.() ?? {
        rendererDomElement: renderer?.domElement,
        threeViewActive: false,
        mainViewRect: null,
        canvasWrap
      }
    );
  }

  function applyFitViewToBounds(bounds, options = {}) {
    const silent = options.silent === true;
    const successMessage =
      typeof options.successMessage === "string"
        ? options.successMessage
        : "已根据当前网格自适应相机与缩放范围。";
    if (!bounds || bounds.isEmpty()) {
      if (!silent) {
        ui.showMessage("包围盒为空，无法进行自适应。", "warning");
      }
      return false;
    }
    const aspectHints = getEditorFitViewAspectHints();
    const viewport = aspectHints.threeViewActive && aspectHints.mainViewRect?.width > 2
      && aspectHints.mainViewRect?.height > 2
      ? aspectHints.mainViewRect
      : {
          width: canvasWrap?.clientWidth || renderer?.domElement?.clientWidth,
          height: canvasWrap?.clientHeight || renderer?.domElement?.clientHeight
        };
    if (camera && Number(viewport?.width) > 2 && Number(viewport?.height) > 2) {
      camera.aspect = Number(viewport.width) / Number(viewport.height);
      camera.updateProjectionMatrix?.();
    }
    const ok = fitPerspectiveCameraToContentBoundsTHREE(camera, controls, bounds, {
      aspectHints
    });
    if (!ok) {
      if (!silent) {
        ui.showMessage("包围盒为空，无法进行自适应。", "warning");
      }
      return false;
    }
    if (editorThreeView?.isEnabled?.()) {
      editorThreeView.updateThreeViewCameras?.();
    }
    if (!silent) {
      ui.showMessage(successMessage, "success");
    }
    return true;
  }

  async function fitViewToScene(options = {}) {
    if (!camera || !scene) {
      if (!options.silent) {
        ui.showMessage("场景尚未就绪。", "warning");
      }
      return false;
    }
    return suppressCanvasDirty.run(() => {
      editorThreeView?.updateViewRects?.();
      const ignoreHelper = editorInteraction?.getBoxEdgeHelper?.() ?? null;
      const bounds = buildAdaptiveContentBoundingBoxTHREE(scene, { ignoreHelper });
      if (!bounds) {
        if (!options.silent) {
          ui.showMessage("场景中缺少可用网格，无法进行自适应。", "warning");
        }
        return false;
      }
      return applyFitViewToBounds(bounds, { silent: options.silent === true });
    });
  }

  function fitViewToSelectionBounds(options = {}) {
    const silent = options.silent === true;
    if (!camera || !controls || !scene) {
      if (!silent) {
        ui.showMessage("场景尚未就绪，无法自适应。", "warning");
      }
      return false;
    }
    const targetObj =
      selectedObj ||
      (sceneTree?.getPropPanelThreeJsonId?.()
        ? getObjectByThreeJsonId(sceneTree.getPropPanelThreeJsonId())
        : null);
    if (!targetObj) {
      if (!silent) {
        ui.showMessage("请先选中对象，或指定 threeJsonId。", "warning");
      }
      return false;
    }
    return suppressCanvasDirty.run(() => {
      editorThreeView?.updateViewRects?.();
      const bounds = new THREE.Box3().setFromObject(targetObj);
      return applyFitViewToBounds(bounds, {
        silent,
        successMessage: "已根据选中对象自适应相机与缩放范围。"
      });
    });
  }

  async function exportSceneJsonToFile(silent = false) {
    if (!scene?.isScene) {
      ui.showMessage("当前没有已加载的场景。", "warning");
      return;
    }
    await ui.runWithLoadingMask("正在导出场景 JSON...", async () => {
      await sceneReserialize?.ensureCanvasSyncedBeforeExport?.();
      const text = JSON.stringify(
        sceneToStandardJsonSimple(scene, buildSceneToJsonOptions({ format: "standard", assertExportable: true })),
        null,
        editorSettings?.io?.exportJsonIndent ?? 2
      );
      const downloaded = await editorExportDownload.downloadJsonText(
        text,
        `sceneEditor-scene-${Date.now()}.json`,
        { title: "导出场景 JSON" }
      );
      if (!downloaded) {
        return;
      }
    });
    if (!silent) {
      ui.showMessage("ThreeJSON 场景已导出为本地 JSON 文件。", "success");
    }
    editorDomainExport?.warnIfAny?.();
  }

  async function exportStandardThreeJson(silent = false) {
    if (!scene?.isScene) {
      ui.showMessage("当前没有已加载的场景。", "warning");
      return;
    }
    try {
      let text = "";
      await ui.runWithLoadingMask("正在导出标准 ThreeJSON...", async () => {
        await sceneReserialize?.ensureCanvasSyncedBeforeExport?.();
        const standardPayload = await sceneToJson(scene, buildSceneToJsonOptions({ format: "standard" }));
        text = JSON.stringify(standardPayload, null, editorSettings?.io?.exportJsonIndent ?? 2);
      });
      const downloaded = await editorExportDownload.downloadJsonText(
        text,
        `sceneEditor-standard-threejson-${Date.now()}.json`,
        { title: "导出标准 ThreeJSON" }
      );
      if (!downloaded) {
        return;
      }
      if (!silent) {
        ui.showMessage("标准 ThreeJSON 已导出。", "success");
      }
      editorDomainExport?.warnIfAny?.();
    } catch (error) {
      console.error(error);
      ui.showMessage(`导出标准 ThreeJSON 失败：${error?.message || error}`, "error");
    }
  }

  async function exportFriendlyThreeJson(silent = false) {
    if (!scene?.isScene) {
      ui.showMessage("当前没有已加载的场景。", "warning");
      return;
    }
    try {
      let text = "";
      await ui.runWithLoadingMask("正在导出友好 ThreeJSON...", async () => {
        await sceneReserialize?.ensureCanvasSyncedBeforeExport?.();
        const base = resolveEditorMergeBase();
        const friendlyMap = resolveFriendlyMapFromPayload(base);
        const friendlyPayload = await sceneToFriendlyJson(
          scene,
          buildSceneToJsonOptions({ friendlyMap, format: "friendly" })
        );
        text = JSON.stringify(friendlyPayload, null, editorSettings?.io?.exportJsonIndent ?? 2);
      });
      const downloaded = await editorExportDownload.downloadJsonText(
        text,
        `sceneEditor-friendly-threejson-${Date.now()}.json`,
        { title: "导出友好 ThreeJSON" }
      );
      if (!downloaded) {
        return;
      }
      if (!silent) {
        ui.showMessage("友好 ThreeJSON 已导出。", "success");
      }
    } catch (error) {
      console.error(error);
      ui.showMessage(`导出友好 ThreeJSON 失败：${error?.message || error}`, "error");
    }
  }

  async function exportSceneJson(silent = false) {
    return exportSceneJsonToFile(silent);
  }

  async function exportThreeJsonWithSceneInfoList(silent = false) {
    if (!scene?.isScene) {
      ui.showMessage("当前没有已加载的场景。", "warning");
      return;
    }
    const shouldSkipObject = (obj) => sceneTree?.isRuntimeOnlyObject?.(obj) ?? false;
    try {
      let text = "";
      await ui.runWithLoadingMask("正在导出 ThreeJSON（含 nativeSceneList）...", async () => {
        const payload = await sceneToJson(scene, buildSceneToJsonOptions({ embedNative: false }));
        const { jsonString: sceneJsonString } = sceneToNativeJson(scene, {
          shouldSkipObject,
          sanitizeUserData: true,
          space: editorSettings?.io?.exportJsonIndent ?? 2
        });
        payload.worldInfo = payload.worldInfo || {};
        payload.worldInfo.nativeSceneList = [{ jsonData: sceneJsonString }];
        payload.saveMeta = {
          ...(payload.saveMeta || {}),
          exportMode: "worldinfo_primary_with_nativeSceneList",
          exportedAt: new Date().toISOString()
        };
        text = JSON.stringify(payload, null, editorSettings?.io?.exportJsonIndent ?? 2);
      });
      const downloaded = await editorExportDownload.downloadJsonText(
        text,
        `sceneEditor-scene-with-nativeSceneList-${Date.now()}.json`,
        { title: "导出 ThreeJSON（含 nativeSceneList）" }
      );
      if (!downloaded) {
        return;
      }
      if (!silent) {
        ui.showMessage("已导出 ThreeJSON（含 nativeSceneList）。", "success");
      }
      editorDomainExport?.warnIfAny?.();
    } catch (error) {
      console.error(error);
      ui.showMessage(`导出失败：${error?.message || error}`, "error");
    }
  }

  async function closeCurrentScene() {
    if (!hasRuntimeReady()) {
      toggleStartupEmptyState(true);
      closeAllDropdowns();
      return;
    }
    if (editorDocumentState?.isDirty?.()) {
      const choice = await editorDocumentState?.openTriChoiceModal?.({
        actionLabel: "关闭场景",
        saveLabel: "先保存再关闭",
        confirmLabel: "不保存关闭",
        cancelLabel: "取消",
        message:
          "当前场景有未保存的修改。关闭后将卸载当前场景（含 Code 模式中尚未应用到 3D 的修改）。\n请选择如何处理："
      });
      if (choice === "cancel") {
        closeAllDropdowns();
        return;
      }
      if (choice === "save") {
        await sceneDocumentOps?.persistUserSceneBaseline?.(true);
        editorDocumentState?.markSaved?.();
        await editorSessionRecovery?.flushRecoveryRecord?.({ dirty: false });
      } else if (choice === "overwrite") {
        editorDocumentState?.markSaved?.();
      }
    }
    editorDocumentState?.markSaved?.();
    editorSessionRecovery?.onSaved?.();
    ui.setLoading(false);
    openOrCloseProgressManager(false);
    sceneLoadGeneration += 1;
    teardownGraphics();
    resetInitFlags();
    sysConfig.jsonData = null;
    currentSceneLabel = "";
    scenePayloadFormat?.reset?.();
    rightSidebarCache?.invalidateRightSidebarSceneJsonTextCache?.();
    editorHistory?.clear?.();
    updateSceneTitle("");
    editorInteraction?.refreshMeshList?.();
    sceneTree?.clear?.();
    toggleStartupEmptyState(true);
    editorHistory?.syncMenuState?.();
    await editorSessionRecovery?.clearAutoSnapshotOnClose?.();
    closeAllDropdowns();
    ui.showMessage("已关闭当前场景。", "info");
  }

  async function handleLocalSceneJsonFile(file, options = {}) {
    if (!file) {
      return;
    }
    if (!options.skipDirtyConfirm) {
      const ok = await editorDocumentState?.confirmOverwriteIfDirty?.({
        actionLabel: `导入「${file.name}」`
      });
      if (!ok) {
        return;
      }
    }
    openOrCloseProgressManager(sysConfig.progressFlag);
    ui.setLoadingMessage("正在读取本地场景...");
    try {
      const text = await file.text();
      let probe = null;
      try {
        probe = JSON.parse(text);
      } catch {
        probe = null;
      }
      if (probe && isSingleObjectJsonImport(probe)) {
        await importSingleObjectRecordJson(probe, file.name);
        ui.showMessage(`已导入对象 ${file.name}`, "success");
        return;
      }
      if (probe && isThreeJsObjectExportJson(probe)) {
        const loaded = await ingestScenePayload(probe, file.name);
        if (!loaded) {
          ui.showMessage("已取消导入。", "info");
          return;
        }
        ui.showMessage(`已识别为 Three.js 原生 JSON 并导入 ${file.name}`, "success");
        return;
      }
      const parsed = parseSceneJsonString(text);
      const loaded = await ingestScenePayload(parsed, file.name);
      if (!loaded) {
        ui.showMessage("已取消导入。", "info");
        return;
      }
      ui.showMessage(`已导入 ${file.name}`, "success");
    } catch (error) {
      openOrCloseProgressManager(false);
      ui.showMessage(String(error?.message || error), "error");
      console.error(error);
    }
  }

  async function importSingleObjectRecordJson(parsed, fileName) {
    const hasScene = hasRuntimeReady();
    if (!hasScene) {
      const objectFlags = resolveEditorRuntimeFlagsSync(editorSettings, "objectRecord", parsed, null);
      await ui.runWithLoadingMask("正在导入对象 JSON...", async () => {
        const loadedRuntime = await createJsonSceneFromObjectRecord(
          parsed,
          buildCreateJsonSceneOptions(objectFlags, {
            missingAssetPolicy: "warn",
            onWarning: (msg) => console.warn("[object-json-import]", msg)
          })
        );
        if (objectFlags.autoFillLights !== false) {
          ensureDefaultSceneLights(loadedRuntime?.scene, true);
        }
        sysConfig.jsonData = sysConfig.jsonData || {};
        await applyLoadedRuntime(loadedRuntime, fileName);
        await finishObjectImport({ fileName, fitView: true });
      });
      return;
    }
    const pick = await modalUi.openObjectImportModeModal();
    if (!pick?.mode) {
      ui.showMessage("已取消导入。", "info");
      return;
    }
    const objectFlags = resolveEditorRuntimeFlagsSync(editorSettings, "objectRecord", parsed, pick);
    const historyBefore = editorHistory?.captureSceneSnapshot?.();
    await ui.runWithLoadingMask("正在导入对象 JSON...", async () => {
      const loadedRuntime = await deployObjectRecordIntoRuntime(sceneRuntime || scene, parsed, {
        objectEntryMode: pick.mode === "append" ? "append" : "replace",
        missingAssetPolicy: "warn",
        onWarning: (msg) => console.warn("[object-json-import]", msg),
        ...objectFlags
      });
      if (objectFlags.autoFillLights !== false) {
        ensureDefaultSceneLights(loadedRuntime?.scene, true);
      }
      await finishObjectImport({ loadedRuntime, fileName, fitView: pick.fitView });
      if (historyBefore) {
        editorHistory?.pushCapturedSceneSnapshot?.(historyBefore, fileName || "导入对象");
      }
    });
  }

  async function handleLocalMeshModelFile(file) {
    let importPayload;
    try {
      inferMeshImportFormatFromFileName(file.name);
      importPayload = await importMeshBlob(file, { fileName: file.name });
    } catch (error) {
      ui.showMessage(String(error?.message || error), "error");
      return;
    }
    const { record } = importPayload;
    const hasScene = hasRuntimeReady();
    if (!hasScene) {
      const objectFlags = resolveEditorRuntimeFlagsSync(editorSettings, "objectRecord", record, null);
      await ui.runWithLoadingMask("正在导入 3D 模型...", async () => {
        const loadedRuntime = await createJsonSceneFromObjectRecord(
          record,
          buildCreateJsonSceneOptions(objectFlags, {
            missingAssetPolicy: "warn",
            onWarning: (msg) => console.warn("[mesh-import]", msg)
          })
        );
        if (objectFlags.autoFillLights !== false) {
          ensureDefaultSceneLights(loadedRuntime?.scene, true);
        }
        await applyLoadedRuntime(loadedRuntime, file.name);
        await finishObjectImport({ fileName: file.name, fitView: true });
      });
      ui.showMessage(`已导入 3D 模型 ${file.name}`, "success");
      return;
    }
    const pick = await modalUi.openObjectImportModeModal();
    if (!pick?.mode) {
      ui.showMessage("已取消导入。", "info");
      return;
    }
    const objectFlags = resolveEditorRuntimeFlagsSync(editorSettings, "objectRecord", record, pick);
    const historyBefore = editorHistory?.captureSceneSnapshot?.();
    await ui.runWithLoadingMask("正在导入 3D 模型...", async () => {
      const loadedRuntime = await deployObjectRecordIntoRuntime(sceneRuntime || scene, record, {
        objectEntryMode: pick.mode === "append" ? "append" : "replace",
        missingAssetPolicy: "warn",
        onWarning: (msg) => console.warn("[mesh-import]", msg),
        ...objectFlags
      });
      if (objectFlags.autoFillLights !== false) {
        ensureDefaultSceneLights(loadedRuntime?.scene, true);
      }
      await finishObjectImport({ loadedRuntime, fileName: file.name, fitView: pick.fitView });
      if (historyBefore) {
        editorHistory?.pushCapturedSceneSnapshot?.(historyBefore, file.name || "导入 3D 模型");
      }
    });
    ui.showMessage(`已导入 3D 模型 ${file.name}`, "success");
  }

  async function handleLocalTjzArchiveFile(file, options = {}) {
    if (!file) {
      return;
    }
    if (!options.skipDirtyConfirm) {
      const importOk = await editorDocumentState?.confirmOverwriteIfDirty?.({
        actionLabel: `导入「${file.name}」`
      });
      if (!importOk) {
        return;
      }
    }
    await suppressCanvasDirty.runAsync(async () => {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const inspection = await inspectJsonSceneArchiveEntry(bytes);
        const entryKind = inspection?.entryKind || "unknown";
        const archivePreviewPayload = inspection?.payload ?? null;
        const hasScene = hasRuntimeReady();

      if (!hasScene) {
        if (entryKind !== "object" && archivePreviewPayload) {
          scenePayloadFormat?.recordEditorScenePayloadViewFormat?.(archivePreviewPayload, file.name);
        }
        const flags =
          entryKind === "object"
            ? resolveEditorRuntimeFlagsSync(editorSettings, "objectRecord", archivePreviewPayload, null)
            : (await resolveEditorRuntimeFlags(editorSettings, "fullScene", archivePreviewPayload || {}, null, modalUi)) ||
              resolveEditorRuntimeFlagsSync(editorSettings, "fullScene", {});
        if (!flags) {
          return;
        }
        await ui.runWithLoadingMask("正在导入 .tjz 包...", async () => {
          const loadedRuntime = await createJsonSceneFromArchive(bytes, buildCreateJsonSceneOptions(flags, {
            missingAssetPolicy: "warn",
            onWarning: (msg) => console.warn("[tjz-import]", msg)
          }));
          if (entryKind === "object" && flags.autoFillLights !== false) {
            ensureDefaultSceneLights(loadedRuntime?.scene, true);
          }
          await applyLoadedRuntime(loadedRuntime, file.name);
          await finishObjectImport({ fileName: file.name, fitView: entryKind === "object" });
        });
        ui.showMessage(`已导入 ${file.name}`, "success");
        return;
      }

        if (entryKind === "scene" || entryKind === "unknown") {
          if (archivePreviewPayload) {
            scenePayloadFormat?.recordEditorScenePayloadViewFormat?.(archivePreviewPayload, file.name);
          }
          const flags =
            (await resolveEditorRuntimeFlags(editorSettings, "fullScene", archivePreviewPayload || {}, null, modalUi)) ||
            resolveEditorRuntimeFlagsSync(editorSettings, "fullScene", {});
          if (!flags) {
            return;
          }
          await ui.runWithLoadingMask("正在导入 .tjz 包...", async () => {
            if (viewPreserve?.isEditorViewPreserveEnabled?.() && camera && controls) {
              viewPreserve.captureEditorViewToSession();
            }
            teardownGraphics();
            resetInitFlags();
            const loadedRuntime = await createJsonSceneFromArchive(
              bytes,
              buildCreateJsonSceneOptions(flags, {
                missingAssetPolicy: "warn",
                onWarning: (msg) => console.warn("[tjz-import]", msg)
              })
            );
            await applyLoadedRuntime(loadedRuntime, file.name);
            viewPreserve?.bindEditorViewPreserveListeners?.();
            if (viewPreserve?.isEditorViewPreserveEnabled?.()) {
              viewPreserve.applyPreservedEditorView();
            } else {
              await fitViewToScene({ silent: true });
            }
          });
          ui.showMessage(`已导入 ${file.name}`, "success");
          return;
        }

        const pick = await modalUi.openObjectImportModeModal();
        if (!pick?.mode) {
          ui.showMessage("已取消导入。", "info");
          return;
        }
        const objectFlags = resolveEditorRuntimeFlagsSync(editorSettings, "objectRecord", archivePreviewPayload, pick);
        const historyBefore = editorHistory?.captureSceneSnapshot?.();
        await ui.runWithLoadingMask("正在导入 .tjz 包...", async () => {
          const loadedRuntime = await deployJsonSceneFromArchive(sceneRuntime || scene, bytes, {
            objectEntryMode: pick.mode === "append" ? "append" : "replace",
            missingAssetPolicy: "warn",
            onWarning: (msg) => console.warn("[tjz-import]", msg),
            ...objectFlags
          });
          if (objectFlags.autoFillLights !== false) {
            ensureDefaultSceneLights(loadedRuntime?.scene, true);
          }
          await finishObjectImport({ loadedRuntime, fileName: file.name, fitView: pick.fitView });
          if (historyBefore) {
            editorHistory?.pushCapturedSceneSnapshot?.(historyBefore, file.name || "导入对象");
          }
        });
        ui.showMessage(`已导入 ${file.name}`, "success");
      } catch (err) {
        ui.setLoading(false);
        openOrCloseProgressManager(false);
        ui.showMessage(String(err?.message || err), "error");
        console.error(err);
      }
    });
  }

  async function handleTopBarOpenFile(file) {
    if (!file) {
      return;
    }
    const ok = await editorDocumentState?.confirmOverwriteIfDirty?.({
      actionLabel: `打开「${file.name}」`
    });
    if (!ok) {
      return;
    }
    const ext = readFileExtension(file.name);
    const importOptions = { skipDirtyConfirm: true };
    if (ext === ".tjz") {
      await handleLocalTjzArchiveFile(file, importOptions);
      return;
    }
    if (ext === ".json" || ext === ".threejson" || ext === ".tjson") {
      await handleLocalSceneJsonFile(file, importOptions);
      return;
    }
    if (ext) {
      ui.showMessage(`不支持的文件扩展名：${ext}`, "warning");
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (isLikelyBinaryBuffer(bytes)) {
      await handleLocalTjzArchiveFile(file, importOptions);
      return;
    }
    const text = new TextDecoder("utf-8").decode(bytes);
    let probe = null;
    try {
      probe = JSON.parse(text);
    } catch {
      probe = parseSceneJsonString(text);
    }
    if (isSingleObjectJsonImport(probe)) {
      await importSingleObjectRecordJson(probe, file.name);
      ui.showMessage(`已导入对象 ${file.name}`, "success");
      return;
    }
    const wasNative = isThreeJsObjectExportJson(probe);
    const parsed = wasNative ? probe : parseSceneJsonString(text);
    const loaded = await ingestScenePayload(parsed, file.name);
    if (!loaded) {
      ui.showMessage("已取消导入。", "info");
      return;
    }
    if (wasNative) {
      ui.showMessage(`已识别为 Three.js 原生 JSON 并导入 ${file.name}`, "success");
    } else {
      ui.showMessage(`已导入 ${file.name}`, "success");
    }
  }

  function wireFileInput(input, handler) {
    input?.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (file) {
        void handler(file);
      }
    });
  }

  function closeAllDropdowns() {
    document.querySelectorAll("details.topMenu[open]").forEach((el) => {
      el.open = false;
      delete el.dataset.hoverOpen;
    });
    document.querySelectorAll(".topMenuNestedWrap[data-submenu-open]").forEach((el) => {
      delete el.dataset.submenuOpen;
      delete el.dataset.submenuPinned;
    });
  }
  host.closeAllDropdowns = closeAllDropdowns;

  function applyEditorSettingsLayoutCss() {
    const layout = editorSettings?.layout;
    if (!layout || !rootContainer) {
      return;
    }
    if (Number.isFinite(layout.leftDockWidthPx)) {
      rootContainer.style.setProperty("--leftDockWidth", `${layout.leftDockWidthPx}px`);
    }
    if (Number.isFinite(layout.rightDockWidthPx)) {
      rootContainer.style.setProperty("--rightDockWidth", `${layout.rightDockWidthPx}px`);
    }
    if (Number.isFinite(layout.peekStripWidthPx)) {
      rootContainer.style.setProperty("--peekStripWidth", `${layout.peekStripWidthPx}px`);
    }
  }

  let lastAppliedHostLocale = null;

  async function applyHostLocaleFromSettings() {
    const locale = await initHostI18n(editorSettings?.general?.locale);
    applyShellI18n(document);
    const loadingMaskMessage = document.getElementById("loadingMaskMessage");
    if (loadingMaskMessage) {
      loadingMaskMessage.textContent = getLoadingMaskDefaultText(editorSettings);
    }
    updateSceneTitle(currentSceneLabel);
    editorDocumentState?.syncDocumentTitle?.();
    if (locale !== lastAppliedHostLocale) {
      lastAppliedHostLocale = locale;
      settingsModal?.refreshForLocale?.(editorSettings);
      modelGroupPanel?.refreshBuiltinGroups?.();
    }
  }

  function applyEditorSettings(options = {}) {
    const initial = options.initial === true;
    applyEditorSettingsToSysConfig(sysConfig, editorSettings);
    settingsRef.current = editorSettings;
    applyEditorSettingsLayoutCss();
    editorViewChrome?.syncFromSettings?.();
    editorChromeUi?.applyStatusBarHintFromSettings?.(editorSettings);
    editorHistory?.applySettingsFromEditor?.(editorSettings);
    aiSidebar?.applySettingsFromEditor?.();
    codeEditor?.syncCodeModeCheckboxesFromSettings?.();
    editorCapture?.applyCaptureDefaultsFromSettings?.();
    editorInteraction?.syncDragControlsFromSettings?.();
    gridHelper?.syncEditorGridHelperFromSettings?.();
    editorChromeUi?.syncBottomBarHelperToggles?.();
    syncViewportGizmoFromSettings();
    editorInteraction?.refreshBoxEdgeColor?.();
    editorTjzExportModal?.applyDefaultsFromSettings?.();
    editorSessionRecovery?.restartAutoSnapshotTimer?.();
    windowResize();
    configureLogger({ debug: Boolean(editorSettings?.general?.debugLogging) });
    if (!initial && typeof openOrCloseProgressManager === "function") {
      openOrCloseProgressManager(sysConfig.progressFlag);
    }
    if (!initial && scene?.isScene) {
      rightSidebarCache?.invalidateRightSidebarSceneJsonTextCache?.();
      void codeEditor?.refreshFromScene?.();
      sceneManagePanel?.bindFromPayload?.();
    }
    editorDocumentState?.syncDocumentTitle?.();
    void applyHostLocaleFromSettings();
  }

  const settingsModal = createSettingsModalController({
    onSave(draft) {
      editorSettings = deepMergeEditorSettings(editorSettingsFileDefaults, draft);
      persistEditorSettings(editorSettings);
      applyEditorSettings();
      ui.showMessage(t("editor.message.settingsSaved", "Settings saved and applied."), "success");
    },
    async onReset() {
      editorSettingsFileDefaults = await fetchEditorSettingsFileDefaults();
      editorSettings = cloneEditorSettings(editorSettingsFileDefaults);
      clearEditorSettingsCache();
      applyEditorSettings({ initial: true });
      settingsModal.populateForm(editorSettings);
      ui.showMessage(t("editor.message.settingsResetToFile", "Restored setting.json defaults."), "info");
    }
  });

  function wireMenus() {
    initTopMenubarExclusiveOpen(document, closeAllDropdowns);
    document.getElementById("menuOpenScene")?.addEventListener("click", () => {
      fileInputs.topBarOpen?.click();
      closeAllDropdowns();
    });
    document.getElementById("topBarBtnOpenScene")?.addEventListener("click", () => {
      fileInputs.topBarOpen?.click();
    });
    document.getElementById("emptyStateOpenBtn")?.addEventListener("click", () => {
      fileInputs.topBarOpen?.click();
    });
    document.getElementById("emptyStateOpenDefaultBtn")?.addEventListener("click", () => {
      void loadSceneFromUrl(getDefaultSceneJsonUrl(editorSettings), "示例场景");
    });
    document.getElementById("menuLoadSceneJson")?.addEventListener("click", () => {
      fileInputs.sceneJson?.click();
      closeAllDropdowns();
    });
    document.getElementById("menuLoadNativeThreeJson")?.addEventListener("click", () => {
      fileInputs.nativeThree?.click();
      closeAllDropdowns();
    });
    document.getElementById("menuLoadTjzArchive")?.addEventListener("click", () => {
      fileInputs.tjz?.click();
      closeAllDropdowns();
    });
    document.getElementById("menuImportMeshModel")?.addEventListener("click", () => {
      fileInputs.mesh?.click();
      closeAllDropdowns();
    });
    document.getElementById("menuSaveScene")?.addEventListener("click", () => {
      void sceneDocumentOps?.saveCurrentSceneDocument?.();
      closeAllDropdowns();
    });
    document.getElementById("menuToggleThreeView")?.addEventListener("click", () => {
      editorThreeView?.switchView?.();
      closeAllDropdowns();
    });
    document.getElementById("menuExportThreeJSON")?.addEventListener("click", () => {
      void exportSceneJsonToFile();
      closeAllDropdowns();
    });
    document.getElementById("menuExportStandardThreeJSON")?.addEventListener("click", () => {
      void exportStandardThreeJson();
      closeAllDropdowns();
    });
    document.getElementById("menuExportThreeJSONWithSceneInfoList")?.addEventListener("click", () => {
      void exportThreeJsonWithSceneInfoList();
      closeAllDropdowns();
    });
    document.getElementById("menuExportFriendlyThreeJSON")?.addEventListener("click", () => {
      void exportFriendlyThreeJson();
      closeAllDropdowns();
    });
    document.getElementById("menuExportNativeThreeJson")?.addEventListener("click", () => {
      void exportNativeSceneJson(host);
      closeAllDropdowns();
    });
    document.getElementById("menuFitView")?.addEventListener("click", () => {
      void fitViewToScene();
      closeAllDropdowns();
    });
    document.getElementById("topBarBtnResetView")?.addEventListener("click", () => {
      void fitViewToScene();
    });
    document.getElementById("menuRunScene")?.addEventListener("click", () => {
      void runScenePreview?.runScene?.();
      closeAllDropdowns();
    });
    document.getElementById("topBarBtnRunScene")?.addEventListener("click", () => {
      void runScenePreview?.runScene?.();
    });
    document.getElementById("menuOpenEditorSettings")?.addEventListener("click", () => {
      settingsModal.open(editorSettings);
      closeAllDropdowns();
    });
    document.getElementById("menuClearViewChromeCache")?.addEventListener("click", async () => {
      clearEditorSettingsCache();
      editorSettingsFileDefaults = await fetchEditorSettingsFileDefaults();
      editorSettings = cloneEditorSettings(editorSettingsFileDefaults);
      settingsRef.current = editorSettings;
      applyEditorSettings();
      editorViewChrome?.resetPeekState?.();
      editorViewChrome?.syncFromSettings?.();
      editorViewChrome?.syncDockPeekClasses?.({ persist: false });
      windowResize();
      requestAnimationFrame(() => requestAnimationFrame(windowResize));
      ui.showMessage(t("editor.message.settingsCacheCleared", "Editor settings cache cleared and defaults restored."), "info");
      closeAllDropdowns();
    });
    document.getElementById("fullscreenBtn")?.addEventListener("click", () => {
      void editorChromeUi?.toggleFullscreen?.();
    });
    document.getElementById("menuFullscreenToggle")?.addEventListener("click", () => {
      void editorChromeUi?.toggleFullscreen?.();
      closeAllDropdowns();
    });

    document.getElementById("menuMuteAudio")?.addEventListener("click", () => {
      editorChromeUi?.toggleEditorSceneAudioMute?.();
      closeAllDropdowns();
    });
    document.getElementById("topBarBtnMuteAudio")?.addEventListener("click", () => {
      editorChromeUi?.toggleEditorSceneAudioMute?.();
    });
    document.getElementById("menuCloseScene")?.addEventListener("click", () => {
      void closeCurrentScene();
    });
    document.getElementById("menuSaveSceneAsCopy")?.addEventListener("click", () => {
      void sceneDocumentOps?.saveSceneAsCopy();
      closeAllDropdowns();
    });
    document.getElementById("menuSaveScenePreset")?.addEventListener("click", () => {
      void sceneDocumentOps?.saveScenePreset();
      closeAllDropdowns();
    });
    document.getElementById("menuSaveCurrentView")?.addEventListener("click", () => {
      if (!camera || !controls || !sysConfig.jsonData) {
        ui.showMessage("场景尚未就绪，无法保存视角。", "warning");
        closeAllDropdowns();
        return;
      }
      sysConfig.jsonData = injectCurrentCameraIntoScenePayload(sysConfig.jsonData, camera, controls);
      sceneReserialize?.markSceneNeedsReserialize?.();
      host.markSceneDirty();
      sceneManagePanel?.bindFromPayload();
      void codeEditor?.refreshFromScene();
      ui.showMessage("已将当前视角写入场景 JSON。", "success");
      closeAllDropdowns();
    });
    document.getElementById("menuRecentScenesMore")?.addEventListener("click", () => {
      recentScenes?.openModal();
      closeAllDropdowns();
    });
    document.getElementById("menuRecentScenesClear")?.addEventListener("click", () => {
      void recentScenes?.clearHistory();
      closeAllDropdowns();
    });
    document.getElementById("menuNewBlankOrbit")?.addEventListener("click", () => {
      void presetScenePanel?.openPresetById?.(BLANK_SCENE_PRESET_ID);
      closeAllDropdowns();
    });
    document.getElementById("menuUndo")?.addEventListener("click", () => {
      void editorHistory?.undo();
      closeAllDropdowns();
    });
    document.getElementById("menuRedo")?.addEventListener("click", () => {
      void editorHistory?.redo();
      closeAllDropdowns();
    });
    document.getElementById("menuReset")?.addEventListener("click", () => {
      void editorHistory?.resetToBootstrap();
      closeAllDropdowns();
    });
    document.getElementById("menuExitEditor")?.addEventListener("click", () => {
      void onMenuExitEditor();
      closeAllDropdowns();
    });
    editorCacheClear?.wireMenu?.();
  }

  async function onMenuExitEditor() {
    const isDirty = editorDocumentState?.isDirty?.() ?? false;
    const exitUrl =
      editorSettings?.general?.exitNavigateUrl || EDITOR_SETTINGS_DEFAULTS.general.exitNavigateUrl;

    async function exitNavigateAway() {
      teardownGraphics();
      editorSessionRecovery?.setSuppressBeforeUnload?.(true);
      window.location.href = exitUrl;
    }

    if (!isDirty) {
      await editorSessionRecovery?.flushRecoveryRecord?.({ dirty: false });
      if (editorSettings?.session?.clearCacheOnExit) {
        await editorCacheClear?.clearByScope?.(
          editorSettings?.session?.clearCacheOnExitScopes || {}
        );
      }
      await exitNavigateAway();
      return;
    }

    const choice = await editorDocumentState?.openTriChoiceModal?.({
      actionLabel: "退出编辑器",
      saveLabel: "先保存再退出",
      confirmLabel: "直接退出",
      cancelLabel: "取消"
    });
    if (choice === "cancel") {
      return;
    }
    if (choice === "save") {
      await sceneDocumentOps?.persistUserSceneBaseline?.(true);
    } else if (choice === "overwrite") {
      editorDocumentState?.markSaved?.();
    }
    await editorSessionRecovery?.flushRecoveryRecord?.({ dirty: choice === "overwrite" });
    if (editorSettings?.session?.clearCacheOnExit) {
      await editorCacheClear?.clearByScope?.(
        editorSettings?.session?.clearCacheOnExitScopes || {}
      );
    }
    await exitNavigateAway();
  }

  wireFileInput(fileInputs.topBarOpen, handleTopBarOpenFile);
  wireFileInput(fileInputs.sceneJson, handleLocalSceneJsonFile);
  wireFileInput(fileInputs.nativeThree, async (file) => {
    const ok = await editorDocumentState?.confirmOverwriteIfDirty?.({
      actionLabel: `导入「${file.name}」`
    });
    if (!ok) {
      return;
    }
    openOrCloseProgressManager(sysConfig.progressFlag);
    ui.setLoadingMessage("正在读取本地原生 JSON...");
    ui.setLoading(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const loaded = await ingestScenePayload(parsed, file.name);
      if (!loaded) {
        ui.showMessage("已取消导入。", "info");
        return;
      }
      ui.showMessage(`已按原生 JSON 导入 ${file.name}`, "success");
    } catch (error) {
      ui.setLoading(false);
      openOrCloseProgressManager(false);
      ui.showMessage(String(error?.message || error), "error");
      console.error(error);
    }
  });
  wireFileInput(fileInputs.tjz, handleLocalTjzArchiveFile);
  wireFileInput(fileInputs.mesh, handleLocalMeshModelFile);

  const bundle = await loadEditorSettingsBundle();
  editorSettingsFileDefaults = bundle.fileDefaults;
  editorSettings = bundle.settings;
  settingsRef.current = editorSettings;
  applyEditorSettings({ initial: true });

  bindProgressElement(document.getElementById("loadingMaskMessage") || document.getElementById("loadingMask"));
  openOrCloseProgressManager(sysConfig.progressFlag);
  editorDocumentState = createEditorDocumentState(host);
  editorThreeView = createEditorThreeView(host);
  sceneTree = createSceneTreePanel(host);
  commandLayer = createCommandLayer(host);
  commandLayer.ensure();
  aiSidebar = createAiSidebar(host);
  editorInteraction = createEditorInteraction(host);
  sceneReserialize = createEditorSceneReserialize(host);
  gridHelper = createEditorGridHelper(host);
  viewPreserve = createEditorViewPreserve(host);
  scenePayloadFormat = createEditorScenePayloadFormat(host);
  rightSidebarCache = createEditorRightSidebarCache(host);
  editorHistory = createEditorHistory(host);
  editorHistory.applySettingsFromEditor?.(editorSettings);
  sceneManagePanel = createSceneManagePanel(host);
  eventEditorPanel = createEventEditorPanel(host);
  assetLibraryPanel = createAssetLibraryPanel(host);
  rightDockPanel = createRightDockPanel(host);
  runScenePreview = createRunScenePreviewController(host);
  recentScenes = createRecentScenesController(host);
  sceneNameModals = createEditorSceneNameModals(host);
  sceneDocumentOps = createSceneDocumentOps(host);
  editorSessionRecovery = createEditorSessionRecovery(host);
  editorCacheClear = createEditorCacheClear(host);
  editorDomainExport = createEditorDomainExport(host);
  editorDomainDrillIn = createEditorDomainDrillIn(host);
  editorMeshExportModal = createEditorMeshExportModal(host);
  editorExportDownload = createEditorExportDownload(host);
  editorTjzExportModal = createEditorTjzExportModal(host);
  editorTemplateExportModal = createEditorTemplateExportModal(host);
  editorCapture = createEditorCapture(host);
  editorHelpAndSceneJson = createEditorHelpAndSceneJson(host);
  editorViewChrome = createEditorViewChrome(host);
  editorChromeUi = createEditorChromeUi(host);
  sceneTreeContextMenu = createSceneTreeContextMenu(host);
  modelGroupPanel = createModelGroupPanel(host);
  presetScenePanel = createPresetScenePanel(host);
  codeEditor = createCodeEditorMode(host);
  modelGroupPanel.init();
  await recentScenes.loadFromStorage();
  await presetScenePanel.init();
  codeEditor.init();
  aiSidebar.init();
  aiSidebar.applySettingsFromEditor();
  editorDomainDrillIn.init();
  editorMeshExportModal.init();
  editorTjzExportModal.init();
  editorTemplateExportModal.init();
  editorCapture.init();
  editorHelpAndSceneJson.init();
  editorViewChrome.init();
  editorChromeUi.init();
  sceneTreeContextMenu.init();
  bindEditorKeyboardShortcuts(host);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.fullscreenElement) {
      void document.exitFullscreen();
    }
  });
  wireMenus();
  window.addEventListener("resize", windowResize);
  primeCanvasLayout();
  editorSessionRecovery.bindLifecycle();
  await editorSessionRecovery.bootstrapFromRecovery();
  await loadSceneFromExternalBridgeIfRequested();
  editorSessionRecovery.startAutoSnapshotTimer();

  async function loadSceneFromExternalBridgeIfRequested() {
    const pageParams = new URLSearchParams(window.location.search);
    const sceneKey = pageParams.get("sceneKey");
    const openFromSource = pageParams.get("openFrom");
    if (!sceneKey || !["shower", "threebox"].includes(openFromSource)) {
      return false;
    }
    const storageKey = `${EDITOR_OPEN_SCENE_BRIDGE_PREFIX}${sceneKey}`;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        ui.showMessage("未找到外部传入的场景 JSON。", "error");
        return false;
      }
      const record = JSON.parse(raw);
      localStorage.removeItem(storageKey);
      const sceneJson = record?.sceneJson;
      if (!sceneJson || typeof sceneJson !== "object") {
        throw new Error("外部传入的场景 JSON 无效。");
      }
      const sourceLabel = openFromSource === "threebox" ? "ThreeBox" : "Shower";
      const loaded = await ingestScenePayload(sceneJson, record?.label || sourceLabel);
      if (loaded) {
        editorDocumentState?.markSaved?.();
        editorDocumentState?.syncDocumentTitle?.();
        ui.showMessage(`已从 ${sourceLabel} 打开场景。`, "success");
      }
      return loaded;
    } catch (error) {
      ui.showMessage(`从外部打开场景失败：${error?.message || error}`, "error");
      console.error(error);
      return false;
    }
  }

  function getSceneJsonString() {
    if (!scene?.isScene) {
      throw new Error("场景尚未初始化。");
    }
    const shouldSkipObject = (obj) => sceneTree?.isRuntimeOnlyObject?.(obj) ?? false;
    const indent = editorSettings?.io?.exportJsonIndent ?? 2;
    const { jsonString: sceneJsonString } = sceneToNativeJson(scene, {
      shouldSkipObject,
      sanitizeUserData: true,
      space: indent
    });
    const payload = buildRoomSavePayload(sysConfig.jsonData, sceneJsonString);
    payload.saveMeta = {
      ...(payload.saveMeta || {}),
      exportMode: "scene_tojson",
      exportedAt: new Date().toISOString()
    };
    return JSON.stringify(payload, null, indent);
  }

  async function runEditorCommands(input, options = {}) {
    return commandLayer.runBatch(input, options);
  }

  function wasteCleaner() {
    codeEditor?.cancelAutoRenderTimer?.();
    teardownGraphics();
  }

  window.sceneEditor = {
    scene: () => scene,
    camera: () => camera,
    renderer: () => renderer,
    controls: () => controls,
    sysConfig,
    getSceneJsonString,
    ensureCanvasSyncedBeforeExport: () =>
      sceneReserialize?.ensureCanvasSyncedBeforeExport?.(),
    getScenePayloadJsonTextForPersistViewEdit: (captureOptions = {}) =>
      editorHelpAndSceneJson?.captureSceneJsonTextForView?.(captureOptions),
    persistUserSceneBaseline: (silent) => sceneDocumentOps?.persistUserSceneBaseline?.(silent),
    exportSceneJsonToFile,
    exportThreeJsonWithSceneInfoList,
    openSceneJsonModal: () => editorHelpAndSceneJson?.openSceneJsonModal?.(),
    switchTransMode: (mode, silent) => editorInteraction?.switchTransMode?.(mode, silent),
    addBaseModel: (entry) => modelGroupPanel?.addBaseModel?.(entry),
    wasteCleaner,
    fitViewToEditableSceneBounds: (options) => fitViewToScene(options),
    fitViewToSelectionBounds,
    ingestScenePayloadFromParsedJson: ingestScenePayload,
    teardownEditorGraphicsForReload: teardownGraphics,
    reloadSceneJsonFromDisk: handleLocalSceneJsonFile,
    rebuildEditorFromWorldData: ingestScenePayload,
    reloadWorldDataPayload: ingestScenePayload,
    runEditorCommands,
    getEditorCommandApi: () => commandLayer.getApi(),
    getEditorCommandRegistry: () => commandLayer.getRegistry()
  };
  window.roomedit = window.sceneEditor;

  ui.showMessage(t("editor.message.ready", "Scene editor is ready."), "info");
}

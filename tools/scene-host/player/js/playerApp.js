import {
  bindProgressElement,
  bindThreeJsonSceneAudioUnlock,
  buildAdaptiveContentBoundingBoxTHREE,
  buildMinimalWorldJsonForNativeThreeInline,
  cancelActiveDeployScheduler,
  createJsonScene,
  createJsonSceneFromArchive,
  disposeTrackedResources,
  ensureThreeJsonIdsOnScenePayload,
  ensureThreeJsonAudioListener,
  fitPerspectiveCameraToContentBoundsTHREE,
  isThreeJsObjectExportJson,
  openOrCloseProgressManager,
  resolveScenePayloadForLoad,
  resumeThreeJsonAudioContextFromCamera,
  setThreeJsonSceneAudioPaused,
  setThreeJsonSceneAudioPlaybackPolicy,
  showProgressMessage,
  teardownThreeJsonSceneAudioFromRuntime,
  trackDisposableResource
} from "threejson";
import { isLoadableScenePayload } from "../../../../core/handler/sceneFriendlyNormalizer.js";
import { buildEditorScenePayload } from "../../shared/js/buildEditorRuntimeConfig.js";
import { createEditorSysConfig } from "../../shared/js/createEditorSysConfig.js";
import {
  fetchPlayerSettingsFileDefaults,
  getDefaultSceneUrl,
  getPlayerLoadingMaskText,
  getPlayerMessageToastDurationMs,
  getPlayerSceneLoadDoneDelayMs,
  loadPlayerSettingsBundle,
  persistPlayerSettings,
  clearPlayerSettingsCache,
  PLAYER_SETTINGS_DEFAULTS
} from "../../shared/js/playerSettingsStore.js";
import { initHostI18n, applyShellI18n, t } from "../../shared/i18n/index.js";
import { createPlayerSettingsModal } from "./playerSettingsModal.js";
import { wirePlayerTopMenu } from "./playerTopMenu.js";
import {
  createPlayerHighlightController,
  getPlayerHighlightChannelOptions
} from "./playerHighlight.js";
import { createPlayerImmersiveChrome } from "./playerImmersiveChrome.js";
import { createPlayerSceneInteraction } from "./playerSceneInteraction.js";
import { createPlayerEditorPreviewBridge } from "./playerEditorPreviewBridge.js";
import {
  playerPlaylistIdbClear,
  playerPlaylistIdbDelete,
  playerPlaylistIdbGet,
  playerPlaylistIdbPut
} from "./playerPlaylistIdb.js";

const LS_PLAYLIST_MANIFEST_KEY = "threejson.scenePlayer.playlistManifest";
const LS_PLAYLIST_CURRENT_ID_KEY = "threejson.scenePlayer.currentPlaylistId";

function fileNameFromUrl(url = "") {
  try {
    const path = new URL(url, window.location.origin).pathname;
    const base = path.split("/").pop() || "";
    return decodeURIComponent(base) || url;
  } catch {
    const parts = String(url || "").split(/[/\\]/);
    return parts[parts.length - 1] || String(url || "");
  }
}

function isTjzSceneFileName(name = "") {
  return /\.tjz$/i.test(String(name || "").trim());
}

function isJsonSceneFileName(name = "") {
  return /\.(json|threejson|tjson)$/i.test(String(name || "").trim());
}

function isSupportedSceneFileName(name = "") {
  return isTjzSceneFileName(name) || isJsonSceneFileName(name);
}

function nextPlaylistId() {
  return `pl-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export async function bootstrapPlayerApp() {
  const rootContainer = document.getElementById("rootContainer");
  const canvasWrap = document.getElementById("canvasWrap");
  const canvasContainer = document.getElementById("canvasContainer");
  const loadingMask = document.getElementById("loadingMask");
  const messageBox = document.getElementById("messageBox");
  const canvasIdleOverlay = document.getElementById("canvasIdleOverlay");
  const playlistListEl = document.getElementById("playlistList");
  const sceneTitleEl = document.getElementById("topBarSceneTitle");
  const bottomBtnPrev = document.getElementById("bottomBtnPrev");
  const bottomBtnNext = document.getElementById("bottomBtnNext");
  const bottomBtnPlayPause = document.getElementById("bottomBtnPlayPause");
  const bottomBtnStop = document.getElementById("bottomBtnStop");
  const bottomBtnOpen = document.getElementById("bottomBtnOpen");
  const playlistClearBtn = document.getElementById("playlistClearBtn");
  const idleOpenDefaultSceneBtn = document.getElementById("idleOpenDefaultSceneBtn");
  const idleOpenSceneBtn = document.getElementById("idleOpenSceneBtn");
  const idleOpenSceneInput = document.getElementById("idleOpenSceneInput");
  const rightPanelToggleBtn = document.getElementById("bottomBarPlaylistToggle");
  const playerVolumeMuteBtn = document.getElementById("playerVolumeMuteBtn");
  const playerVolumeSlider = document.getElementById("playerVolumeSlider");
  const topBarEl = document.getElementById("topBar");
  const bottomBarEl = document.getElementById("bottomBar");
  const rightDockEl = document.getElementById("rightDock");
  const rightPanelEl = document.getElementById("rightPanel");
  const playlistContextMenu = document.getElementById("playlistContextMenu");
  const playlistContextPlayBtn = document.getElementById("playlistContextPlayBtn");
  const playlistContextReloadBtn = document.getElementById("playlistContextReloadBtn");
  const playlistContextCopyPathBtn = document.getElementById("playlistContextCopyPathBtn");
  const playlistContextCopyNameBtn = document.getElementById("playlistContextCopyNameBtn");
  const playlistContextRemoveBtn = document.getElementById("playlistContextRemoveBtn");

  const sysConfig = createEditorSysConfig();
  let playerSettings = null;
  let playerSettingsFileDefaults = null;
  let scene = null;
  let camera = null;
  let renderer = null;
  let controls = null;
  let renderLoop = null;
  let sceneRuntime = null;
  let currentSceneLabel = "";
  let loadedSceneJsonText = "";

  /** @type {{ id: string, kind: "url"|"file", label: string, url?: string, file?: File }[]} */
  const playlist = [];
  let currentPlaylistIndex = -1;
  let sceneSwitchLocked = false;
  let playbackRenderPaused = false;
  let playerVolume = 1;
  let playerVolumeMuted = false;
  let playlistContextTargetIndex = -1;

  const playerHighlight = createPlayerHighlightController();
  const playerSceneInteraction = createPlayerSceneInteraction({
    getScene: () => scene,
    getCamera: () => camera,
    getCanvas: () => renderer?.domElement ?? canvasContainer,
    getSysConfig: () => sysConfig,
    getSelectionVisual: () => playerHighlight.getSelectionVisual()
  });
  const immersiveChrome = createPlayerImmersiveChrome({
    rootContainer,
    topBarEl,
    bottomBarEl,
    rightDockEl,
    rightPanelEl,
    getChromeHideDelayMs: () =>
      playerSettings?.immersive?.chromeHideDelayMs ??
      PLAYER_SETTINGS_DEFAULTS.immersive.chromeHideDelayMs,
    getRightEdgeStripWidthPx: () =>
      playerSettings?.immersive?.rightEdgeStripWidthPx ??
      PLAYER_SETTINGS_DEFAULTS.immersive.rightEdgeStripWidthPx,
    onResize: windowResize,
    syncRightDockToggleUi: () => syncRightDockToggleUi()
  });

  function closePlaylistContextMenu() {
    playlistContextMenu?.classList.remove("visible");
    playlistContextTargetIndex = -1;
  }

  function openPlaylistContextMenu(clientX, clientY, index) {
    if (!playlistContextMenu || index < 0 || index >= playlist.length) {
      return;
    }
    playlistContextTargetIndex = index;
    playlistContextMenu.classList.add("visible");
    playlistContextMenu.style.left = "0px";
    playlistContextMenu.style.top = "0px";
    const menuRect = playlistContextMenu.getBoundingClientRect();
    const left = Math.min(clientX, window.innerWidth - menuRect.width - 8);
    const top = Math.min(clientY, window.innerHeight - menuRect.height - 8);
    playlistContextMenu.style.left = `${Math.max(8, left)}px`;
    playlistContextMenu.style.top = `${Math.max(8, top)}px`;
  }

  function resolvePlaylistEntryPath(entry) {
    if (!entry) {
      return "";
    }
    if (entry.kind === "url") {
      return String(entry.url || "").trim();
    }
    if (entry.kind === "file") {
      return String(entry.file?.name || entry.label || "").trim();
    }
    return "";
  }

  function playlistEntryJsonFileName(entry) {
    if (!entry) {
      return "";
    }
    if (entry.kind === "file" && entry.file?.name) {
      return String(entry.file.name).trim();
    }
    if (entry.kind === "url" && entry.url) {
      return String(fileNameFromUrl(entry.url) || "").trim();
    }
    return "";
  }

  function getPlaylistEntryDisplayName(entry) {
    if (!entry) {
      return "";
    }
    return String(entry.label || playlistEntryJsonFileName(entry) || "").trim();
  }

  function syncRightDockToggleUi() {
    const open = rootContainer?.classList.contains("rightPanelOpen");
    if (rightPanelToggleBtn) {
      rightPanelToggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
      rightPanelToggleBtn.title = open ? "折叠播放列表" : "展开播放列表";
    }
  }

  async function removePlaylistEntryAt(index) {
    if (index < 0 || index >= playlist.length) {
      return;
    }
    const entry = playlist[index];
    const label = entry.label || `条目 ${index + 1}`;
    const wasCurrent = index === currentPlaylistIndex;
    playlist.splice(index, 1);
    if (entry.kind === "file" && entry.id) {
      try {
        await playerPlaylistIdbDelete(entry.id);
      } catch (err) {
        console.warn("[scene-host player] idbDelete", err);
      }
    }
    if (!playlist.length) {
      currentPlaylistIndex = -1;
      renderPlaylistUi();
      savePlaylistState();
      if (wasCurrent) {
        stopPlayerAndClearScene();
      }
      showMessage(`已从播放列表移除「${label}」。`, "info");
      return;
    }
    if (currentPlaylistIndex > index) {
      currentPlaylistIndex -= 1;
    }
    renderPlaylistUi();
    savePlaylistState();
    if (wasCurrent) {
      const nextIdx = Math.min(index, playlist.length - 1);
      playbackRenderPaused = false;
      await activatePlaylistIndex(nextIdx);
    }
    showMessage(`已从播放列表移除「${label}」。`, "info");
  }

  function showMessage(message, type = "info") {
    if (!messageBox) {
      return;
    }
    const colorMap = {
      info: "rgba(20, 20, 20, 0.82)",
      success: "rgba(46, 125, 50, 0.88)",
      warning: "rgba(176, 118, 0, 0.9)",
      error: "rgba(180, 35, 24, 0.9)"
    };
    messageBox.textContent = message;
    messageBox.style.background = colorMap[type] || colorMap.info;
    messageBox.style.display = "block";
    window.clearTimeout(showMessage.timer);
    showMessage.timer = window.setTimeout(() => {
      messageBox.style.display = "none";
    }, getPlayerMessageToastDurationMs(playerSettings));
  }

  function setLoading(flag) {
    if (loadingMask) {
      loadingMask.style.display = flag ? "flex" : "none";
    }
  }

  function setLoadingMessage(message) {
    setLoading(true);
    showProgressMessage("loadingMask", message);
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
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    primeCanvasLayout();
  }

  function assignRuntime(runtime) {
    if (!runtime || typeof runtime !== "object") {
      return;
    }
    sceneRuntime = runtime;
    scene = runtime.scene ?? scene;
    camera = runtime.camera ?? camera;
    renderer = runtime.renderer ?? renderer;
    controls = runtime.controls ?? controls;
    renderLoop = runtime.renderLoop ?? renderLoop;
  }

  function resetInitFlags() {
    for (const key of Object.keys(sysConfig.initFlags)) {
      sysConfig.initFlags[key] = false;
    }
  }

  function markPlayerSceneLoaded() {
    for (const key of Object.keys(sysConfig.initFlags)) {
      if (key !== "highLightInitFlag") {
        sysConfig.initFlags[key] = true;
      }
    }
  }

  function applyPlayerMasterVolume() {
    setThreeJsonSceneAudioPlaybackPolicy({
      paused: playerVolumeMuted,
      masterVolume: playerVolumeMuted ? 0 : playerVolume
    });
    if (!camera) {
      return;
    }
    const listener = ensureThreeJsonAudioListener(camera);
    if (listener && typeof listener.setMasterVolume === "function") {
      listener.setMasterVolume(playerVolumeMuted ? 0 : playerVolume);
    }
  }

  function syncPlayerVolumeUi() {
    if (playerVolumeMuteBtn) {
      playerVolumeMuteBtn.textContent = playerVolumeMuted ? "\u{1F507}" : "\u{1F50A}";
      playerVolumeMuteBtn.title = playerVolumeMuted ? "取消静音" : "静音";
      playerVolumeMuteBtn.setAttribute("aria-label", playerVolumeMuted ? "取消静音" : "静音");
    }
    if (playerVolumeSlider && document.activeElement !== playerVolumeSlider) {
      playerVolumeSlider.value = String(Math.round(playerVolume * 100));
    }
    applyPlayerMasterVolume();
    if (sceneRuntime) {
      setThreeJsonSceneAudioPaused(sceneRuntime, playerVolumeMuted);
    }
  }

  function syncAudioIntoPlayerSettings() {
    if (!playerSettings?.audio) {
      return;
    }
    playerSettings.audio.defaultVolumePercent = Math.round(playerVolume * 100);
    playerSettings.audio.defaultMuted = playerVolumeMuted;
  }

  function persistPlayerSettingsFromRuntime() {
    if (!playerSettings) {
      return;
    }
    if (playerSettings.audio?.rememberVolume) {
      syncAudioIntoPlayerSettings();
    }
    persistPlayerSettings(playerSettings);
  }

  function savePlayerVolumePrefs() {
    if (playerSettings?.audio?.rememberVolume === false) {
      return;
    }
    persistPlayerSettingsFromRuntime();
  }

  function togglePlayerVolumeMute() {
    playerVolumeMuted = !playerVolumeMuted;
    savePlayerVolumePrefs();
    syncPlayerVolumeUi();
  }

  function onPlayerVolumeSliderInput() {
    if (!playerVolumeSlider) {
      return;
    }
    const n = Number(playerVolumeSlider.value);
    playerVolume = Number.isFinite(n) ? Math.min(1, Math.max(0, n / 100)) : playerVolume;
    if (playerVolume > 0 && playerVolumeMuted) {
      playerVolumeMuted = false;
    }
    savePlayerVolumePrefs();
    syncPlayerVolumeUi();
  }

  function teardownPlayerScene() {
    window.removeEventListener("resize", windowResize);
    renderLoop?.stop?.();
    cancelActiveDeployScheduler();
    renderLoop?.setComposer?.(null);
    playerHighlight.dispose();
    playerSceneInteraction.disposeHostedDoorDblclick();
    try {
      teardownThreeJsonSceneAudioFromRuntime(sceneRuntime);
    } catch {
      /* ignore */
    }
    try {
      disposeTrackedResources();
    } catch (error) {
      console.warn("[scene-editor player] dispose", error);
    }
    try {
      sceneRuntime?.dispose?.();
    } catch {
      /* ignore */
    }
    clearPlayerCanvasSurface();
    scene = null;
    camera = null;
    renderer = null;
    controls = null;
    sceneRuntime = null;
    renderLoop = null;
    resetInitFlags();
    sysConfig.meshObjects = [];
    playbackRenderPaused = false;
  }

  function initPlayerHighlight() {
    const ok = playerHighlight.init({
      scene,
      camera,
      renderer,
      renderLoop,
      canvas: canvasContainer,
      channelOptions: getPlayerHighlightChannelOptions(playerSettings),
      onDoubleClickObject: (obj) => playerSceneInteraction.handleObjectDoubleClick(obj)
    });
    if (ok) {
      sysConfig.initFlags.highLightInitFlag = true;
      playerSceneInteraction.attachHostedDoorDblclick();
      if (playbackRenderPaused) {
        renderLoop?.stop?.();
      } else {
        renderLoop?.start?.();
      }
    }
  }

  function togglePlaybackRender() {
    if (!renderLoop) {
      return;
    }
    if (renderLoop.isRunning?.()) {
      playbackRenderPaused = true;
      renderLoop.stop();
      if (sceneRuntime) {
        setThreeJsonSceneAudioPaused(sceneRuntime, true);
      }
    } else {
      playbackRenderPaused = false;
      renderLoop.start();
      if (sceneRuntime && !playerVolumeMuted) {
        setThreeJsonSceneAudioPaused(sceneRuntime, false);
      }
    }
    syncTransportBar();
  }

  function windowResize() {
    const myWidth = Math.max(80, canvasWrap?.clientWidth || canvasContainer?.clientWidth || window.innerWidth);
    const myHeight = Math.max(80, canvasWrap?.clientHeight || canvasContainer?.clientHeight || window.innerHeight);
    sysConfig.windowSizeNow.width = myWidth;
    sysConfig.windowSizeNow.height = myHeight;
    sysConfig.canvasWidth = myWidth;
    sysConfig.canvasHeight = myHeight;
    renderLoop?.resize({ width: myWidth, height: myHeight });
  }

  function clearPlayerCanvasSurface() {
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

  function startPlayerRenderLoopEarly() {
    if (!renderLoop || playbackRenderPaused) {
      return;
    }
    renderLoop.setComposer(playerHighlight.getComposer?.() ?? null);
    renderLoop.start();
    syncTransportBar();
  }

  function superAnimate() {
    if (!renderLoop) {
      return;
    }
    renderLoop.setComposer(playerHighlight.getComposer?.() ?? null);
    if (playbackRenderPaused) {
      renderLoop.stop();
    } else {
      renderLoop.start();
    }
    syncTransportBar();
  }

  let previewBindSceneEventsOverride = undefined;

  function buildCreateJsonSceneOptions() {
    const opts = {
      canvas: canvasContainer,
      assetsBase: new URL("../../../../assets/", import.meta.url).href,
      autoFillLights: true,
      autoFillCamera: true,
      sceneAutoRotate: sysConfig.sceneAutoRotate,
      renderLoopUserPolicy: {
        fps: sysConfig.fps,
        lowFps: sysConfig.lowFps,
        overrideSceneRenderLoop: playerSettings?.render?.overrideSceneRenderLoop === true
      },
      async onRuntimeReady(ctx) {
        assignRuntime(ctx?.runtime);
        windowResize();
        if (playerSettings?.render?.earlyRenderWhileLoading !== false) {
          startPlayerRenderLoopEarly();
        }
      },
      async onSceneReady(ctx) {
        try {
          const { bootstrapFirstPersonExtensionsFromScene } = await import(
            "../../../../extensions/fps-walk/bootstrapFirstPersonExtensions.js"
          );
          await bootstrapFirstPersonExtensionsFromScene(ctx);
        } catch (err) {
          console.warn("[scene-editor player] firstPerson bootstrap skipped", err);
        }
      }
    };
    if (previewBindSceneEventsOverride !== undefined) {
      opts.bindSceneEvents = previewBindSceneEventsOverride;
    }
    return opts;
  }

  async function initSceneRuntime() {
    await waitCanvasLayout();
    const payload = buildEditorScenePayload(sysConfig, playerSettings);
    sceneRuntime = await createJsonScene(payload, buildCreateJsonSceneOptions());
    assignRuntime(sceneRuntime);
    const normalized = sceneRuntime?.normalizedPayload;
    if (normalized && typeof normalized === "object") {
      sysConfig.jsonData = normalized;
    }
    markPlayerSceneLoaded();
    trackDisposableResource(scene);
    windowResize();
    bindThreeJsonSceneAudioUnlock(canvasContainer, () => sceneRuntime);
    applyPlayerMasterVolume();
    void resumeThreeJsonAudioContextFromCamera(camera);
    if (sceneRuntime) {
      setThreeJsonSceneAudioPaused(sceneRuntime, playerVolumeMuted);
    }
    window.addEventListener("resize", windowResize);
    initPlayerHighlight();
    superAnimate();
  }

  function fitViewToSceneBounds() {
    if (!camera || !controls || !scene) {
      return false;
    }
    const bounds = buildAdaptiveContentBoundingBoxTHREE(scene, { ignoreHelper: null });
    if (!bounds) {
      return false;
    }
    return fitPerspectiveCameraToContentBoundsTHREE(camera, controls, bounds, {
      aspectHints: {
        rendererDomElement: renderer?.domElement,
        threeViewActive: false,
        mainViewRect: {
          x: 0,
          y: 0,
          width: sysConfig.canvasWidth,
          height: sysConfig.canvasHeight
        },
        canvasWrap: canvasWrap || rootContainer
      }
    });
  }

  function onMenuFitView() {
    if (!camera || !controls || !scene) {
      showMessage("场景尚未就绪，无法自适应。", "warning");
      return;
    }
    const bounds = buildAdaptiveContentBoundingBoxTHREE(scene, { ignoreHelper: null });
    if (!bounds) {
      showMessage("场景中缺少可用网格，无法进行自适应。", "warning");
      return;
    }
    const ok = fitPerspectiveCameraToContentBoundsTHREE(camera, controls, bounds, {
      aspectHints: {
        rendererDomElement: renderer?.domElement,
        threeViewActive: false,
        mainViewRect: {
          x: 0,
          y: 0,
          width: sysConfig.canvasWidth,
          height: sysConfig.canvasHeight
        },
        canvasWrap: canvasWrap || rootContainer
      }
    });
    if (!ok) {
      showMessage("包围盒为空，无法进行自适应。", "warning");
      return;
    }
    showMessage("已根据当前网格自适应相机与缩放范围。", "success");
  }

  function scheduleSceneFitPasses() {
    fitViewToSceneBounds();
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        fitViewToSceneBounds();
      });
    });
    window.setTimeout(() => fitViewToSceneBounds(), 1200);
  }

  function finishSceneLoad() {
    setLoadingMessage("3D 场景加载完成。");
    const delay = getPlayerSceneLoadDoneDelayMs(playerSettings);
    if (delay > 0) {
      window.setTimeout(() => setLoading(false), delay);
    } else {
      setLoading(false);
    }
    openOrCloseProgressManager(false);
    scheduleSceneFitPasses();
    syncTransportBar();
  }

  async function applyParsedSceneToPlayer(data, hintLabel = "") {
    const payload = resolveScenePayloadForLoad(data, { label: hintLabel });
    if (!isLoadableScenePayload(payload)) {
      throw new Error("JSON 格式无效（需要 worldInfo 或标准 objectList）");
    }
    ensureThreeJsonIdsOnScenePayload(payload);
    loadedSceneJsonText = JSON.stringify(payload, null, 2);
    teardownPlayerScene();
    sysConfig.jsonData = payload;
    setLoadingMessage("正在加载场景 JSON...");
    openOrCloseProgressManager(sysConfig.progressFlag);
    await initSceneRuntime();
    currentSceneLabel =
      String(payload?.label || payload?.name || hintLabel || "").trim() ||
      fileNameFromUrl(hintLabel) ||
      "未命名场景";
    updatePlayerTopBarSceneTitle();
    finishSceneLoad();
  }

  async function applyPreviewPayloadFromEditor(payload, options = {}) {
    previewBindSceneEventsOverride = options.bindSceneEvents;
    try {
      await applyParsedSceneToPlayer(payload, options.label || "编辑器预览");
    } finally {
      previewBindSceneEventsOverride = undefined;
    }
  }

  async function applyTjzArchiveToPlayer(bytes, hintLabel = "") {
    teardownPlayerScene();
    await waitCanvasLayout();
    setLoadingMessage("正在解压 .tjz 场景...");
    openOrCloseProgressManager(sysConfig.progressFlag);
    const loadedRuntime = await createJsonSceneFromArchive(bytes, buildCreateJsonSceneOptions());
    assignRuntime(loadedRuntime);
    const normalized = loadedRuntime?.normalizedPayload;
    if (normalized && typeof normalized === "object") {
      sysConfig.jsonData = normalized;
      loadedSceneJsonText = JSON.stringify(normalized, null, 2);
    }
    markPlayerSceneLoaded();
    trackDisposableResource(scene);
    windowResize();
    bindThreeJsonSceneAudioUnlock(canvasContainer, () => sceneRuntime);
    applyPlayerMasterVolume();
    window.addEventListener("resize", windowResize);
    initPlayerHighlight();
    superAnimate();
    currentSceneLabel = String(hintLabel || "").trim() || "tjz 场景";
    updatePlayerTopBarSceneTitle();
    finishSceneLoad();
  }

  function updatePlayerTopBarSceneTitle() {
    if (!sceneTitleEl) {
      return;
    }
    const entry = playlist[currentPlaylistIndex];
    const fn = playlistEntryJsonFileName(entry);
    const titleBase =
      playerSettings?.general?.baseTitle?.trim() ||
      t("player.shell.topBarSceneTitle", "Scene Player");
    sceneTitleEl.textContent = fn ? `${titleBase} - ${fn}` : titleBase;
    document.title = fn ? `${fn} · ${titleBase}` : titleBase;
  }

  function setCanvasIdleOverlayVisible(visible) {
    if (!canvasIdleOverlay) {
      return;
    }
    const on = Boolean(visible);
    canvasIdleOverlay.classList.toggle("isVisible", on);
    canvasIdleOverlay.setAttribute("aria-hidden", on ? "false" : "true");
  }

  function stopPlayerAndClearScene() {
    setLoading(false);
    openOrCloseProgressManager(false);
    teardownPlayerScene();
    currentPlaylistIndex = -1;
    loadedSceneJsonText = "";
    sysConfig.jsonData = null;
    playbackRenderPaused = false;
    renderPlaylistUi();
    updatePlayerTopBarSceneTitle();
    syncTransportBar();
    setCanvasIdleOverlayVisible(true);
    savePlaylistState();
  }

  function syncTransportBar() {
    const noScene = !renderLoop;
    if (bottomBtnPlayPause) {
      if (noScene) {
        bottomBtnPlayPause.disabled = true;
        bottomBtnPlayPause.textContent = "▶";
        bottomBtnPlayPause.title = "播放";
      } else {
        bottomBtnPlayPause.disabled = false;
        const running = Boolean(renderLoop?.isRunning?.());
        bottomBtnPlayPause.textContent = running ? "⏸" : "▶";
        bottomBtnPlayPause.title = running ? "暂停" : "播放";
      }
    }
    if (bottomBtnPrev) {
      bottomBtnPrev.disabled = currentPlaylistIndex <= 0;
    }
    if (bottomBtnNext) {
      bottomBtnNext.disabled =
        currentPlaylistIndex < 0 || currentPlaylistIndex >= playlist.length - 1;
    }
  }

  function renderPlaylistUi() {
    if (!playlistListEl) {
      return;
    }
    closePlaylistContextMenu();
    playlistListEl.replaceChildren();
    playlist.forEach((entry, idx) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = `playlistRow${idx === currentPlaylistIndex ? " playlistRowActive" : ""}`;
      row.dataset.playlistIndex = String(idx);
      row.textContent = entry.label || `条目 ${idx + 1}`;
      row.title = entry.kind === "url" ? entry.url : entry.file?.name || "";
      row.addEventListener("click", () => {
        void activatePlaylistIndex(idx);
      });
      row.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openPlaylistContextMenu(event.clientX, event.clientY, idx);
      });
      playlistListEl.appendChild(row);
    });
    syncTransportBar();
  }

  function playlistManifestEntry(entry) {
    if (!entry) {
      return null;
    }
    if (entry.kind === "url") {
      return { id: entry.id, kind: "url", url: entry.url, label: entry.label };
    }
    if (entry.kind === "file") {
      return {
        id: entry.id,
        kind: "file",
        label: entry.label,
        fileName: entry.file?.name || entry.label,
        fileSize: entry.file?.size,
        fileLastModified: entry.file?.lastModified
      };
    }
    return null;
  }

  function savePlaylistState() {
    try {
      const manifest = playlist.map(playlistManifestEntry).filter(Boolean);
      localStorage.setItem(LS_PLAYLIST_MANIFEST_KEY, JSON.stringify(manifest));
      const current = playlist[currentPlaylistIndex];
      if (current?.id) {
        localStorage.setItem(LS_PLAYLIST_CURRENT_ID_KEY, current.id);
      } else {
        localStorage.removeItem(LS_PLAYLIST_CURRENT_ID_KEY);
      }
    } catch (err) {
      console.warn("[scene-editor player] savePlaylistState", err);
    }
  }

  function appendUrlToPlaylist(url, label = "") {
    const entry = {
      id: nextPlaylistId(),
      kind: "url",
      url: resolveSceneHostUrl(url),
      label: label || fileNameFromUrl(url)
    };
    playlist.push(entry);
    renderPlaylistUi();
    savePlaylistState();
    return playlist.length - 1;
  }

  async function appendFileToPlaylist(file) {
    const id = nextPlaylistId();
    await playerPlaylistIdbPut(id, file);
    playlist.push({
      id,
      kind: "file",
      label: file.name,
      file
    });
    renderPlaylistUi();
    savePlaylistState();
    return playlist.length - 1;
  }

  async function restorePlaylistFromStorage() {
    let manifest;
    try {
      const raw = localStorage.getItem(LS_PLAYLIST_MANIFEST_KEY);
      if (!raw) {
        return false;
      }
      manifest = JSON.parse(raw);
      if (!Array.isArray(manifest) || !manifest.length) {
        return false;
      }
    } catch {
      return false;
    }

    playlist.length = 0;
    currentPlaylistIndex = -1;

    for (const item of manifest) {
      if (!item || typeof item !== "object" || !item.id) {
        continue;
      }
      if (item.kind === "url" && item.url) {
        playlist.push({
          id: item.id,
          kind: "url",
          url: resolveSceneHostUrl(item.url),
          label: item.label || fileNameFromUrl(item.url)
        });
        continue;
      }
      if (item.kind === "file") {
        const blob = await playerPlaylistIdbGet(item.id);
        if (!blob) {
          continue;
        }
        const fileName = item.fileName || item.label || "scene.json";
        const file =
          blob instanceof File
            ? blob
            : new File([blob], fileName, {
                type: blob.type || "application/json",
                lastModified: item.fileLastModified || Date.now()
              });
        playlist.push({
          id: item.id,
          kind: "file",
          label: item.label || fileName,
          file
        });
      }
    }

    if (!playlist.length) {
      return false;
    }

    const savedId = localStorage.getItem(LS_PLAYLIST_CURRENT_ID_KEY);
    let idx = savedId ? playlist.findIndex((e) => e.id === savedId) : 0;
    if (idx < 0) {
      idx = 0;
    }
    renderPlaylistUi();
    const ok = await activatePlaylistIndex(idx);
    if (!ok) {
      showPlayerStartupEmptyState();
    }
    return ok;
  }

  async function activatePlaylistIndex(index) {
    if (sceneSwitchLocked || index < 0 || index >= playlist.length) {
      return;
    }
    sceneSwitchLocked = true;
    currentPlaylistIndex = index;
    renderPlaylistUi();
    savePlaylistState();
    setCanvasIdleOverlayVisible(false);
    const entry = playlist[index];
    try {
      setLoadingMessage("正在读取场景...");
      openOrCloseProgressManager(sysConfig.progressFlag);
      if (entry.kind === "url" && entry.url) {
        const resolvedUrl = resolveSceneHostUrl(entry.url);
        if (isTjzSceneFileName(resolvedUrl)) {
          const response = await fetch(resolvedUrl);
          if (!response.ok) {
            throw new Error(`加载场景失败：${response.status}`);
          }
          const bytes = new Uint8Array(await response.arrayBuffer());
          await applyTjzArchiveToPlayer(bytes, entry.label || fileNameFromUrl(resolvedUrl));
        } else {
          const response = await fetch(resolvedUrl);
          if (!response.ok) {
            throw new Error(`加载场景失败：${response.status}`);
          }
          const data = JSON.parse(await response.text());
          await applyParsedSceneToPlayer(data, entry.label || fileNameFromUrl(resolvedUrl));
        }
      } else if (entry.kind === "file" && entry.file) {
        if (isTjzSceneFileName(entry.file.name)) {
          const bytes = new Uint8Array(await entry.file.arrayBuffer());
          await applyTjzArchiveToPlayer(bytes, entry.file.name);
        } else {
          const rawText = await entry.file.text();
          const data = JSON.parse(rawText);
          const wasNative = isThreeJsObjectExportJson(data);
          await applyParsedSceneToPlayer(data, entry.file.name);
          if (wasNative) {
            showMessage(
              `已识别为 Three.js 原生 JSON 并载入 ${entry.file.name}（与「加载原生 JSON」等效）`,
              "info"
            );
          }
        }
      } else {
        throw new Error("播放列表条目无效");
      }
    } catch (err) {
      setLoading(false);
      openOrCloseProgressManager(false);
      showMessage(`加载场景失败：${err.message}`, "error");
      console.error(err);
      if (!renderLoop) {
        setCanvasIdleOverlayVisible(true);
      }
    } finally {
      sceneSwitchLocked = false;
      syncTransportBar();
    }
  }

  function showPlayerStartupEmptyState() {
    playlist.length = 0;
    currentPlaylistIndex = -1;
    renderPlaylistUi();
    updatePlayerTopBarSceneTitle();
    syncTransportBar();
    setLoading(false);
    openOrCloseProgressManager(false);
    setCanvasIdleOverlayVisible(true);
  }

  function resolveUrlQuerySceneUrl() {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get("scene") || params.get("url");
    if (!fromQuery || playerSettings?.playback?.preferUrlQueryScene === false) {
      return null;
    }
    try {
      return resolveSceneHostUrl(decodeURIComponent(fromQuery));
    } catch {
      return resolveSceneHostUrl(fromQuery);
    }
  }

  function resolveSceneHostUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) {
      return raw;
    }
    if (/^(?:[a-z]+:)?\/\//i.test(raw) || raw.startsWith("data:") || raw.startsWith("blob:")) {
      return raw;
    }
    const sceneHostRoot = new URL("../../../../", import.meta.url).href;
    if (raw === "/demo.html" || raw === "./demo.html" || raw === "demo.html") {
      return new URL("demo.html", sceneHostRoot).href;
    }
    if (raw.startsWith("/assets/")) {
      return new URL(raw.slice(1), sceneHostRoot).href;
    }
    if (raw.startsWith("./")) {
      return new URL(raw.slice(2), sceneHostRoot).href;
    }
    if (raw.startsWith("../")) {
      return new URL(raw, sceneHostRoot).href;
    }
    if (raw.startsWith("assets/")) {
      return new URL(raw, sceneHostRoot).href;
    }
    return raw;
  }

  let lastAppliedHostLocale = null;

  async function applyHostLocaleFromSettings() {
    const locale = await initHostI18n(playerSettings?.general?.locale);
    applyShellI18n(document);
    if (loadingMask) {
      loadingMask.textContent = getPlayerLoadingMaskText(playerSettings);
    }
    updatePlayerTopBarSceneTitle();
    if (locale !== lastAppliedHostLocale) {
      lastAppliedHostLocale = locale;
      settingsModal?.refreshForLocale?.(playerSettings);
    }
  }

  function applyPlayerSettingsFromBundle(bundle, { initial = false } = {}) {
    playerSettings = bundle.settings;
    playerSettingsFileDefaults = bundle.fileDefaults;
    sysConfig.antialias = playerSettings?.render?.antialias !== false;
    sysConfig.fps = Number(playerSettings?.render?.targetFps) || 60;
    sysConfig.lowFps = playerSettings?.render?.lowFpsMode === true;
    sysConfig.sceneAutoRotate = playerSettings?.playback?.sceneAutoRotate === true;
    sysConfig.progressFlag = playerSettings?.general?.progressOverlayEnabled ?? sysConfig.progressFlag;
    if (initial) {
      const volPct = Number(playerSettings?.audio?.defaultVolumePercent);
      playerVolume = Number.isFinite(volPct) ? Math.min(1, Math.max(0, volPct / 100)) : 1;
      playerVolumeMuted = playerSettings?.audio?.defaultMuted === true;
    }
    if (loadingMask) {
      loadingMask.textContent = getPlayerLoadingMaskText(playerSettings);
    }
    if (initial && playerSettings?.layout?.rightPanelOpenByDefault !== false) {
      rootContainer?.classList.add("rightPanelOpen");
    } else if (!initial) {
      rootContainer?.classList.toggle("rightPanelOpen", playerSettings?.layout?.rightPanelOpenByDefault !== false);
    }
    syncRightDockToggleUi();
    updatePlayerTopBarSceneTitle();
    syncPlayerVolumeUi();
    immersiveChrome.applyRightEdgeStripWidth();
    if (Number.isFinite(playerSettings?.layout?.playlistListMinHeightPx) && playlistListEl) {
      playlistListEl.style.minHeight = `${playerSettings.layout.playlistListMinHeightPx}px`;
    }
    void applyHostLocaleFromSettings();
  }

  async function handleOpenSceneFile(file, { activate = false } = {}) {
    if (!file) {
      return;
    }
    if (!isSupportedSceneFileName(file.name)) {
      showMessage("请选择 JSON 或 .tjz 场景文件。", "warning");
      return;
    }
    if (activate) {
      playbackRenderPaused = false;
    }
    const idx = await appendFileToPlaylist(file);
    if (activate) {
      await activatePlaylistIndex(idx);
      return;
    }
    showMessage(`已添加 ${file.name} 到播放列表。`, "success");
  }

  async function handleLoadNativeThreeJsonFile(file) {
    if (!file || sceneSwitchLocked) {
      return;
    }
    sceneSwitchLocked = true;
    setCanvasIdleOverlayVisible(false);
    try {
      setLoadingMessage("正在读取原生 Three JSON...");
      openOrCloseProgressManager(sysConfig.progressFlag);
      const text = await file.text();
      const parsed = JSON.parse(text);
      const wrapped = buildMinimalWorldJsonForNativeThreeInline(parsed, { label: file.name });
      await applyParsedSceneToPlayer(wrapped, file.name);
      showMessage(`已按原生 JSON 载入 ${file.name}`, "success");
    } catch (err) {
      setLoading(false);
      openOrCloseProgressManager(false);
      showMessage(`加载原生 JSON 失败：${err.message}`, "error");
      console.error(err);
      if (!renderLoop) {
        setCanvasIdleOverlayVisible(true);
      }
    } finally {
      sceneSwitchLocked = false;
      syncTransportBar();
    }
  }

  async function appendFilesToPlaylistOnly(files) {
    const sceneFiles = files.filter((f) => isSupportedSceneFileName(f.name));
    if (!sceneFiles.length) {
      showMessage("未找到可添加的 JSON 或 .tjz 场景文件。", "warning");
      return 0;
    }
    sceneFiles.sort((a, b) => {
      const pa = a.webkitRelativePath || a.name;
      const pb = b.webkitRelativePath || b.name;
      return pa.localeCompare(pb, undefined, { sensitivity: "base" });
    });
    for (const f of sceneFiles) {
      await appendFileToPlaylist(f);
    }
    showMessage(`已添加 ${sceneFiles.length} 个场景到播放列表。`, "success");
    return sceneFiles.length;
  }

  async function clearPlaylistAndStop() {
    playlist.length = 0;
    currentPlaylistIndex = -1;
    try {
      localStorage.removeItem(LS_PLAYLIST_MANIFEST_KEY);
      localStorage.removeItem(LS_PLAYLIST_CURRENT_ID_KEY);
      await playerPlaylistIdbClear();
    } catch (err) {
      console.warn("[scene-host player] clearPlaylist storage", err);
    }
    stopPlayerAndClearScene();
    showMessage("已清空播放列表并停止播放。", "info");
  }

  async function openDefaultExampleScene() {
    const url = getDefaultSceneUrl(playerSettings);
    playlist.length = 0;
    currentPlaylistIndex = -1;
    const idx = appendUrlToPlaylist(url, fileNameFromUrl(url));
    const ok = await activatePlaylistIndex(idx);
    if (!ok) {
      showPlayerStartupEmptyState();
    }
  }

  bottomBtnPrev?.addEventListener("click", () => {
    if (currentPlaylistIndex > 0) {
      void activatePlaylistIndex(currentPlaylistIndex - 1);
    }
  });
  bottomBtnNext?.addEventListener("click", () => {
    if (currentPlaylistIndex < playlist.length - 1) {
      void activatePlaylistIndex(currentPlaylistIndex + 1);
    }
  });
  bottomBtnPlayPause?.addEventListener("click", togglePlaybackRender);
  bottomBtnStop?.addEventListener("click", () => {
    stopPlayerAndClearScene();
  });
  bottomBtnOpen?.addEventListener("click", () => {
    playerTopMenuApi?.openSceneJsonPicker?.();
  });
  idleOpenSceneBtn?.addEventListener("click", () => {
    idleOpenSceneInput?.click();
  });
  idleOpenSceneInput?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) {
      await handleOpenSceneFile(file, { activate: true });
    }
  });
  idleOpenDefaultSceneBtn?.addEventListener("click", () => {
    void openDefaultExampleScene();
  });
  playlistClearBtn?.addEventListener("click", () => {
    void clearPlaylistAndStop();
  });
  rightPanelToggleBtn?.addEventListener("click", () => {
    immersiveChrome.onBottomBarPlaylistToggleClick?.();
  });
  rightDockEl?.addEventListener("transitionend", (event) => {
    if (event.target !== rightDockEl) {
      return;
    }
    if (event.propertyName !== "width" && event.propertyName !== "min-width") {
      return;
    }
    windowResize();
  });
  syncRightDockToggleUi();
  playerVolumeMuteBtn?.addEventListener("click", togglePlayerVolumeMute);
  playerVolumeSlider?.addEventListener("input", onPlayerVolumeSliderInput);
  playlistContextPlayBtn?.addEventListener("click", () => {
    const idx = playlistContextTargetIndex;
    closePlaylistContextMenu();
    if (idx >= 0) {
      void activatePlaylistIndex(idx);
    }
  });
  playlistContextReloadBtn?.addEventListener("click", () => {
    const idx = playlistContextTargetIndex;
    closePlaylistContextMenu();
    if (idx >= 0) {
      void activatePlaylistIndex(idx);
    }
  });
  playlistContextCopyPathBtn?.addEventListener("click", async () => {
    const entry = playlist[playlistContextTargetIndex];
    const path = resolvePlaylistEntryPath(entry);
    closePlaylistContextMenu();
    if (!path) {
      showMessage("该条目没有可复制的路径。", "warning");
      return;
    }
    try {
      await navigator.clipboard.writeText(path);
      showMessage("已复制路径。", "success");
    } catch {
      showMessage("复制失败，请手动复制。", "warning");
    }
  });
  playlistContextCopyNameBtn?.addEventListener("click", async () => {
    const entry = playlist[playlistContextTargetIndex];
    const name = getPlaylistEntryDisplayName(entry);
    closePlaylistContextMenu();
    if (!name) {
      showMessage("该条目没有可复制的名称。", "warning");
      return;
    }
    try {
      await navigator.clipboard.writeText(name);
      showMessage("已复制名称。", "success");
    } catch {
      showMessage("复制失败，请手动复制。", "warning");
    }
  });
  playlistContextRemoveBtn?.addEventListener("click", () => {
    const idx = playlistContextTargetIndex;
    closePlaylistContextMenu();
    if (idx >= 0) {
      void removePlaylistEntryAt(idx);
    }
  });
  document.addEventListener("click", (event) => {
    if (!playlistContextMenu?.classList.contains("visible")) {
      return;
    }
    if (playlistContextMenu.contains(event.target)) {
      return;
    }
    closePlaylistContextMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (document.fullscreenElement) {
        void document.exitFullscreen();
      }
      closePlaylistContextMenu();
    }
  });

  let playerTopMenuApi = null;

  const settingsModal = createPlayerSettingsModal({
    getSettings: () => playerSettings,
    getFileDefaults: () => playerSettingsFileDefaults,
    onSave(next) {
      playerSettings = next;
      persistPlayerSettingsFromRuntime();
      applyPlayerSettingsFromBundle({ settings: playerSettings, fileDefaults: playerSettingsFileDefaults });
      showMessage("设置已保存并应用。", "success");
    },
    async onReset() {
      playerSettingsFileDefaults = await fetchPlayerSettingsFileDefaults();
      playerSettings = playerSettingsFileDefaults;
      persistPlayerSettings(playerSettings);
      applyPlayerSettingsFromBundle({ settings: playerSettings, fileDefaults: playerSettingsFileDefaults });
      showMessage("已恢复为 setting.json 默认。", "info");
    }
  });
  playerTopMenuApi = wirePlayerTopMenu({
    showMessage,
    settingsModal,
    immersiveChrome,
    onMenuFitView,
    getLoadedSceneJsonText: () => loadedSceneJsonText,
    handleOpenSceneFile,
    handleLoadNativeThreeJsonFile,
    appendFilesToPlaylistOnly,
    clearPlayerSettingsCache,
    applyPlayerSettingsFromBundle,
    fetchPlayerSettingsFileDefaults,
    getPlayerSettings: () => playerSettings,
    setPlayerSettings: (next) => {
      playerSettings = next;
    }
  });

  const bundle = await loadPlayerSettingsBundle();
  applyPlayerSettingsFromBundle(bundle, { initial: true });
  immersiveChrome.init(showMessage);
  primeCanvasLayout();
  bindProgressElement(loadingMask);
  openOrCloseProgressManager(sysConfig.progressFlag);

  const editorPreviewBridge = createPlayerEditorPreviewBridge({
    applyPreviewPayload: applyPreviewPayloadFromEditor,
    showMessage,
    hideStartupEmptyState: () => {
      const empty = document.getElementById("playerStartupEmptyState");
      if (empty) {
        empty.hidden = true;
      }
    },
    setLoading,
    setLoadingMessage
  });
  const editorPreviewActive = editorPreviewBridge.bootstrap();

  const restored =
    !editorPreviewActive &&
    playerSettings?.playback?.restorePlaylistOnStartup !== false
      ? await restorePlaylistFromStorage()
      : false;
  if (!restored && !editorPreviewActive) {
    const queryUrl = resolveUrlQuerySceneUrl();
    if (queryUrl) {
      playlist.length = 0;
      currentPlaylistIndex = -1;
      appendUrlToPlaylist(queryUrl);
      const ok = await activatePlaylistIndex(0);
      if (!ok) {
        showPlayerStartupEmptyState();
      }
    } else {
      showPlayerStartupEmptyState();
    }
  }

  window.addEventListener("beforeunload", () => {
    teardownPlayerScene();
  });

  window.scenePlayer = {
    scene: () => scene,
    camera: () => camera,
    renderer: () => renderer,
    controls: () => controls,
    sysConfig,
    wasteCleaner: () => teardownPlayerScene(),
    fitViewToSceneBounds: () => fitViewToSceneBounds(),
    activatePlaylistIndex: (index) => activatePlaylistIndex(index),
    getPlaylist: () => playlist,
    appendUrlToPlaylist: (url, label) => appendUrlToPlaylist(url, label),
    appendFileToPlaylist: (file) => appendFileToPlaylist(file),
    openSceneJsonModal: () => playerTopMenuApi?.openSceneJsonModal?.()
  };
  window.roomshow = window.scenePlayer;
}

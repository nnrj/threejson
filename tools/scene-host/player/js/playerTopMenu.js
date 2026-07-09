import { initTopMenubarExclusiveOpen } from "../../shared/js/topMenubarExclusiveOpen.js";
import { t } from "../../shared/i18n/index.js";

export function wirePlayerTopMenu(deps) {
  const {
    showMessage,
    settingsModal,
    immersiveChrome,
    onMenuFitView,
    getLoadedSceneJsonText,
    handleOpenSceneFile,
    handleLoadNativeThreeJsonFile,
    appendFilesToPlaylistOnly,
    clearPlayerSettingsCache,
    applyPlayerSettingsFromBundle,
    fetchPlayerSettingsFileDefaults,
    getPlayerSettings,
    setPlayerSettings
  } = deps;

  initTopMenubarExclusiveOpen();

  const sceneJsonModal = document.getElementById("sceneJsonModal");
  const sceneJsonContent = document.getElementById("sceneJsonContent");
  const closeJsonBtn = document.getElementById("closeJsonBtn");
  const copyJsonBtn = document.getElementById("copyJsonBtn");
  const helpAboutModal = document.getElementById("helpAboutModal");
  const helpAboutCloseBtn = document.getElementById("helpAboutCloseBtn");
  const sceneJsonFileInput = document.getElementById("sceneJsonFileInput");
  const nativeThreeJsonFileInput = document.getElementById("nativeThreeJsonFileInput");
  const tjzArchiveFileInput = document.getElementById("tjzArchiveFileInput");
  const playlistOpenBtn = document.getElementById("playlistOpenBtn");
  const toolbarResetViewBtn = document.getElementById("toolbarResetViewBtn");
  const fullscreenBtn = document.getElementById("fullscreenBtn");
  const playlistAddMenu = document.getElementById("playlistAddMenu");
  const playlistAddSingleFileInput = document.getElementById("playlistAddSingleFileInput");
  const playlistAddTjzFileInput = document.getElementById("playlistAddTjzFileInput");
  const playlistFolderInput = document.getElementById("playlistFolderInput");

  function closeAllTopMenus() {
    document.querySelectorAll(".topMenu[open]").forEach((el) => {
      el.removeAttribute("open");
    });
  }

  function openSceneJsonPicker() {
    closeAllTopMenus();
    sceneJsonFileInput?.click();
  }

  function openSceneJsonModal() {
    if (sceneJsonContent) {
      sceneJsonContent.value = getLoadedSceneJsonText?.() || "";
    }
    sceneJsonModal?.classList.add("visible");
  }

  function closeSceneJsonModal() {
    sceneJsonModal?.classList.remove("visible");
  }

  function openHelpAboutModal() {
    helpAboutModal?.classList.add("visible");
  }

  function closeHelpAboutModal() {
    helpAboutModal?.classList.remove("visible");
  }

  function handleMenuFitView() {
    onMenuFitView?.();
  }

  async function copySceneJsonToClipboard() {
    const content = sceneJsonContent?.value || "";
    if (!content) {
      return;
    }
    try {
      await navigator.clipboard.writeText(content);
      showMessage(t("player.message.jsonCopied", "JSON copied to clipboard."), "success");
    } catch (error) {
      console.error(error);
      showMessage(t("player.message.copyFailed", "Copy failed. Please copy manually."), "warning");
    }
  }

  function syncFullscreenToggleLabels() {
    const full = !!document.fullscreenElement;
    const txt = full
      ? t("player.shell.fullscreenExit", "Exit Fullscreen")
      : t("player.shell.fullscreenBtn", "Fullscreen");
    if (fullscreenBtn) {
      fullscreenBtn.textContent = txt;
    }
    const menuBtn = document.getElementById("menuFullscreenToggle");
    if (menuBtn) {
      menuBtn.textContent = txt;
    }
    const bottomBtn = document.getElementById("bottomBtnFullscreen");
    if (bottomBtn) {
      bottomBtn.textContent = "⛶";
      bottomBtn.title = full
        ? t("player.shell.fullscreenExitEsc", "Exit Fullscreen (Esc)")
        : t("player.shell.bottomBtnFullscreen.title", "Fullscreen");
    }
  }

  document.getElementById("menuOpenSceneJson")?.addEventListener("click", openSceneJsonPicker);
  document.getElementById("menuLoadSceneJson")?.addEventListener("click", () => {
    sceneJsonFileInput?.click();
    closeAllTopMenus();
  });
  document.getElementById("menuLoadNativeThreeJson")?.addEventListener("click", () => {
    nativeThreeJsonFileInput?.click();
    closeAllTopMenus();
  });
  document.getElementById("menuLoadTjzArchive")?.addEventListener("click", () => {
    tjzArchiveFileInput?.click();
    closeAllTopMenus();
  });
  document.getElementById("menuViewSceneJson")?.addEventListener("click", () => {
    openSceneJsonModal();
    closeAllTopMenus();
  });
  document.getElementById("menuFitView")?.addEventListener("click", () => {
    handleMenuFitView();
    closeAllTopMenus();
  });
  document.getElementById("menuFullscreenToggle")?.addEventListener("click", () => {
    void immersiveChrome?.toggleFullscreen?.(showMessage);
    closeAllTopMenus();
  });
  document.getElementById("menuOpenPlayerSettings")?.addEventListener("click", () => {
    settingsModal?.open?.();
    closeAllTopMenus();
  });
  document.getElementById("menuHelpUserManual")?.addEventListener("click", () => {
    closeAllTopMenus();
    showMessage(t("player.message.featurePending", "This feature is under construction."), "info");
  });
  document.getElementById("menuClearPlayerSettingsCache")?.addEventListener("click", async () => {
    clearPlayerSettingsCache?.();
    if (fetchPlayerSettingsFileDefaults && applyPlayerSettingsFromBundle && setPlayerSettings) {
      const fileDefaults = await fetchPlayerSettingsFileDefaults();
      setPlayerSettings(fileDefaults);
      applyPlayerSettingsFromBundle({ settings: fileDefaults, fileDefaults });
    }
    closeAllTopMenus();
    showMessage(t("player.message.settingsCacheCleared", "Player settings cache cleared and defaults restored."), "info");
  });
  document.getElementById("menuHelpAbout")?.addEventListener("click", () => {
    closeAllTopMenus();
    openHelpAboutModal();
  });

  playlistOpenBtn?.addEventListener("click", openSceneJsonPicker);
  toolbarResetViewBtn?.addEventListener("click", handleMenuFitView);
  fullscreenBtn?.addEventListener("click", () => {
    void immersiveChrome?.toggleFullscreen?.(showMessage);
  });

  document.getElementById("playlistAddJsonFileBtn")?.addEventListener("click", () => {
    playlistAddSingleFileInput?.click();
    playlistAddMenu?.removeAttribute("open");
  });
  document.getElementById("playlistAddTjzFileBtn")?.addEventListener("click", () => {
    playlistAddTjzFileInput?.click();
    playlistAddMenu?.removeAttribute("open");
  });
  document.getElementById("playlistAddFolderBtn")?.addEventListener("click", () => {
    playlistFolderInput?.click();
    playlistAddMenu?.removeAttribute("open");
  });
  playlistAddSingleFileInput?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    await handleOpenSceneFile?.(file, { activate: false });
  });
  playlistAddTjzFileInput?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    await handleOpenSceneFile?.(file, { activate: false });
  });
  playlistFolderInput?.addEventListener("change", async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    await appendFilesToPlaylistOnly?.(files);
  });

  sceneJsonFileInput?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) {
      await handleOpenSceneFile?.(file, { activate: true });
    }
  });
  tjzArchiveFileInput?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) {
      await handleOpenSceneFile?.(file, { activate: true });
    }
  });
  nativeThreeJsonFileInput?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) {
      await handleLoadNativeThreeJsonFile?.(file);
    }
  });

  closeJsonBtn?.addEventListener("click", closeSceneJsonModal);
  copyJsonBtn?.addEventListener("click", () => {
    void copySceneJsonToClipboard();
  });
  sceneJsonModal?.addEventListener("click", (event) => {
    if (event.target === sceneJsonModal) {
      closeSceneJsonModal();
    }
  });
  helpAboutCloseBtn?.addEventListener("click", closeHelpAboutModal);
  helpAboutModal?.addEventListener("click", (event) => {
    if (event.target === helpAboutModal) {
      closeHelpAboutModal();
    }
  });

  document.addEventListener(
    "click",
    (event) => {
      if (!event.target.closest(".topMenu")) {
        closeAllTopMenus();
      }
      if (!event.target.closest(".playlistAddMenu")) {
        playlistAddMenu?.removeAttribute("open");
      }
    },
    true
  );

  document.addEventListener("fullscreenchange", syncFullscreenToggleLabels);
  syncFullscreenToggleLabels();

  return {
    openSceneJsonModal,
    openSceneJsonPicker,
    closeAllTopMenus
  };
}

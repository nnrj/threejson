import { t } from "../../shared/i18n/index.js";

export const DEFAULT_EVENT_NOTICE =
  "操作指南：左键旋转，右键拖动，滚轮缩放；场景树单击高亮，双击高亮+描边+编辑。";

export function createEditorChromeUi(host) {
  const rootContainer = document.getElementById("rootContainer");
  const eventNoticeEl = document.getElementById("eventNotice");

  function setEventNotice(message) {
    if (eventNoticeEl) {
      eventNoticeEl.textContent = message;
    }
  }

  function syncEditorMuteUi() {
    const muted = host.getAudioMuted?.() ?? false;
    const label = muted
      ? t("editor.shell.topBarBtnUnmuteAudio", "Unmute")
      : t("editor.shell.topBarBtnMuteAudio", "Mute");
    const title = muted
      ? t("editor.shell.topBarBtnUnmuteAudio.title", "Resume audio playback in the current scene")
      : t("editor.shell.topBarBtnMuteAudio.title", "Pause audio playback in the current scene");
    for (const id of ["menuMuteAudio", "topBarBtnMuteAudio"]) {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = label;
        el.title = title;
      }
    }
  }

  function toggleEditorSceneAudioMute() {
    const roots = host.getEditorAudioRoots?.() ?? {};
    if (!roots.camera && !roots.scene) {
      host.showMessage(t("editor.message.audioSceneNotReady", "Scene is not ready; cannot change audio mute state."), "warning");
      return;
    }
    const next = !(host.getAudioMuted?.() ?? false);
    host.setAudioMuted?.(next);
    if (next) {
      host.pauseSceneAudio?.(roots.camera, roots.scene);
    } else {
      host.resumeSceneAudio?.(roots.camera, roots.scene);
    }
    syncEditorMuteUi();
  }

  function syncFullscreenToggleLabels() {
    const full = !!document.fullscreenElement;
    const txt = full
      ? t("editor.shell.fullscreenExit", "Exit Fullscreen")
      : t("editor.shell.fullscreenBtn", "Fullscreen");
    const toolbarBtn = document.getElementById("fullscreenBtn");
    if (toolbarBtn) {
      toolbarBtn.textContent = txt;
    }
    const menuBtn = document.getElementById("menuFullscreenToggle");
    if (menuBtn) {
      menuBtn.textContent = txt;
    }
  }

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        await rootContainer?.requestFullscreen();
        host.showMessage(t("editor.message.fullscreenHint", "Press Esc to exit fullscreen."), "info");
      } else {
        await document.exitFullscreen();
      }
    } catch (error) {
      console.error(error);
      host.showMessage(t("editor.message.fullscreenFailed", "Fullscreen operation failed."), "warning");
    }
    syncFullscreenToggleLabels();
  }

  function init() {
    applyStatusBarHintFromSettings(host.getEditorSettings?.());
    syncEditorMuteUi();
    syncFullscreenToggleLabels();
    document.addEventListener("fullscreenchange", syncFullscreenToggleLabels);
  }

  function applyStatusBarHintFromSettings(settings) {
    const hint = settings?.editing?.statusBarHint;
    if (hint) {
      setEventNotice(hint);
    }
  }

  return {
    init,
    setEventNotice,
    applyStatusBarHintFromSettings,
    syncEditorMuteUi,
    toggleEditorSceneAudioMute,
    syncFullscreenToggleLabels,
    toggleFullscreen
  };
}

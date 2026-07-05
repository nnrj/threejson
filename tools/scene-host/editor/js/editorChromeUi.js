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
    const label = muted ? "取消静音" : "静音";
    const title = muted ? "恢复当前场景音频播放" : "暂停当前场景音频播放";
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
      host.showMessage("场景尚未就绪，无法静音。", "warning");
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
    const txt = full ? "退出全屏" : "全屏";
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
        host.showMessage("按 ESC 可退出全屏。", "info");
      } else {
        await document.exitFullscreen();
      }
    } catch (error) {
      console.error(error);
      host.showMessage("全屏操作失败。", "warning");
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

import { EDITOR_SETTINGS_DEFAULTS, LOADING_MASK_ACTIVITY_FRAMES } from "../../shared/js/editorSettingsSchema.js";
import { getLoadingMaskDefaultText } from "../../shared/js/editorSettingsStore.js";
import { openOrCloseProgressManager, showProgressMessage } from "threejson";

export function createUiFeedback({ editorSettingsRef, getEditorSettings, getSysConfig }) {
  const messageBox = document.getElementById("messageBox");
  const loadingMask = document.getElementById("loadingMask");
  const loadingMaskMessage = document.getElementById("loadingMaskMessage");
  const loadingMaskActivity = document.getElementById("loadingMaskActivity");
  let loadingActivityTimer = null;
  let loadingActivityFrameIndex = 0;
  let messageTimer = null;

  function getToastDuration() {
    const s = getEditorSettings?.() || editorSettingsRef.current;
    return s?.general?.messageToastDurationMs ?? EDITOR_SETTINGS_DEFAULTS.general.messageToastDurationMs;
  }

  function showMessage(text, type = "info") {
    if (!messageBox) {
      return;
    }
    const colorMap = {
      info: "rgba(20, 20, 20, 0.82)",
      success: "rgba(46, 125, 50, 0.88)",
      warning: "rgba(176, 118, 0, 0.9)",
      error: "rgba(180, 35, 24, 0.9)"
    };
    messageBox.textContent = String(text || "");
    messageBox.style.background = colorMap[type] || colorMap.info;
    messageBox.className = type;
    messageBox.style.display = "block";
    if (messageTimer) {
      window.clearTimeout(messageTimer);
    }
    messageTimer = window.setTimeout(() => {
      messageBox.style.display = "none";
    }, getToastDuration());
  }

  function stopLoadingActivity() {
    if (loadingActivityTimer) {
      window.clearInterval(loadingActivityTimer);
      loadingActivityTimer = null;
    }
    if (loadingMaskActivity) {
      loadingMaskActivity.hidden = true;
      loadingMaskActivity.setAttribute("aria-hidden", "true");
      loadingMaskActivity.textContent = "";
    }
  }

  function startLoadingActivity(
    frames = LOADING_MASK_ACTIVITY_FRAMES,
    intervalMs = getEditorSettings?.()?.general?.loadingActivityIntervalMs ?? 120
  ) {
    stopLoadingActivity();
    if (!loadingMaskActivity || !Array.isArray(frames) || !frames.length) {
      return;
    }
    loadingActivityFrameIndex = 0;
    loadingMaskActivity.textContent = frames[0];
    loadingMaskActivity.hidden = false;
    loadingMaskActivity.removeAttribute("aria-hidden");
    loadingActivityTimer = window.setInterval(() => {
      loadingActivityFrameIndex = (loadingActivityFrameIndex + 1) % frames.length;
      loadingMaskActivity.textContent = frames[loadingActivityFrameIndex];
    }, Math.max(60, intervalMs));
  }

  function setLoadingMaskMessage(message) {
    const s = getEditorSettings?.() || editorSettingsRef.current;
    const text =
      message != null && String(message).length > 0
        ? String(message)
        : getLoadingMaskDefaultText(s);
    if (loadingMaskMessage) {
      loadingMaskMessage.textContent = text;
    }
  }

  function setLoading(on, options = {}) {
    if (!loadingMask) {
      return;
    }
    if (on) {
      loadingMask.style.display = "flex";
      if (options.showActivity) {
        startLoadingActivity();
      }
    } else {
      loadingMask.style.display = "none";
      stopLoadingActivity();
    }
  }

  function setLoadingMessage(message) {
    setLoading(true);
    setLoadingMaskMessage(message);
    if (loadingMaskMessage) {
      showProgressMessage("loadingMaskMessage", message);
    } else if (loadingMask) {
      showProgressMessage("loadingMask", message);
    }
    if (getSysConfig?.()?.progressFlag) {
      openOrCloseProgressManager(true);
    }
  }

  function yieldToMain() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
  }

  async function runWithLoadingMask(message, task, options = {}) {
    const { showActivity = false } = options;
    const oldText = loadingMaskMessage?.textContent || getLoadingMaskDefaultText(getEditorSettings?.());
    if (message) {
      setLoadingMaskMessage(message);
    }
    setLoading(true, { showActivity });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    try {
      return await task(setLoadingMaskMessage, yieldToMain);
    } finally {
      stopLoadingActivity();
      setLoadingMaskMessage(oldText);
      setLoading(false);
    }
  }

  return { showMessage, setLoading, setLoadingMessage, setLoadingMaskMessage, runWithLoadingMask };
}

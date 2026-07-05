import {
  isEditorPreviewUrl,
  isScenePreviewMessageEvent,
  postScenePreviewMessage
} from "../../shared/js/scenePreviewProtocol.js";

/**
 * @param {object} options
 * @param {(payload: object, ctx: { bindSceneEvents?: boolean, label?: string }) => Promise<void>} options.applyPreviewPayload
 * @param {(text: string, kind?: string) => void} [options.showMessage]
 * @param {() => void} [options.hideStartupEmptyState]
 * @param {() => void} [options.setLoading]
 * @param {(text: string) => void} [options.setLoadingMessage]
 */
export function createPlayerEditorPreviewBridge(options) {
  const {
    applyPreviewPayload,
    showMessage,
    hideStartupEmptyState,
    setLoading,
    setLoadingMessage
  } = options;

  const active = isEditorPreviewUrl();
  let installed = false;
  let loadingGeneration = 0;

  function notifyEditorReady() {
    if (!window.opener || window.opener.closed) {
      return;
    }
    postScenePreviewMessage(window.opener, { action: "ready" });
  }

  function notifyEditorLoaded(ok, errorMessage = "") {
    if (!window.opener || window.opener.closed) {
      return;
    }
    postScenePreviewMessage(window.opener, {
      action: "loaded",
      ok: Boolean(ok),
      error: errorMessage || undefined
    });
  }

  async function handleLoadMessage(data) {
    const gen = ++loadingGeneration;
    hideStartupEmptyState?.();
    setLoading?.(true);
    setLoadingMessage?.("正在加载编辑器预览场景...");
    try {
      const payload = data.payload;
      if (!payload || typeof payload !== "object") {
        throw new Error("预览消息缺少有效 payload。");
      }
      await applyPreviewPayload(payload, {
        bindSceneEvents: data.bindSceneEvents,
        label: data.label
      });
      if (gen !== loadingGeneration) {
        return;
      }
      notifyEditorLoaded(true);
      showMessage?.("已加载编辑器预览场景。", "success");
    } catch (error) {
      if (gen !== loadingGeneration) {
        return;
      }
      const message = String(error.message || error);
      notifyEditorLoaded(false, message);
      showMessage?.(message, "error");
      console.warn("[player preview]", error);
    } finally {
      if (gen === loadingGeneration) {
        setLoading?.(false);
      }
    }
  }

  function installMessageListener() {
    if (installed) {
      return;
    }
    installed = true;
    window.addEventListener("message", (event) => {
      if (!isScenePreviewMessageEvent(event)) {
        return;
      }
      if (window.opener && event.source !== window.opener) {
        return;
      }
      if (event.data?.action === "load") {
        void handleLoadMessage(event.data);
      }
    });
  }

  function bootstrap() {
    if (!active) {
      return false;
    }
    installMessageListener();
    hideStartupEmptyState?.();
    setLoadingMessage?.("等待编辑器推送场景…");
    setLoading?.(true);
    window.setTimeout(() => notifyEditorReady(), 0);
    window.setTimeout(notifyEditorReady, 250);
    return true;
  }

  return {
    isActive: () => active,
    bootstrap,
    installMessageListener,
    notifyEditorReady
  };
}

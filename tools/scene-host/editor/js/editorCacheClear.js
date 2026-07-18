import {
  EDITOR_SCENE_SNAPSHOT_KEY,
  editorSessionIdbDelete
} from "../../shared/js/editorSessionIdb.js";
import { clearEditorSettingsCache } from "../../shared/js/editorSettingsStore.js";
import { clearScenePresetsCache } from "../../shared/js/scenePresetsStore.js";
import { EDITOR_USER_BASELINE_KEY } from "../../shared/js/userBaselineStore.js";
import { clearAllAiChatHistory } from "./editorAiChatStore.js";

export function createEditorCacheClear(host) {
  const modal = document.getElementById("clearCacheModal");
  const cancelBtn = document.getElementById("clearCacheModalCancelBtn");
  const confirmBtn = document.getElementById("clearCacheModalConfirmBtn");
  const scopeSession = document.getElementById("clearCacheScopeSession");
  const scopeRecent = document.getElementById("clearCacheScopeRecent");
  const scopeBaseline = document.getElementById("clearCacheScopeBaseline");
  const scopePresets = document.getElementById("clearCacheScopePresets");
  const scopeAiChat = document.getElementById("clearCacheScopeAiChat");
  const scopeSettings = document.getElementById("clearCacheScopeSettings");

  async function clearSceneBaselineAndSnapshots() {
    try {
      await editorSessionIdbDelete(EDITOR_USER_BASELINE_KEY);
      await editorSessionIdbDelete(EDITOR_SCENE_SNAPSHOT_KEY);
    } catch (error) {
      console.warn("[scene-editor cache] clear baseline/snapshot failed:", error);
    }
  }

  async function clearByScope(scopes = {}) {
    if (scopes.session) {
      await host.getSessionRecovery?.()?.clearSessionStore?.();
    }
    if (scopes.recent) {
      await host.getRecentScenes()?.clearHistory?.();
    }
    if (scopes.baseline) {
      await clearSceneBaselineAndSnapshots();
    }
    if (scopes.presets) {
      await clearScenePresetsCache();
    }
    if (scopes.aiChat) {
      await clearAllAiChatHistory();
    }
    if (scopes.settings) {
      clearEditorSettingsCache();
    }
  }

  function openModal() {
    modal?.classList.add("visible");
    host.closeAllDropdowns?.();
  }

  function closeModal() {
    modal?.classList.remove("visible");
  }

  function wireMenu() {
    document.getElementById("menuClearAllCache")?.addEventListener("click", openModal);
    cancelBtn?.addEventListener("click", closeModal);
    modal?.addEventListener("click", (event) => {
      if (event.target === modal) {
        closeModal();
      }
    });
    confirmBtn?.addEventListener("click", async () => {
      await clearByScope({
        session: scopeSession?.checked !== false,
        recent: scopeRecent?.checked !== false,
        baseline: scopeBaseline?.checked !== false,
        presets: scopePresets?.checked !== false,
        aiChat: scopeAiChat?.checked !== false,
        settings: scopeSettings?.checked === true
      });
      closeModal();
      host.showMessage("缓存已清除。", "success");
    });
  }

  return {
    wireMenu,
    clearByScope,
    openModal,
    closeModal
  };
}

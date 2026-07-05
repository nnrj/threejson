import { sceneToStandardJsonSimple, sceneToJson } from "threejson";

export function createEditorHelpAndSceneJson(host) {
  const sceneJsonModal = document.getElementById("sceneJsonModal");
  const sceneJsonContent = document.getElementById("sceneJsonContent");
  const helpAboutModal = document.getElementById("helpAboutModal");

  async function captureSceneJsonTextForView() {
    await host.ensureCanvasSyncedBeforeExport?.();
    const scene = host.getScene();
    if (!scene?.isScene) {
      throw new Error("场景尚未初始化。");
    }
    const displayOpts = host.buildSceneToJsonOptionsForDisplay?.({ merge: false }) ?? {
      ...host.buildSceneToJsonOptions?.({ merge: false, format: "standard" }),
      merge: false,
      format: "standard"
    };
    const indent = host.getEditorSettings()?.io?.exportJsonIndent ?? 2;
    if (displayOpts.format === "friendly") {
      const friendlyPayload = await sceneToJson(scene, displayOpts);
      return JSON.stringify(friendlyPayload, null, indent);
    }
    const payload = sceneToStandardJsonSimple(scene, displayOpts);
    return JSON.stringify(payload, null, indent);
  }

  async function openSceneJsonModal() {
    try {
      const text = await host.runWithLoadingMask("正在生成场景 JSON...", () => captureSceneJsonTextForView());
      if (sceneJsonContent) {
        sceneJsonContent.value = text;
      }
      sceneJsonModal?.classList.add("visible");
    } catch (error) {
      console.error(error);
      host.showMessage(`JSON 生成失败：${error?.message || error}`, "error");
    }
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

  async function copySceneJsonToClipboard() {
    const content = sceneJsonContent?.value || "";
    if (!content) {
      return;
    }
    try {
      await navigator.clipboard.writeText(content);
      host.showMessage("JSON 已复制到剪贴板。", "success");
    } catch (error) {
      console.error(error);
      host.showMessage("复制失败，请手动复制。", "warning");
    }
  }

  async function openEditSceneJsonFromMenu() {
    const ok = await host.getAiSidebar?.()?.interruptAiSessionIfActive?.("进入代码编辑");
    if (!ok) {
      return;
    }
    await host.getCodeEditor()?.enterCodeMode?.();
  }

  function init() {
    document.getElementById("menuViewSceneJson")?.addEventListener("click", () => {
      void openSceneJsonModal();
      host.closeAllDropdowns?.();
    });
    document.getElementById("menuEditSceneJson")?.addEventListener("click", () => {
      void openEditSceneJsonFromMenu();
      host.closeAllDropdowns?.();
    });
    document.getElementById("menuHelpUserManual")?.addEventListener("click", () => {
      host.closeAllDropdowns?.();
      host.showMessage("正在建设中的功能，敬请期待。", "info");
    });
    document.getElementById("menuHelpAbout")?.addEventListener("click", () => {
      host.closeAllDropdowns?.();
      openHelpAboutModal();
    });
    document.getElementById("helpAboutCloseBtn")?.addEventListener("click", closeHelpAboutModal);
    document.getElementById("closeJsonBtn")?.addEventListener("click", closeSceneJsonModal);
    document.getElementById("copyJsonBtn")?.addEventListener("click", () => {
      void copySceneJsonToClipboard();
    });
    sceneJsonModal?.addEventListener("click", (event) => {
      if (event.target === sceneJsonModal) {
        closeSceneJsonModal();
      }
    });
    helpAboutModal?.addEventListener("click", (event) => {
      if (event.target === helpAboutModal) {
        closeHelpAboutModal();
      }
    });
  }

  return {
    init,
    openSceneJsonModal,
    closeSceneJsonModal,
    captureSceneJsonTextForView
  };
}

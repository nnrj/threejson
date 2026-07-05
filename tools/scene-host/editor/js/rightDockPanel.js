export function createRightDockPanel(host) {
  const tabs = {
    sceneTree: document.getElementById("rightSubTabSceneTree"),
    events: document.getElementById("rightSubTabEvents"),
    sceneJson: document.getElementById("rightSubTabSceneJson"),
    assetLibrary: document.getElementById("rightSubTabAssetLibrary")
  };
  const panels = {
    sceneTree: document.getElementById("rightSubPanelSceneTree"),
    events: document.getElementById("rightSubPanelEvents"),
    sceneJson: document.getElementById("rightSubPanelSceneJson"),
    assetLibrary: document.getElementById("rightSubPanelAssetLibrary")
  };

  let active = "sceneTree";

  function switchTab(which) {
    active = which;
    const showSceneTree = which === "sceneTree";
    const showEvents = which === "events";
    const showSceneJson = which === "sceneJson";
    const showAssetLibrary = which === "assetLibrary";

    if (panels.sceneTree) panels.sceneTree.hidden = !showSceneTree;
    if (panels.events) panels.events.hidden = !showEvents;
    if (panels.sceneJson) panels.sceneJson.hidden = !showSceneJson;
    if (panels.assetLibrary) panels.assetLibrary.hidden = !showAssetLibrary;

    tabs.sceneTree?.setAttribute("aria-selected", showSceneTree ? "true" : "false");
    tabs.events?.setAttribute("aria-selected", showEvents ? "true" : "false");
    tabs.sceneJson?.setAttribute("aria-selected", showSceneJson ? "true" : "false");
    tabs.assetLibrary?.setAttribute("aria-selected", showAssetLibrary ? "true" : "false");

    tabs.sceneTree?.classList.toggle("rightSubTabSelected", showSceneTree);
    tabs.events?.classList.toggle("rightSubTabSelected", showEvents);
    tabs.sceneJson?.classList.toggle("rightSubTabSelected", showSceneJson);
    tabs.assetLibrary?.classList.toggle("rightSubTabSelected", showAssetLibrary);

    if (showSceneTree) {
      requestAnimationFrame(() => host.getSceneTree()?.render());
    }
    if (showEvents) {
      host.getEventEditorPanel()?.syncFromSelection?.();
    }
    if (showSceneJson) {
      host.getSceneManagePanel()?.bindFromPayload?.();
    }
    if (showAssetLibrary) {
      host.getAssetLibraryPanel()?.render();
    }
  }

  tabs.sceneTree?.addEventListener("click", () => switchTab("sceneTree"));
  tabs.events?.addEventListener("click", () => switchTab("events"));
  tabs.sceneJson?.addEventListener("click", () => switchTab("sceneJson"));
  tabs.assetLibrary?.addEventListener("click", () => switchTab("assetLibrary"));

  return {
    switchTab,
    getActiveTab: () => active
  };
}

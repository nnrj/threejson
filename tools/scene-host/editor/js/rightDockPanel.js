export function createRightDockPanel(host) {
  const tabs = {
    sceneTree: document.getElementById("rightSubTabSceneTree"),
    events: document.getElementById("rightSubTabEvents"),
    sceneJson: document.getElementById("rightSubTabSceneJson")
  };
  const panels = {
    sceneTree: document.getElementById("rightSubPanelSceneTree"),
    events: document.getElementById("rightSubPanelEvents"),
    sceneJson: document.getElementById("rightSubPanelSceneJson")
  };

  let active = "sceneTree";

  function switchTab(which) {
    active = which;
    const showSceneTree = which === "sceneTree";
    const showEvents = which === "events";
    const showSceneJson = which === "sceneJson";

    if (panels.sceneTree) panels.sceneTree.hidden = !showSceneTree;
    if (panels.events) panels.events.hidden = !showEvents;
    if (panels.sceneJson) panels.sceneJson.hidden = !showSceneJson;

    tabs.sceneTree?.setAttribute("aria-selected", showSceneTree ? "true" : "false");
    tabs.events?.setAttribute("aria-selected", showEvents ? "true" : "false");
    tabs.sceneJson?.setAttribute("aria-selected", showSceneJson ? "true" : "false");

    tabs.sceneTree?.classList.toggle("rightSubTabSelected", showSceneTree);
    tabs.events?.classList.toggle("rightSubTabSelected", showEvents);
    tabs.sceneJson?.classList.toggle("rightSubTabSelected", showSceneJson);

    if (showSceneTree) {
      requestAnimationFrame(() => host.getSceneTree()?.render());
    }
    if (showEvents) {
      host.getEventEditorPanel()?.syncFromSelection?.();
    }
    if (showSceneJson) {
      host.getSceneManagePanel()?.bindFromPayload?.();
    }
  }

  tabs.sceneTree?.addEventListener("click", () => switchTab("sceneTree"));
  tabs.events?.addEventListener("click", () => switchTab("events"));
  tabs.sceneJson?.addEventListener("click", () => switchTab("sceneJson"));

  return {
    switchTab,
    getActiveTab: () => active
  };
}

/** Left dock's own tab bar: "组件" (the object/preset drag-in palette, modelGroupPanel.js /
 * presetScenePanel.js), "资源" (assetLibraryPanel.js, relocated here from the right dock), "AI 生成"
 * (editorAiGeneratePanel.js) and "AI 调整" (editorAiAdjustPanel.js) — split into two explicit-intent
 * tabs rather than one merged "AI 编辑" tab, so the user picks generate-vs-adjust by tab instead of
 * an LLM intent-classifier guessing per turn. Mirrors rightDockPanel.js's pattern. */
export function createLeftDockPanel(host) {
  const tabs = {
    builtin: document.getElementById("leftSubTabBuiltin"),
    assetLibrary: document.getElementById("leftSubTabAssetLibrary"),
    aiGenerate: document.getElementById("leftSubTabAiGenerate"),
    aiAdjust: document.getElementById("leftSubTabAiAdjust")
  };
  const panels = {
    builtin: document.getElementById("leftSubPanelBuiltin"),
    assetLibrary: document.getElementById("leftSubPanelAssetLibrary"),
    aiGenerate: document.getElementById("leftSubPanelAiGenerate"),
    aiAdjust: document.getElementById("leftSubPanelAiAdjust")
  };

  let active = "builtin";

  function switchTab(which) {
    active = which;
    const showBuiltin = which === "builtin";
    const showAssetLibrary = which === "assetLibrary";
    const showAiGenerate = which === "aiGenerate";
    const showAiAdjust = which === "aiAdjust";

    if (panels.builtin) panels.builtin.hidden = !showBuiltin;
    if (panels.assetLibrary) panels.assetLibrary.hidden = !showAssetLibrary;
    if (panels.aiGenerate) panels.aiGenerate.hidden = !showAiGenerate;
    if (panels.aiAdjust) panels.aiAdjust.hidden = !showAiAdjust;

    tabs.builtin?.setAttribute("aria-selected", showBuiltin ? "true" : "false");
    tabs.assetLibrary?.setAttribute("aria-selected", showAssetLibrary ? "true" : "false");
    tabs.aiGenerate?.setAttribute("aria-selected", showAiGenerate ? "true" : "false");
    tabs.aiAdjust?.setAttribute("aria-selected", showAiAdjust ? "true" : "false");

    tabs.builtin?.classList.toggle("leftSubTabSelected", showBuiltin);
    tabs.assetLibrary?.classList.toggle("leftSubTabSelected", showAssetLibrary);
    tabs.aiGenerate?.classList.toggle("leftSubTabSelected", showAiGenerate);
    tabs.aiAdjust?.classList.toggle("leftSubTabSelected", showAiAdjust);

    if (showAssetLibrary) {
      host.getAssetLibraryPanel()?.render();
    }
    if (showAiGenerate) {
      host.getAiGeneratePanel()?.onShown?.();
    }
    if (showAiAdjust) {
      host.getAiAdjustPanel()?.onShown?.();
    }
  }

  tabs.builtin?.addEventListener("click", () => switchTab("builtin"));
  tabs.assetLibrary?.addEventListener("click", () => switchTab("assetLibrary"));
  tabs.aiGenerate?.addEventListener("click", () => switchTab("aiGenerate"));
  tabs.aiAdjust?.addEventListener("click", () => switchTab("aiAdjust"));

  function init() {
    switchTab("builtin");
  }

  return {
    init,
    switchTab,
    getActiveTab: () => active
  };
}

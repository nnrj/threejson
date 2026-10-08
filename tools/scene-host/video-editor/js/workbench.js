import { $, element } from "./ui.js";

const modes = ["video", "code", "mixed"];
const preferenceKey = "threejson.videoEditor.workspace.v1";
const defaultLayouts = {
  video: { library: true, inspector: true, timeline: true },
  code: { library: false, inspector: false, timeline: false },
  mixed: { library: false, inspector: true, timeline: true },
};

// Layout is a host preference, never serialized into the media document.
export function normalizeWorkspacePreferences(value) {
  const result = { mode: modes.includes(value?.mode) ? value.mode : "video", split: 50, layouts: structuredClone(defaultLayouts) };
  if (Number.isFinite(value?.split)) result.split = Math.min(75, Math.max(25, value.split));
  for (const mode of modes) for (const panel of Object.keys(defaultLayouts[mode])) {
    if (typeof value?.layouts?.[mode]?.[panel] === "boolean") result.layouts[mode][panel] = value.layouts[mode][panel];
  }
  return result;
}

// Menu commands and toolbar/keyboard commands dispatch to the same application
// actions; view-only changes never create a session or mutate the project.
export function createWorkbench({ run, enabled, onModeChange }) {
  const workspace = document.querySelector(".workspace"), popup = $("menuPopup"), menubar = $("menubar");
  let state;
  try { state = normalizeWorkspacePreferences(JSON.parse(localStorage.getItem(preferenceKey))); }
  catch { state = normalizeWorkspacePreferences(); }
  let openIndex = -1;
  const persist = () => { try { localStorage.setItem(preferenceKey, JSON.stringify(state)); } catch { /* Optional UI preference. */ } };
  const panelVisible = panel => state.layouts[state.mode][panel];
  const internal = {
    viewVideo: () => setMode("video"), viewCode: () => setMode("code"), viewMixed: () => setMode("mixed"),
    toggleLibrary: () => toggle("library"), toggleInspector: () => toggle("inspector"), toggleTimeline: () => toggle("timeline"),
    resetLayout: () => { state = normalizeWorkspacePreferences(); workspace.dataset.panel = "center"; refresh(); persist(); onModeChange(state.mode); },
  };
  const item = (id, label, shortcut, checked) => ({ id, label, shortcut, checked });
  const menus = [
    { label: "文件", items: [
      item("newProject", "新建视频工程"), item("recentProjects", "最近工程…"), item("importFiles", "导入工程 / 素材…", "Ctrl+O"),
      item("demoProject", "打开示例工程"), null,
      item("savePack", "下载 .tjz 工程包", "Ctrl+S"), item("saveJson", "下载 JSON（含本地素材）"), null,
      item("exportMedia", "导出视频 / 图片…"),
    ] },
    { label: "编辑", items: [
      item("undo", "撤销工程操作", "Ctrl+Z"), item("redo", "重做工程操作", "Ctrl+Shift+Z"), null,
      item("loadJson", "重新读取 JSON…"), item("formatJson", "格式化 JSON 草稿"),
      item("applyJson", "校验并应用 JSON", "Ctrl+Enter"), item("downloadDraft", "备份 JSON 草稿"),
    ] },
    { label: "片段", items: [
      item("addScene", "新建 3D 镜头"), item("addCaption", "在播放头处添加字幕"), null,
      item("split", "在播放头处分割", "Ctrl+B"), item("duplicate", "复制选中片段"),
      item("deleteClip", "删除（保留空隙）", "Delete"), item("rippleDelete", "波纹删除…"), null,
      item("editShotJson", "编辑当前镜头 JSON"), item("openShotEditor", "在场景编辑器中编辑…"), item("editTransition", "设置入场转场…"),
    ] },
    { label: "序列", items: [
      item("outputSettings", "序列设置 · 尺寸与帧率…"), item("play", "播放 / 暂停", "Space"),
      item("seekStart", "回到开头", "Home"), item("fitTimeline", "时间线适配工程"), null,
      item("toggleSnap", "片段吸附", undefined, () => $("snap").checked),
      item("toggleSound", "预览声音", undefined, () => $("previewSound").checked), null,
      item("addMusic", "添加电子合成配乐"), item("narration", "从字幕 / 台词合成本地旁白"),
    ] },
    { label: "视图", items: [
      item("viewVideo", "视频视图", "Alt+1", () => state.mode === "video"),
      item("viewCode", "代码视图", "Alt+2", () => state.mode === "code"),
      item("viewMixed", "混合视图", "Alt+3", () => state.mode === "mixed"), null,
      item("toggleLibrary", "素材与 AI 面板", undefined, () => panelVisible("library")),
      item("toggleInspector", "片段属性面板", undefined, () => panelVisible("inspector")),
      item("toggleTimeline", "时间线面板", undefined, () => panelVisible("timeline")), null,
      item("resetLayout", "恢复默认布局"),
    ] },
    { label: "AI", items: [
      item("showAi", "打开视频 AI 助手"), item("aiSettings", "AI 供应商与生成设置…"), null,
      item("runAi", "按输入要求生成 / 调整视频"), item("cancelJob", "停止当前任务"),
    ] },
    { label: "帮助", items: [item("editorHelp", "编辑工作流与快捷键…")] },
  ];

  function close(focus = false) {
    const button = menubar.children[openIndex];
    popup.hidden = true; openIndex = -1;
    for (const node of menubar.children) node.setAttribute("aria-expanded", "false");
    if (focus) button?.focus();
  }
  function positionPopup() {
    if (openIndex < 0) return;
    const rect = menubar.children[openIndex].getBoundingClientRect();
    popup.style.maxHeight = `${Math.max(80, innerHeight - rect.bottom - 16)}px`;
    popup.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - popup.offsetWidth - 8))}px`;
    popup.style.top = `${rect.bottom + 4}px`;
  }
  const isEnabled = id => Boolean(internal[id]) || enabled(id);
  function refreshMenu() {
    if (openIndex < 0) return;
    const items = menus[openIndex].items;
    for (const button of popup.querySelectorAll("[data-action]")) {
      const entry = items.find(item => item?.id === button.dataset.action);
      button.disabled = !isEnabled(entry.id);
      if (entry.checked) {
        const checked = entry.checked();
        button.setAttribute("aria-checked", String(checked));
        button.querySelector(".menuCheck").textContent = checked ? "✓" : "";
      }
    }
  }
  function open(index, focus = false) {
    close(); openIndex = index;
    const menu = menus[index];
    menubar.children[index].setAttribute("aria-expanded", "true");
    popup.setAttribute("aria-label", `${menu.label}菜单`);
    popup.replaceChildren(...menu.items.map(entry => {
      if (!entry) return element("hr", { role: "separator" });
      const button = element("button", { type: "button", role: entry.checked ? "menuitemcheckbox" : "menuitem", "data-action": entry.id, tabindex: "-1" });
      button.append(element("span", { class: "menuCheck", "aria-hidden": "true" }), element("span", { class: "menuLabel" }, entry.label));
      if (entry.shortcut) button.append(element("kbd", {}, entry.shortcut));
      button.addEventListener("click", () => { close(true); if (isEnabled(entry.id)) { if (internal[entry.id]) internal[entry.id](); else run(entry.id); } });
      return button;
    }));
    popup.hidden = false; refreshMenu(); positionPopup();
    if (focus) popup.querySelector("button:not(:disabled)")?.focus();
  }
  menus.forEach((menu, index) => {
    const button = element("button", { type: "button", role: "menuitem", "aria-haspopup": "menu", "aria-expanded": "false", "aria-controls": "menuPopup", tabindex: index ? "-1" : "0" }, menu.label);
    button.addEventListener("click", () => openIndex === index ? close() : open(index, true));
    button.addEventListener("pointerenter", event => { if (event.pointerType === "mouse" && openIndex >= 0 && openIndex !== index) open(index); });
    button.addEventListener("focus", () => { for (const node of menubar.children) node.tabIndex = node === button ? 0 : -1; });
    menubar.append(button);
  });
  document.addEventListener("pointerdown", event => { if (!popup.contains(event.target) && !menubar.contains(event.target)) close(); });
  document.addEventListener("focusin", event => { if (openIndex >= 0 && !popup.contains(event.target) && !menubar.contains(event.target)) close(); });
  document.addEventListener("keydown", event => {
    const inBar = menubar.contains(event.target), inMenu = popup.contains(event.target);
    if (!inBar && !inMenu) return;
    const index = inBar ? [...menubar.children].indexOf(event.target) : openIndex;
    if (event.key === "Escape") { event.preventDefault(); close(true); }
    else if (event.key === "Tab") close(true);
    else if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      const next = (index + (event.key === "ArrowLeft" ? -1 : 1) + menus.length) % menus.length;
      menubar.children[next].focus(); if (openIndex >= 0 || inMenu) open(next, true);
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (inBar) { open(index, true); return; }
      const buttons = [...popup.querySelectorAll("button:not(:disabled)")], at = buttons.indexOf(document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (at + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  });
  menubar.addEventListener("scroll", positionPopup);
  window.addEventListener("resize", () => { positionPopup(); updateOrientation(); });
  document.querySelectorAll("[data-mode]").forEach(button => {
    if (button.tagName === "BUTTON") button.addEventListener("click", () => setMode(button.dataset.mode));
  });
  document.querySelectorAll(".mobileTabs [data-panel]").forEach(button => button.addEventListener("click", () => showPanel(button.dataset.panel)));

  function refresh() {
    workspace.dataset.mode = state.mode;
    for (const panel of ["library", "inspector"]) workspace.classList.toggle(`no-${panel}`, !panelVisible(panel));
    document.querySelector(".timelinePanel").hidden = !panelVisible("timeline");
    workspace.style.setProperty("--split", `${state.split}%`);
    $("workspaceDivider").setAttribute("aria-valuenow", String(Math.round(state.split)));
    for (const button of document.querySelectorAll(".viewModes button")) button.setAttribute("aria-pressed", String(button.dataset.mode === state.mode));
    for (const button of document.querySelectorAll(".mobileTabs button")) button.setAttribute("aria-pressed", String(button.dataset.panel === workspace.dataset.panel));
    refreshMenu(); updateOrientation();
  }
  function setMode(mode) {
    if (!modes.includes(mode)) return;
    state.mode = mode; workspace.dataset.panel = "center";
    refresh(); persist(); onModeChange(mode);
  }
  function showPanel(panel) {
    if (panel !== "timeline") workspace.dataset.panel = panel;
    if (["library", "inspector", "timeline"].includes(panel)) state.layouts[state.mode][panel] = true;
    refresh(); persist();
  }
  function toggle(panel) {
    state.layouts[state.mode][panel] = !panelVisible(panel);
    if (innerWidth <= 800 && panel !== "timeline") workspace.dataset.panel = panelVisible(panel) ? panel : "center";
    refresh(); persist();
  }
  const verticalStack = () => getComputedStyle(document.querySelector(".centerWorkspace")).flexDirection === "column";
  function updateOrientation() { $("workspaceDivider").setAttribute("aria-orientation", verticalStack() ? "horizontal" : "vertical"); }
  function setSplit(value) { state.split = Math.min(75, Math.max(25, value)); refresh(); }
  const divider = $("workspaceDivider");
  divider.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    setSplit(event.key === "Home" ? 25 : event.key === "End" ? 75 : state.split + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -5 : 5)); persist();
  });
  divider.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    event.preventDefault(); divider.focus(); divider.setPointerCapture(event.pointerId);
    const stack = verticalStack(), rect = document.querySelector(".centerWorkspace").getBoundingClientRect();
    const move = event => setSplit(100 * (stack ? (event.clientY - rect.top) / rect.height : (event.clientX - rect.left) / rect.width));
    const finish = () => { divider.removeEventListener("pointermove", move); divider.removeEventListener("pointerup", finish); divider.removeEventListener("pointercancel", finish); persist(); };
    divider.addEventListener("pointermove", move); divider.addEventListener("pointerup", finish); divider.addEventListener("pointercancel", finish);
  });
  refresh();
  return { setMode, showPanel, refresh: refreshMenu, get mode() { return state.mode; } };
}

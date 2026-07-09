import * as THREE from "three";
import { strToU8, zipSync } from "fflate";
import {
  buildFriendlyScenePayloadFromCanonical,
  createJsonScene,
  createPluginHost,
  exportMesh,
  detectScenePayloadViewFormat,
  normalizeScenePayload
} from "threejson/core";
import {
  buildAdaptiveContentBoundingBoxTHREE,
  fitPerspectiveCameraToContentBoundsTHREE
} from "../../../../core/util/util.js";
import { resolveSceneHostUrl, sceneHostAssetUrl } from "../../shared/js/sceneHostPaths.js";
import {
  jsonStringForScript,
  buildHtmlTemplate,
  buildPackageJson,
  buildTemplateFiles
} from "../../shared/js/templateExportBuilders.js";

const STORAGE = {
  autoRun: "threejson.shower.autoRun",
  catalogOpen: "threejson.shower.catalogOpen",
  jsonFormat: "threejson.shower.jsonFormat",
  tab: "threejson.shower.tab",
  lang: "threejson.site.lang",
  theme: "threejson.site.theme"
};
const STORAGE_EDITOR_BRIDGE_PREFIX = "threejson.editor.openScene.";
const AUTO_RENDER_DELAY_MS = 700;
const DEMO_MANIFEST_URL = "assets/json/demo-show/manifest.json";
const params = new URLSearchParams(window.location.search);
let lang = resolveLang();
let theme = localStorage.getItem(STORAGE.theme) || "auto";

const labels = {
  "zh-CN": {
    autoRun: "实时渲染",
    coreJson: "核心JSON",
    fullJson: "完整JSON",
    sceneTree: "场景树",
    friendlyJson: "友好",
    standardJson: "标准",
    format: "格式化",
    run: "运行",
    downloadHtml: "下载该示例",
    export: "导出该场景",
    nativeJson: "原生JSON",
    modelExport: "三方模型",
    threeView: "三视图",
    fit: "自适应",
    fullscreen: "全屏",
    loading: "加载中...",
    ready: "Ready",
    noObjects: "暂无对象",
    parseFailed: "JSON 解析失败：",
    exportFailed: "导出失败：",
    modelExportTitle: "导出三方模型",
    modelExportFormat: "格式",
    modelExportHint: "推荐使用 GLB；OBJ/STL/PLY 主要导出几何，USDZ 适合 iOS AR 预览。",
    cancel: "取消",
    confirmExport: "导出",
    alreadyFriendly: "当前已经是友好JSON。",
    alreadyStandard: "当前已经是标准JSON。",
    modelExportDone: "三方模型已导出。",
    templateExportTitle: "导出模板",
    templateExportType: "模板类型",
    templateExportFormat: "JSON 格式",
    templateExportJsonLocation: "JSON 位置",
    templateExportJsonInline: "内置",
    templateExportJsonExternal: "外置",
    templateExportHint: "HTML + 内置 JSON 会直接下载单个 HTML；其他情况导出 zip 模板包。",
    templateExportDone: "模板已导出。",
    catalog: "目录",
    openInEditor: "在编辑器内打开",
    editorOpenFailed: "打开编辑器失败：",
    themeLabel: "主题",
    themeAuto: "自动",
    themeLight: "浅色",
    themeDark: "深色",
    langLabel: "语言",
    langAuto: "自动",
    langZh: "简体中文",
    langEn: "English"
  },
  "en-US": {
    autoRun: "Live Render",
    coreJson: "Core JSON",
    fullJson: "Full JSON",
    sceneTree: "Scene Tree",
    friendlyJson: "Friendly",
    standardJson: "Standard",
    format: "Format",
    run: "Run",
    downloadHtml: "Download This Example",
    export: "Export This Scene",
    nativeJson: "Native JSON",
    modelExport: "Model",
    threeView: "Three Views",
    fit: "Fit",
    fullscreen: "Fullscreen",
    loading: "Loading...",
    ready: "Ready",
    noObjects: "No objects",
    parseFailed: "JSON parse failed: ",
    exportFailed: "Export failed: ",
    modelExportTitle: "Export Model",
    modelExportFormat: "Format",
    modelExportHint: "GLB is recommended. OBJ/STL/PLY mainly export geometry; USDZ is suitable for iOS AR preview.",
    cancel: "Cancel",
    confirmExport: "Export",
    alreadyFriendly: "Current JSON is already friendly JSON.",
    alreadyStandard: "Current JSON is already standard JSON.",
    modelExportDone: "Model exported.",
    templateExportTitle: "Export Template",
    templateExportType: "Template type",
    templateExportFormat: "JSON format",
    templateExportJsonLocation: "JSON location",
    templateExportJsonInline: "Inline",
    templateExportJsonExternal: "External",
    templateExportHint: "HTML + inline JSON downloads a single HTML file; other combinations download a zip template.",
    templateExportDone: "Template exported.",
    catalog: "Catalog",
    openInEditor: "Open In Editor",
    editorOpenFailed: "Failed to open editor: ",
    themeLabel: "Theme",
    themeAuto: "Auto",
    themeLight: "Light",
    themeDark: "Dark",
    langLabel: "Language",
    langAuto: "Auto",
    langZh: "Simplified Chinese",
    langEn: "English"
  }
};

const t = (key) => labels[lang]?.[key] || labels["zh-CN"][key] || key;

const els = {
  title: document.getElementById("exampleTitle"),
  status: document.getElementById("statusText"),
  editorPanel: document.getElementById("editorPanel"),
  treePanel: document.getElementById("treePanel"),
  leftPane: document.querySelector(".leftPane"),
  catalogPanel: document.getElementById("exampleCatalogPanel"),
  catalogToggle: document.getElementById("catalogToggleBtn"),
  jsonToolbar: document.getElementById("jsonToolbar"),
  autoRun: document.getElementById("autoRunCheckbox"),
  canvas: document.getElementById("canvasContainer"),
  canvasWrap: document.getElementById("canvasWrap"),
  loading: document.getElementById("loadingMask"),
  formatSwitch: document.getElementById("jsonFormatSwitch"),
  friendlyBtn: document.getElementById("friendlyBtn"),
  standardBtn: document.getElementById("standardBtn"),
  messageToast: document.getElementById("messageToast"),
  modelExportModal: document.getElementById("modelExportModal"),
  modelExportFormat: document.getElementById("modelExportFormatSelect"),
  modelExportCancel: document.getElementById("modelExportCancelBtn"),
  modelExportConfirm: document.getElementById("modelExportConfirmBtn"),
  templateExportModal: document.getElementById("templateExportModal"),
  templateExportType: document.getElementById("templateExportTypeSelect"),
  templateExportFormat: document.getElementById("templateExportFormatSelect"),
  templateExportJsonLocation: document.getElementById("templateExportJsonLocationSelect"),
  templateExportCancel: document.getElementById("templateExportCancelBtn"),
  templateExportConfirm: document.getElementById("templateExportConfirmBtn"),
  langSelect: document.getElementById("langSelect"),
  themeSelect: document.getElementById("themeSelect")
};

let fullJson = null;
let activeTab = "core";
let editor = null;
let runtime = null;
let highlightHelper = null;
let runTimer = 0;
let suppressAutoRender = false;
let viewModeIndex = 0;
let currentJsonFormat = "friendly";
let messageTimer = 0;
let hoverMenu = null;
let demoManifest = [];
let currentJsonUrl = "";

const viewModes = [
  { name: "iso", dir: new THREE.Vector3(1, 0.72, 1) },
  { name: "top", dir: new THREE.Vector3(0, 1, 0.001) },
  { name: "front", dir: new THREE.Vector3(0, 0.08, 1) },
  { name: "side", dir: new THREE.Vector3(1, 0.08, 0) }
];

init();

async function init() {
  els.langSelect.value = localStorage.getItem(STORAGE.lang) || "auto";
  els.themeSelect.value = theme;
  applyTheme();
  applyI18n();
  els.status.textContent = t("ready");
  els.autoRun.checked = localStorage.getItem(STORAGE.autoRun) !== "0";
  els.autoRun.addEventListener("change", () => {
    localStorage.setItem(STORAGE.autoRun, els.autoRun.checked ? "1" : "0");
  });
  els.langSelect.addEventListener("change", () => {
    localStorage.setItem(STORAGE.lang, els.langSelect.value);
    lang = resolveLang();
    applyI18n();
    renderCatalog();
  });
  els.themeSelect.addEventListener("change", () => {
    theme = els.themeSelect.value;
    localStorage.setItem(STORAGE.theme, theme);
    applyTheme();
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);

  editor = window.CodeMirror(els.editorPanel, {
    value: "{}",
    mode: { name: "javascript", json: true },
    theme: "material-darker",
    lineNumbers: true,
    tabSize: 2,
    indentUnit: 2
  });
  editor.on("change", () => scheduleAutoRender());
  editor.on("blur", () => {
    if (els.autoRun.checked && activeTab !== "tree") {
      clearTimeout(runTimer);
      void runFromEditor();
    }
  });

  wireControls();
  await loadInitialJson();
  applyCachedCatalogState();
}

function getCachedTab() {
  const cached = localStorage.getItem(STORAGE.tab);
  return cached === "full" || cached === "tree" ? cached : "core";
}

function getCachedJsonFormat() {
  const cached = localStorage.getItem(STORAGE.jsonFormat);
  return cached === "friendly" || cached === "standard" ? cached : "";
}

function resolveLang() {
  const selected = localStorage.getItem(STORAGE.lang) || "auto";
  if (selected === "zh-CN" || selected === "en-US") return selected;
  const paramLang = params.get("lang");
  if (paramLang === "zh-CN" || paramLang === "en-US") return paramLang;
  return navigator.language?.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

function applyI18n() {
  document.documentElement.lang = lang === "zh-CN" ? "zh-CN" : "en";
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
}

function applyTheme() {
  const actual = theme === "auto"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;
  document.documentElement.dataset.theme = actual;
  applyRuntimeCanvasThemeBackground();
}

function wireControls() {
  wireMenuHoverBehavior();
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => setTab(button.dataset.tab));
  });
  document.getElementById("formatBtn").addEventListener("click", formatEditor);
  document.getElementById("runBtn").addEventListener("click", runFromEditor);
  document.getElementById("friendlyBtn").addEventListener("click", () => convertEditorJson("friendly"));
  document.getElementById("standardBtn").addEventListener("click", () => convertEditorJson("standard"));
  document.getElementById("openInEditorBtn").addEventListener("click", openCurrentSceneInEditor);
  els.catalogToggle?.addEventListener("click", toggleCatalog);
  document.getElementById("downloadHtmlBtn").addEventListener("click", openTemplateExportModal);
  document.getElementById("exportThreeJsonBtn").addEventListener("click", () => {
    downloadText("threejson-scene.json", JSON.stringify(readCurrentScene(), null, 2));
  });
  document.getElementById("exportNativeBtn").addEventListener("click", exportNativeJson);
  document.getElementById("exportModelBtn").addEventListener("click", openModelExportModal);
  els.modelExportCancel?.addEventListener("click", closeModelExportModal);
  els.modelExportConfirm?.addEventListener("click", confirmModelExport);
  els.modelExportModal?.addEventListener("click", (event) => {
    if (event.target === els.modelExportModal) closeModelExportModal();
  });
  els.templateExportCancel?.addEventListener("click", closeTemplateExportModal);
  els.templateExportConfirm?.addEventListener("click", confirmTemplateExport);
  els.templateExportModal?.addEventListener("click", (event) => {
    if (event.target === els.templateExportModal) closeTemplateExportModal();
  });
  els.templateExportType?.addEventListener("change", syncTemplateExportDefaults);
  document.getElementById("fitBtn").addEventListener("click", () => fitView(viewModes[0]));
  document.getElementById("threeViewBtn").addEventListener("click", cycleViewMode);
  document.getElementById("fullscreenBtn").addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else els.canvasWrap.requestFullscreen?.();
  });
  els.canvas.addEventListener("click", (event) => {
    if (event.detail <= 1) {
      clearHighlight();
      setActiveTreeNode("");
    }
  });
  els.canvas.addEventListener("dblclick", (event) => {
    const picked = pickObject(event);
    const id = picked ? getSceneObjectId(picked) : "";
    if (!id) {
      clearHighlight();
      setActiveTreeNode("");
      return;
    }
    highlightObject(id, picked);
    setActiveTreeNode(id);
  });
  window.addEventListener("resize", resizeRuntime);
}

function wireMenuHoverBehavior() {
  const toolbar = document.querySelector(".canvasToolbar");
  const menus = Array.from(document.querySelectorAll(".canvasToolbar .menu"));
  if (!toolbar || menus.length === 0) return;
  menus.forEach((menu) => {
    const button = menu.querySelector(":scope > button");
    button?.addEventListener("mouseenter", () => setHoverMenu(menu));
    menu.querySelector(".menuPanel")?.addEventListener("click", () => setHoverMenu(null));
  });
  toolbar.addEventListener("mousemove", (event) => {
    const menu = event.target.closest?.(".menu");
    if (menu && menus.includes(menu)) {
      setHoverMenu(menu);
    }
  });
  document.addEventListener("pointermove", (event) => {
    if (!hoverMenu) return;
    if (!toolbar.contains(event.target)) {
      setHoverMenu(null);
    }
  });
}

function setHoverMenu(menu) {
  if (hoverMenu === menu) return;
  document.querySelectorAll(".canvasToolbar .menu.hoverOpen").forEach((node) => node.classList.remove("hoverOpen"));
  hoverMenu = menu;
  hoverMenu?.classList.add("hoverOpen");
}

async function loadInitialJson() {
  const raw = params.get("json") || "assets/json/demo-show/01-box.json";
  await loadDemoManifest();
  await loadExampleJson(raw);
}

async function loadDemoManifest() {
  try {
    const response = await fetch(resolveSceneHostUrl(DEMO_MANIFEST_URL));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    demoManifest = await response.json();
    renderCatalog();
  } catch (error) {
    console.warn("Failed to load demo-show manifest.", error);
    demoManifest = [];
  }
}

async function loadExampleJson(raw) {
  const url = resolveSceneHostUrl(raw);
  showLoading(true);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fullJson = await res.json();
    currentJsonUrl = raw;
    currentJsonFormat = detectCurrentJsonFormat(fullJson);
    applyCachedJsonFormatToFullJson();
    syncJsonFormatUi();
    els.title.textContent = fullJson.name || fullJson.threeJsonId || "ThreeJSON Shower";
    setTab(getCachedTab(), { persist: false });
    await runScene(fullJson);
    renderCatalog();
  } catch (error) {
    els.status.textContent = String(error.message || error);
  } finally {
    showLoading(false);
  }
}

function toggleCatalog() {
  const shouldOpen = !els.leftPane?.classList.contains("catalogOpen");
  setCatalogOpen(shouldOpen);
  localStorage.setItem(STORAGE.catalogOpen, shouldOpen ? "1" : "0");
}

function applyCachedCatalogState() {
  setCatalogOpen(localStorage.getItem(STORAGE.catalogOpen) !== "0");
}

function setCatalogOpen(open) {
  els.leftPane?.classList.toggle("catalogOpen", open);
  if (els.catalogPanel) els.catalogPanel.hidden = !open;
  els.catalogToggle?.classList.toggle("active", open);
}

function renderCatalog() {
  if (!els.catalogPanel) return;
  const useZh = lang === "zh-CN";
  els.catalogPanel.innerHTML = Array.isArray(demoManifest) && demoManifest.length
    ? demoManifest.map((section) => `
      <section class="catalogGroup">
        <h3 class="catalogGroupTitle">${escapeHtml(useZh ? section.sectionTitle : section.sectionTitleEn)}</h3>
        ${(section.items || []).map((item) => {
          const itemUrl = item.json || "";
          const isActive = normalizeCatalogUrl(itemUrl) === normalizeCatalogUrl(currentJsonUrl);
          return `<button class="catalogItem${isActive ? " active" : ""}" type="button" data-json="${escapeHtml(itemUrl)}">
            <span class="catalogItemTitle">${escapeHtml(useZh ? item.title : item.titleEn)}</span>
            <span class="catalogItemDesc">${escapeHtml(useZh ? item.desc : item.descEn)}</span>
          </button>`;
        }).join("")}
      </section>`).join("")
    : `<p>${t("noObjects")}</p>`;
  els.catalogPanel.querySelectorAll(".catalogItem").forEach((node) => {
    node.addEventListener("click", () => {
      const jsonUrl = node.dataset.json || "";
      if (jsonUrl) void loadExampleJson(jsonUrl);
    });
  });
}

function normalizeCatalogUrl(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^(\.\.\/)+/, "").replace(/^\.\//, "");
}

function setTab(tab, options = {}) {
  if (!["core", "full", "tree"].includes(tab)) tab = "core";
  activeTab = tab;
  if (options.persist !== false) {
    localStorage.setItem(STORAGE.tab, tab);
  }
  document.querySelectorAll(".tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
  const isTree = tab === "tree";
  els.editorPanel.hidden = isTree;
  els.jsonToolbar.hidden = isTree;
  els.treePanel.hidden = !isTree;
  if (tab === "core") setEditorJson(toCore(fullJson));
  if (tab === "full") setEditorJson(fullJson);
  if (tab === "tree") renderTree();
  syncJsonFormatUi();
  editor.refresh();
}

function setEditorJson(value) {
  suppressAutoRender = true;
  editor.setValue(JSON.stringify(value || {}, null, 2));
  suppressAutoRender = false;
}

function scheduleAutoRender() {
  if (suppressAutoRender || !els.autoRun.checked || activeTab === "tree") return;
  clearTimeout(runTimer);
  runTimer = window.setTimeout(runFromEditor, AUTO_RENDER_DELAY_MS);
}

function readEditorJson() {
  return JSON.parse(editor.getValue());
}

function readCurrentScene() {
  if (activeTab === "core") return mergeCoreIntoFull(readEditorJson());
  if (activeTab === "full") return readEditorJson();
  return fullJson;
}

function showMessage(message) {
  els.status.textContent = message;
  if (!els.messageToast) return;
  els.messageToast.textContent = message;
  els.messageToast.classList.add("visible");
  clearTimeout(messageTimer);
  messageTimer = window.setTimeout(() => els.messageToast.classList.remove("visible"), 2200);
}

function syncJsonFormatUi() {
  if (els.formatSwitch) els.formatSwitch.hidden = activeTab === "tree";
  els.friendlyBtn?.classList.toggle("active", currentJsonFormat === "friendly");
  els.standardBtn?.classList.toggle("active", currentJsonFormat === "standard");
}

function openCurrentSceneInEditor() {
  try {
    const sceneJson = readCurrentScene();
    const bridgeId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(`${STORAGE_EDITOR_BRIDGE_PREFIX}${bridgeId}`, JSON.stringify({
      source: "shower",
      createdAt: Date.now(),
      label: sceneJson?.name || sceneJson?.threeJsonId || "ThreeJSON Shower",
      sceneJson
    }));
    const editorPath = "../editor/index.html";
    const url = `${editorPath}?openFrom=shower&sceneKey=${encodeURIComponent(bridgeId)}`;
    window.open(url, "_blank", "noopener");
  } catch (error) {
    showMessage(t("editorOpenFailed") + (error.message || error));
  }
}

function applyCachedJsonFormatToFullJson() {
  const preferred = getCachedJsonFormat();
  if (!preferred || preferred === currentJsonFormat) return;
  try {
    fullJson = preferred === "standard" ? toStandard(fullJson) : toFriendly(fullJson);
    currentJsonFormat = preferred;
  } catch (error) {
    console.warn("Failed to apply cached JSON format.", error);
  }
}

function detectCurrentJsonFormat(sceneJson) {
  try {
    return detectScenePayloadViewFormat(sceneJson || {});
  } catch (_error) {
    return sceneJson?.worldInfo ? "friendly" : "standard";
  }
}

function formatEditor() {
  try {
    setEditorJson(readEditorJson());
    showMessage(t("ready"));
  } catch (error) {
    showMessage(t("parseFailed") + error.message);
  }
}

async function convertEditorJson(format) {
  try {
    const complete = readCurrentScene();
    const detected = detectCurrentJsonFormat(complete);
    if (detected === format) {
      currentJsonFormat = format;
      localStorage.setItem(STORAGE.jsonFormat, format);
      syncJsonFormatUi();
      showMessage(format === "friendly" ? t("alreadyFriendly") : t("alreadyStandard"));
      return;
    }
    const converted = format === "standard"
      ? toStandard(complete)
      : toFriendly(complete);
    fullJson = structuredClone(converted);
    currentJsonFormat = format;
    localStorage.setItem(STORAGE.jsonFormat, format);
    setEditorJson(activeTab === "core" ? toCore(fullJson) : fullJson);
    syncJsonFormatUi();
    showMessage(t("ready"));
    scheduleAutoRender();
  } catch (error) {
    showMessage(t("parseFailed") + error.message);
  }
}

async function runFromEditor() {
  try {
    await runScene(readCurrentScene());
  } catch (error) {
    els.status.textContent = t("parseFailed") + error.message;
    showLoading(false);
  }
}

function findManifestItemForJson(rawPath) {
  if (!rawPath) return null;
  for (const section of demoManifest) {
    const item = section.items?.find((entry) => entry.json === rawPath);
    if (item) return item;
  }
  return null;
}

async function runExampleBootstrap(kind, ctx) {
  try {
    if (kind === "fps-walk") {
      const { bootstrapFirstPersonExtensionsFromScene } = await import(
        "../../../../extensions/fps-walk/bootstrapFirstPersonExtensions.js"
      );
      await bootstrapFirstPersonExtensionsFromScene(ctx);
      return;
    }
    if (kind === "stat-echarts") {
      const { bootstrapStatChartsFromScene } = await import(
        "../../../../extensions/stat-echarts/bootstrapFromScene.js"
      );
      await bootstrapStatChartsFromScene(ctx);
      return;
    }
    if (kind === "physics-rapier") {
      const [{ bootstrapPhysicsRapierFromScene }, rapierModule] = await Promise.all([
        import("../../../../extensions/physics-rapier/bootstrapFromScene.js"),
        import("@dimforge/rapier3d-compat")
      ]);
      await bootstrapPhysicsRapierFromScene({ ...ctx, RAPIER: rapierModule.default });
    }
  } catch (error) {
    console.warn("[shower] example bootstrap failed:", kind, error);
  }
}

async function runScene(sceneJson) {
  showLoading(true);
  clearHighlight();
  runtime?.dispose?.();
  fullJson = structuredClone(sceneJson);
  currentJsonFormat = detectCurrentJsonFormat(fullJson);
  localStorage.setItem(STORAGE.jsonFormat, currentJsonFormat);
  syncJsonFormatUi();
  fullJson.canvasWidth = Math.max(1, els.canvasWrap.clientWidth);
  fullJson.canvasHeight = Math.max(1, els.canvasWrap.clientHeight);
  const bootstrapKind = findManifestItemForJson(currentJsonUrl)?.bootstrap;
  const createOptions = {
    canvas: els.canvas,
    assetsBase: sceneHostAssetUrl("assets/"),
    resetScene: true
  };
  if (bootstrapKind) {
    createOptions.onSceneReady = (ctx) => runExampleBootstrap(bootstrapKind, ctx);
    if (bootstrapKind === "physics-rapier") {
      createOptions.pluginHost = createPluginHost();
    }
  }
  try {
    runtime = await createJsonScene(fullJson, createOptions);
    runtime.start?.();
    applyRuntimeCanvasThemeBackground();
    resizeRuntime();
    renderTree();
    els.status.textContent = t("ready");
  } finally {
    showLoading(false);
  }
}

function applyRuntimeCanvasThemeBackground() {
  if (!runtime?.scene) return;
  const color = getComputedStyle(document.documentElement).getPropertyValue("--canvas-bg").trim() || "#11151b";
  runtime.scene.background = new THREE.Color(color);
  runtime.renderer?.setClearColor?.(color, 1);
}

function toCore(sceneJson) {
  const core = {
    name: sceneJson?.name,
    worldInfo: structuredClone(sceneJson?.worldInfo || {})
  };
  if (shouldExposeSceneConfigInCore(sceneJson)) {
    core.sceneConfig = structuredClone(sceneJson?.sceneConfig || {});
  }
  if (!Object.keys(core.worldInfo || {}).length && Array.isArray(sceneJson?.objectList)) {
    core.objectList = structuredClone(sceneJson.objectList);
  }
  return core;
}

function shouldExposeSceneConfigInCore(sceneJson) {
  const key = String(`${sceneJson?.name || ""} ${sceneJson?.threeJsonId || ""}`).toLowerCase();
  return /light|camera|scene|renderer|control|view|background/.test(key);
}

function mergeCoreIntoFull(core) {
  const base = structuredClone(fullJson || {});
  if (core.name !== undefined) base.name = core.name;
  if (core.worldInfo !== undefined) base.worldInfo = structuredClone(core.worldInfo || {});
  if (core.objectList !== undefined) {
    base.objectList = structuredClone(core.objectList || []);
    delete base.worldInfo;
  }
  if (core.sceneConfig !== undefined) {
    base.sceneConfig = structuredClone(core.sceneConfig || {});
  }
  return base;
}

function toStandard(json) {
  return normalizeScenePayload(structuredClone(json || {})).payload;
}

function toFriendly(json) {
  const source = structuredClone(json || {});
  const normalized = normalizeScenePayload(source);
  const friendlyMap =
    source.friendlyMap && typeof source.friendlyMap === "object"
      ? source.friendlyMap
      : source.worldInfo?.friendlyMap && typeof source.worldInfo.friendlyMap === "object"
        ? source.worldInfo.friendlyMap
        : undefined;
  return buildFriendlyScenePayloadFromCanonical(source, normalized.payload, { friendlyMap });
}

function renderTree() {
  const groups = collectObjectGroups(fullJson);
  els.treePanel.innerHTML = groups.length
    ? groups.map((group) => `
      <details class="treeGroup" open>
        <summary>${escapeHtml(group.name)}</summary>
        ${group.items.map((record) => `<button class="treeNode" data-id="${escapeHtml(record.id)}" type="button">${escapeHtml(record.label)}</button>`).join("")}
      </details>`).join("")
    : `<p>${t("noObjects")}</p>`;
  els.treePanel.querySelectorAll(".treeNode").forEach((node) => {
    node.addEventListener("click", () => {
      setActiveTreeNode(node.dataset.id);
      highlightObject(node.dataset.id);
    });
  });
}

function collectObjectGroups(sceneJson) {
  const groups = [];
  const worldInfo = sceneJson?.worldInfo || {};
  for (const [listName, list] of Object.entries(worldInfo)) {
    if (!Array.isArray(list) || !list.length) continue;
    groups.push({
      name: listName,
      items: list.map((item, index) => {
        const id = String(item.threeJsonId || item.name || `${listName}-${index}`);
        const type = item.objType || listName.replace(/ModelList$/i, "");
        return { id, label: `${id} / ${type}` };
      })
    });
  }
  if (Array.isArray(sceneJson?.objectList) && sceneJson.objectList.length) {
    groups.push({
      name: "objectList",
      items: sceneJson.objectList.map((item, index) => {
        const id = String(item.threeJsonId || item.name || `object-${index}`);
        return { id, label: `${id} / ${item.objType || "object"}` };
      })
    });
  }
  return groups;
}

function collectObjectRecords(sceneJson) {
  return collectObjectGroups(sceneJson).flatMap((group) => group.items);
}

function highlightObject(id, fallbackObject = null) {
  clearHighlight();
  const scene = runtime?.scene;
  if (!scene) return;
  const target = (id ? scene.getObjectByName(id) || findByUserData(scene, id) : null) || fallbackObject;
  if (!target) return;
  highlightHelper = new THREE.BoxHelper(target, 0xffb020);
  highlightHelper.userData.__threeJsonShowerHelper = true;
  scene.add(highlightHelper);
}

function findByUserData(root, id) {
  let found = null;
  root.traverse((obj) => {
    if (found) return;
    if (obj.userData?.threeJsonId === id || obj.userData?.name === id || obj.userData?.objJson?.threeJsonId === id) {
      found = obj;
    }
  });
  return found;
}

function setActiveTreeNode(id) {
  els.treePanel.querySelectorAll(".treeNode").forEach((node) => {
    const active = Boolean(id) && node.dataset.id === id;
    node.classList.toggle("active", active);
    if (active) {
      node.closest("details")?.setAttribute("open", "");
      node.scrollIntoView({ block: "nearest" });
    }
  });
}

function clearHighlight() {
  if (highlightHelper?.parent) highlightHelper.parent.remove(highlightHelper);
  highlightHelper?.geometry?.dispose?.();
  highlightHelper?.material?.dispose?.();
  highlightHelper = null;
}

function fitView(view = viewModes[0]) {
  if (!runtime?.scene || !runtime?.camera) return;
  resizeRuntime();
  const bounds = buildAdaptiveContentBoundingBoxTHREE(runtime.scene, {
    ignoreHelper: highlightHelper ?? null
  });
  if (!bounds) return;
  fitPerspectiveCameraToContentBoundsTHREE(runtime.camera, runtime.controls, bounds, {
    aspectHints: {
      width: Math.max(1, els.canvasWrap.clientWidth),
      height: Math.max(1, els.canvasWrap.clientHeight)
    },
    viewDirection: view.dir
  });
  runtime.controls?.update?.();
}

function cycleViewMode() {
  viewModeIndex = (viewModeIndex + 1) % viewModes.length;
  fitView(viewModes[viewModeIndex]);
}

function resizeRuntime() {
  runtime?.resize?.(Math.max(1, els.canvasWrap.clientWidth), Math.max(1, els.canvasWrap.clientHeight));
}

function pickObject(event) {
  const scene = runtime?.scene;
  const camera = runtime?.camera;
  if (!scene || !camera) return null;
  const rect = els.canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -(((event.clientY - rect.top) / rect.height) * 2 - 1)
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(scene.children, true).find((item) => isScenePickable(item.object));
  return hit?.object || null;
}

function isScenePickable(obj) {
  if (!obj || obj.type === "GridHelper" || obj.type === "AxesHelper" || obj.type === "BoxHelper") return false;
  if (obj.userData?.__threeJsonShowerHelper || obj.isLight || obj.isCamera) return false;
  return Boolean(getSceneObjectId(obj));
}

function getSceneObjectId(obj) {
  let cur = obj;
  const ids = new Set(collectObjectRecords(fullJson).map((record) => record.id));
  while (cur) {
    const id = cur.userData?.threeJsonId || cur.userData?.objJson?.threeJsonId || cur.name;
    if (id && ids.has(String(id))) return String(id);
    cur = cur.parent;
  }
  return "";
}

async function exportNativeJson() {
  try {
    const nativeJson = runtime?.scene?.toJSON?.() || {};
    downloadText("threejson-native.json", JSON.stringify(nativeJson, null, 2));
  } catch (error) {
    showMessage(t("exportFailed") + (error.message || error));
  }
}

function openModelExportModal() {
  if (!els.modelExportModal) return;
  if (els.modelExportFormat) els.modelExportFormat.value = "glb";
  els.modelExportModal.hidden = false;
  window.requestAnimationFrame(() => els.modelExportFormat?.focus?.());
}

function closeModelExportModal() {
  if (els.modelExportModal) els.modelExportModal.hidden = true;
}

async function confirmModelExport() {
  const format = String(els.modelExportFormat?.value || "glb").trim().toLowerCase();
  closeModelExportModal();
  await exportModel(format);
}

async function exportModel(format = "glb") {
  showLoading(true);
  try {
    clearHighlight();
    const result = await exportMesh(runtime.scene, {
      format,
      scope: "scene",
      renderer: runtime.renderer,
      externalModelPolicy: "include",
      shouldSkipObject: (obj) => obj.userData?.__threeJsonShowerHelper === true,
      fileNameStem: "threejson-scene"
    });
    const payload = result.data instanceof ArrayBuffer ? result.data : String(result.data || "");
    downloadBlob(new Blob([payload], { type: result.mimeType || "application/octet-stream" }), result.fileNameHint);
    showMessage(t("modelExportDone"));
  } catch (error) {
    console.error(error);
    showMessage(t("exportFailed") + (error.message || error));
  } finally {
    showLoading(false);
  }
}

function openTemplateExportModal() {
  if (!els.templateExportModal) return;
  if (els.templateExportType) els.templateExportType.value = "html";
  syncTemplateExportDefaults();
  els.templateExportModal.hidden = false;
  window.requestAnimationFrame(() => els.templateExportType?.focus?.());
}

function closeTemplateExportModal() {
  if (els.templateExportModal) els.templateExportModal.hidden = true;
}

function syncTemplateExportDefaults() {
  const type = els.templateExportType?.value || "html";
  if (els.templateExportJsonLocation) {
    els.templateExportJsonLocation.value = type === "html" ? "inline" : "external";
  }
  if (els.templateExportFormat) {
    els.templateExportFormat.value = currentJsonFormat === "friendly" ? "friendly" : "standard";
  }
}

function addZipTextFile(entries, path, text) {
  entries[path] = strToU8(text);
}

function confirmTemplateExport() {
  const type = els.templateExportType?.value || "html";
  const format = els.templateExportFormat?.value || "standard";
  const jsonLocation = els.templateExportJsonLocation?.value || (type === "html" ? "inline" : "external");
  closeTemplateExportModal();
  try {
    const scene = readCurrentScene();
    const payload = format === "friendly" ? toFriendly(scene) : toStandard(scene);
    const sceneJsonText = jsonStringForScript(payload, 2);
    const inlineJson = jsonLocation === "inline";
    const html = buildHtmlTemplate({ sceneJsonText, inlineJson });
    if (type === "html" && inlineJson) {
      downloadText("threejson-template.html", html, "text/html");
      showMessage(t("templateExportDone"));
      return;
    }
    const entries = {};
    if (type === "html") {
      addZipTextFile(entries, "index.html", html);
    } else {
      addZipTextFile(entries, "package.json", buildPackageJson(type));
      const files = buildTemplateFiles(type);
      for (const [path, text] of Object.entries(files)) {
        addZipTextFile(entries, path, text);
      }
    }
    if (!inlineJson || type !== "html") {
      addZipTextFile(entries, "assets/json/scene.json", `${sceneJsonText}\n`);
    }
    const zip = zipSync(entries, { level: 6 });
    downloadBlob(new Blob([zip], { type: "application/zip" }), `threejson-template-${type}.zip`);
    showMessage(t("templateExportDone"));
  } catch (error) {
    console.error(error);
    showMessage(t("exportFailed") + (error.message || error));
  }
}

function downloadText(filename, text, type = "application/json") {
  downloadBlob(new Blob([text], { type }), filename);
}

function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function showLoading(visible) {
  els.loading.textContent = t("loading");
  els.loading.classList.toggle("visible", Boolean(visible));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

import * as THREE from "three";
import {
  buildFriendlyScenePayloadFromCanonical,
  createJsonScene,
  exportMesh,
  detectScenePayloadViewFormat,
  normalizeScenePayload
} from "threejson/core";
import {
  buildAdaptiveContentBoundingBoxTHREE,
  fitPerspectiveCameraToContentBoundsTHREE
} from "../../../../core/util/util.js";
import { resolveSceneHostUrl, sceneHostAssetUrl } from "../../shared/js/sceneHostPaths.js";

const STORAGE_AUTO_RUN = "threejson.shower.autoRun";
const AUTO_RENDER_DELAY_MS = 700;
const params = new URLSearchParams(window.location.search);
const lang = params.get("lang") || (navigator.language?.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US");

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
    modelExportDone: "三方模型已导出。"
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
    modelExportDone: "Model exported."
  }
};

const t = (key) => labels[lang]?.[key] || labels["zh-CN"][key] || key;

const els = {
  title: document.getElementById("exampleTitle"),
  status: document.getElementById("statusText"),
  editorPanel: document.getElementById("editorPanel"),
  treePanel: document.getElementById("treePanel"),
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
  modelExportConfirm: document.getElementById("modelExportConfirmBtn")
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

const viewModes = [
  { name: "iso", dir: new THREE.Vector3(1, 0.72, 1) },
  { name: "top", dir: new THREE.Vector3(0, 1, 0.001) },
  { name: "front", dir: new THREE.Vector3(0, 0.08, 1) },
  { name: "side", dir: new THREE.Vector3(1, 0.08, 0) }
];

init();

async function init() {
  document.documentElement.lang = lang === "zh-CN" ? "zh-CN" : "en";
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  els.status.textContent = t("ready");
  els.autoRun.checked = localStorage.getItem(STORAGE_AUTO_RUN) !== "0";
  els.autoRun.addEventListener("change", () => {
    localStorage.setItem(STORAGE_AUTO_RUN, els.autoRun.checked ? "1" : "0");
  });

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
}

function wireControls() {
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => setTab(button.dataset.tab));
  });
  document.getElementById("formatBtn").addEventListener("click", formatEditor);
  document.getElementById("runBtn").addEventListener("click", runFromEditor);
  document.getElementById("friendlyBtn").addEventListener("click", () => convertEditorJson("friendly"));
  document.getElementById("standardBtn").addEventListener("click", () => convertEditorJson("standard"));
  document.getElementById("downloadHtmlBtn").addEventListener("click", downloadHtml);
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

async function loadInitialJson() {
  const raw = params.get("json") || "assets/json/demo-show/01-box.json";
  const url = resolveSceneHostUrl(raw);
  showLoading(true);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fullJson = await res.json();
    currentJsonFormat = detectCurrentJsonFormat(fullJson);
    syncJsonFormatUi();
    els.title.textContent = fullJson.name || fullJson.threeJsonId || "ThreeJSON Shower";
    setTab("core");
    await runScene(fullJson);
  } catch (error) {
    els.status.textContent = String(error.message || error);
  } finally {
    showLoading(false);
  }
}

function setTab(tab) {
  activeTab = tab;
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
      syncJsonFormatUi();
      showMessage(format === "friendly" ? t("alreadyFriendly") : t("alreadyStandard"));
      return;
    }
    const converted = format === "standard"
      ? toStandard(complete)
      : toFriendly(complete);
    fullJson = structuredClone(converted);
    currentJsonFormat = format;
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

async function runScene(sceneJson) {
  showLoading(true);
  clearHighlight();
  runtime?.dispose?.();
  fullJson = structuredClone(sceneJson);
  currentJsonFormat = detectCurrentJsonFormat(fullJson);
  syncJsonFormatUi();
  fullJson.canvasWidth = Math.max(1, els.canvasWrap.clientWidth);
  fullJson.canvasHeight = Math.max(1, els.canvasWrap.clientHeight);
  try {
    runtime = await createJsonScene(fullJson, {
      canvas: els.canvas,
      assetsBase: sceneHostAssetUrl("assets/"),
      resetScene: true
    });
    runtime.start?.();
    resizeRuntime();
    renderTree();
    els.status.textContent = t("ready");
  } finally {
    showLoading(false);
  }
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

function downloadHtml() {
  const json = JSON.stringify(readCurrentScene(), null, 2).replace(/<\/script/gi, "<\\/script");
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ThreeJSON Scene</title>
  <script type="importmap">
    {
      "imports": {
        "threejson": "https://cdn.jsdelivr.net/npm/threejson/builtins/full.js",
        "threejson/core": "https://cdn.jsdelivr.net/npm/threejson/core/index.js",
        "three": "https://esm.sh/three@0.184.0",
        "three/examples/jsm/": "https://esm.sh/three@0.184.0/examples/jsm/",
        "@tweenjs/tween.js": "https://esm.sh/@tweenjs/tween.js@25.0.0",
        "fflate": "https://esm.sh/fflate@0.8.3",
        "html2canvas-pro": "https://esm.sh/html2canvas-pro@2.0.4",
        "gifuct-js": "https://esm.sh/gifuct-js@2.1.2",
        "three-mesh-bvh": "https://esm.sh/three-mesh-bvh@0.9.10?deps=three@0.184.0",
        "three-bvh-csg": "https://esm.sh/three-bvh-csg@0.0.18?deps=three@0.184.0,three-mesh-bvh@0.9.10",
        "troika-three-text": "https://esm.sh/troika-three-text@0.52.4?deps=three@0.184.0"
      }
    }
  </script>
  <style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#11151b}canvas{display:block;width:100%;height:100%}</style>
</head>
<body>
<canvas id="canvas"></canvas>
<script type="module">
import { createJsonScene } from "threejson/core";
const sceneJson = ${json};
const canvas = document.getElementById("canvas");
const runtime = await createJsonScene(sceneJson, {
  canvas,
  resetScene: true,
  assetsBase: "https://cdn.jsdelivr.net/npm/@threejson/assets@latest/assets/"
});
runtime.start?.();
runtime.resize?.(innerWidth, innerHeight);
window.addEventListener("resize", () => runtime.resize?.(innerWidth, innerHeight));
</script>
</body>
</html>`;
  downloadText("threejson-scene.html", html, "text/html");
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

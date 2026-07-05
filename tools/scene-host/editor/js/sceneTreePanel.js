import {
  applyObjectTransform,
  buildEditorSceneTreePlain,
  captureObjectSnapshot,
  redeployObject,
  refreshRegisteredObject,
  resolveObjectDisplayLabel,
  syncBoxModelTransformFromObject3D
} from "threejson";
import { resolveTextureSource } from "../../../../core/util/resolveTextureSource.js";
import {
  detectRuntimeMaterialsArray,
  sanitizeMaterialJsonForExport
} from "../../../../core/util/descriptorExportSanitize.js";
import { resolveBoxDefaultTextureUrl } from "../../../../core/util/boxTextureUrl.js";
import {
  boxUsesIntentionalMaterialsArray,
  clamp01,
  readMaterialFieldFromObjJson,
  readTextureRepeatFromObjJson,
  shouldRedeployForDescriptorMaterial,
  toHexColorString,
  writeMaterialFieldToObjJson,
  writeTextureRepeatToObjJson,
  writeTextureUrlToObjJson
} from "./sceneTreeMaterialHelpers.js";
import { syncEditorMeshVisualFromObjJson } from "./editorMeshVisualSync.js";
import { createSceneTreeMaterialTree } from "./sceneTreeMaterialTree.js";
import {
  getDomainEditState,
  resolveDomainDeployRoot
} from "../lib/domainEditSession.js";
import { normalizeDismissTrigger } from "../../../../core/runtime/eventMechanism/infoPanelDismissTrigger.js";

function formatVec3ForPropInput(x, y, z) {
  const fx = Number(x);
  const fy = Number(y);
  const fz = Number(z);
  const sx = Number.isFinite(fx) ? String(fx) : "0";
  const sy = Number.isFinite(fy) ? String(fy) : "0";
  const sz = Number.isFinite(fz) ? String(fz) : "0";
  return `${sx}, ${sy}, ${sz}`;
}

function parseVec3PropInput(raw, fallback = [0, 0, 0]) {
  const text = String(raw ?? "").trim();
  if (!text) {
    return { a: fallback[0], b: fallback[1], c: fallback[2] };
  }
  const parts = text.split(/[,，\s]+/).map((p) => p.trim()).filter(Boolean);
  const nums = parts.map((p) => Number(p));
  return {
    a: Number.isFinite(nums[0]) ? nums[0] : fallback[0],
    b: Number.isFinite(nums[1]) ? nums[1] : fallback[1],
    c: Number.isFinite(nums[2]) ? nums[2] : fallback[2]
  };
}

function buildSceneTreeVisibilitySvg(visible) {
  if (visible) {
    return '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8 3C4.5 3 1.7 5.6 1 8c.7 2.4 3.5 5 7 5s6.3-2.6 7-5c-.7-2.4-3.5-5-7-5zm0 8.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg>';
  }
  return '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M2.3 1.3 1 2.6l2.4 2.4C2.2 6.5 1.2 8 1 8c.7 2.4 3.5 5 7 5 1.5 0 2.9-.4 4.1-1.1l2.7 2.7 1.3-1.3L2.3 1.3zM8 11c-1.6 0-3-.8-3.9-2l1.5-1.5c.5.5 1.2.8 2.4.8 1 0 1.8-.3 2.4-.8l1.5 1.5C11 10.2 9.6 11 8 11z"/></svg>';
}

export function createSceneTreePanel(host) {
  let currentPropPanelThreeJsonId = "";
  const rootEl = document.getElementById("sceneTreeRoot");
  const prop = {
    name: document.getElementById("sceneTreePropName"),
    label: document.getElementById("sceneTreePropLabel"),
    visible: document.getElementById("sceneTreePropVisible"),
    position: document.getElementById("sceneTreePropPosition"),
    rotation: document.getElementById("sceneTreePropRotation"),
    scale: document.getElementById("sceneTreePropScale"),
    textureUrl: document.getElementById("sceneTreePropTextureUrl"),
    textureRepeatX: document.getElementById("sceneTreePropTextureRepeatX"),
    textureRepeatY: document.getElementById("sceneTreePropTextureRepeatY"),
    color: document.getElementById("sceneTreePropColor"),
    emissive: document.getElementById("sceneTreePropEmissive"),
    emissiveIntensity: document.getElementById("sceneTreePropEmissiveIntensity"),
    opacity: document.getElementById("sceneTreePropOpacity"),
    metalness: document.getElementById("sceneTreePropMetalness"),
    roughness: document.getElementById("sceneTreePropRoughness"),
    doubleSide: document.getElementById("sceneTreePropDoubleSide"),
    wireframe: document.getElementById("sceneTreePropWireframe"),
    castShadow: document.getElementById("sceneTreePropCastShadow"),
    receiveShadow: document.getElementById("sceneTreePropReceiveShadow"),
    applyBtn: document.getElementById("sceneTreePropApplyBtn")
  };

  const propPanelTitle = document.getElementById("sceneTreePropPanelTitle");

  let clickTimer = null;
  let propSyncing = false;
  const materialTree = createSceneTreeMaterialTree(host, {
    isPropSyncing: () => propSyncing
  });

  function isBlurRedeployEnabled() {
    return host.getEditorSettings()?.editing?.blurRedeployOnPropertyChange !== false;
  }

  function applyPropertyRedeployAfterEdit(options = {}) {
    const { silent = true } = options;
    const selectedObj = host.getSelectedObject();
    if (!selectedObj) {
      return false;
    }
    const data = selectedObj.userData?.objJson;
    const threeJsonId = String(data?.threeJsonId || "").trim();
    if (!threeJsonId || !shouldRedeployForDescriptorMaterial(data)) {
      return false;
    }
    const re = redeployObject(host.getScene(), threeJsonId);
    if (!re?.object3D) {
      if (!silent) {
        host.showMessage("材质已写入，但 redeploy 失败。", "warning");
      }
      return false;
    }
    host.setSelectedObject(re.object3D);
    syncPropInputs(re.object3D);
    host.getEditorInteraction()?.refreshBoxEdge(re.object3D);
    host.getEditorInteraction()?.refreshMeshList?.();
    render();
    return true;
  }

  function isRuntimeOnlyObject(obj) {
    if (!obj) {
      return true;
    }
    if (obj.userData?.editorOnly === true || obj.userData?.type === "editorGridHelper") {
      return true;
    }
    const interaction = host.getEditorInteraction?.();
    const transformControls = interaction?.getTransformControls?.();
    const transformControlsHelper = interaction?.getTransformControlsHelper?.();
    const boxHelper = interaction?.getBoxEdgeHelper?.();
    if (
      obj === transformControls ||
      obj === transformControlsHelper ||
      obj === boxHelper
    ) {
      return true;
    }
    if (obj.userData?.type === "helperBoxEdge") {
      return true;
    }
    if (obj.isTransformControls || obj.type === "TransformControls") {
      return true;
    }
    if (obj.type === "AxesHelper" || obj.type === "GridHelper" || obj.type === "BoxHelper") {
      return true;
    }
    if (obj.userData?.objJson?.objType === "light") {
      return true;
    }
    if (
      obj.userData?.objJson?.objType === "gridHelper" ||
      obj.userData?.objJson?.objType === "axesHelper" ||
      obj.userData?.objJson?.objType === "boxHelper"
    ) {
      return true;
    }
    if (obj.name === "__threejson_native_scene__") {
      return true;
    }
    return false;
  }

  function buildUuidMap(rootScene) {
    const map = new Map();
    rootScene?.traverse?.((obj) => {
      if (obj?.uuid) {
        map.set(obj.uuid, obj);
      }
    });
    return map;
  }

  function findByThreeJsonId(id) {
    const scene = host.getScene();
    const normalized = String(id || "").trim();
    if (!scene || !normalized) {
      return null;
    }
    let found = null;
    scene.traverse((obj) => {
      if (found) {
        return;
      }
      if (String(obj?.userData?.objJson?.threeJsonId || "").trim() === normalized) {
        found = obj;
      }
    });
    return found;
  }

  function readThreeJsonId(obj) {
    return String(obj?.userData?.objJson?.threeJsonId || "").trim();
  }

  function getObjectByUuid(uuid) {
    const normalized = String(uuid || "").trim();
    if (!normalized) {
      return null;
    }
    return buildUuidMap(host.getScene()).get(normalized) ?? null;
  }

  function toggleVisibility(obj) {
    if (!obj) {
      return;
    }
    obj.visible = !obj.visible;
    const data = obj.userData?.objJson;
    if (data && typeof data === "object") {
      data.visible = obj.visible;
    }
    host.getSceneReserialize?.()?.markSceneNeedsReserialize?.();
    const selected = host.getSelectedObject();
    syncPropInputs(selected?.uuid === obj.uuid ? selected : selected || obj);
    render();
  }

  function renderRows(container, nodes, uuidMap, depth) {
    for (const n of nodes) {
      const wrap = document.createElement("div");
      wrap.className = "sceneTreeRowWrap";
      wrap.dataset.treeUuid = n.uuid;
      const row = document.createElement("div");
      row.className = "sceneTreeRow";
      row.dataset.treeUuid = n.uuid;
      row.style.paddingLeft = `${6 + depth * 14}px`;
      const hasKids = n.children?.length > 0;
      const childContainer = document.createElement("div");
      childContainer.className = "sceneTreeChildren";
      if (hasKids) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "sceneTreeExpandBtn";
        btn.textContent = "▾";
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          childContainer.hidden = !childContainer.hidden;
          btn.textContent = childContainer.hidden ? "▸" : "▾";
        });
        row.appendChild(btn);
      } else {
        const sp = document.createElement("span");
        sp.className = "sceneTreeExpandSpacer";
        row.appendChild(sp);
      }
      const currentObj = uuidMap.get(n.uuid);
      const lab = document.createElement("span");
      lab.className = "sceneTreeLabel";
      lab.textContent =
        resolveObjectDisplayLabel(currentObj?.userData?.objJson || { name: n.name }) ||
        n.objType ||
        n.uuid.slice(0, 8);
      lab.title = `${n.objType || ""} ${n.uuid}`.trim();
      row.appendChild(lab);
      const visBtn = document.createElement("button");
      visBtn.type = "button";
      visBtn.className = "sceneTreeVisBtn";
      const nowVisible = currentObj?.visible !== false;
      visBtn.innerHTML = buildSceneTreeVisibilitySvg(nowVisible);
      visBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleVisibility(uuidMap.get(n.uuid));
      });
      row.appendChild(visBtn);
      const delay = host.getEditorSettings()?.editing?.sceneTreeClickDelayMs ?? 250;
      row.addEventListener("click", () => {
        const ob = uuidMap.get(n.uuid);
        if (!ob) {
          return;
        }
        if (clickTimer) {
          window.clearTimeout(clickTimer);
        }
        clickTimer = window.setTimeout(() => {
          clickTimer = null;
          const interaction = host.getEditorInteraction?.();
          if (interaction) {
            interaction.selectFromTree(ob);
          } else {
            selectFromTree(ob);
          }
        }, delay);
      });
      row.addEventListener("dblclick", (e) => {
        e.preventDefault();
        const ob = uuidMap.get(n.uuid);
        if (!ob) {
          return;
        }
        if (clickTimer) {
          window.clearTimeout(clickTimer);
          clickTimer = null;
        }
        const interaction = host.getEditorInteraction?.();
        if (interaction) {
          interaction.selectTreeDoubleClick(ob);
        } else {
          selectFromTree(ob);
          host.showMessage("已选中对象。", "info");
        }
        host.getCodeEditor?.()?.maybeLocateThreeJsonIdInCodeEditor?.(ob);
      });
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const ob = uuidMap.get(n.uuid);
        if (!ob?.uuid) {
          host.getSceneTreeContextMenu?.()?.close?.();
          return;
        }
        const interaction = host.getEditorInteraction?.();
        if (interaction) {
          interaction.selectFromTree(ob);
        } else {
          selectFromTree(ob);
        }
        host.getSceneTreeContextMenu?.()?.openAt?.(e.clientX, e.clientY, ob.uuid);
      });
      wrap.appendChild(row);
      wrap.appendChild(childContainer);
      if (hasKids) {
        renderRows(childContainer, n.children, uuidMap, depth + 1);
      }
      container.appendChild(wrap);
    }
  }

  function syncRowHighlight() {
    if (!rootEl) {
      return;
    }
    rootEl.querySelectorAll(".sceneTreeRow.sceneTreeRowSelected").forEach((el) => {
      el.classList.remove("sceneTreeRowSelected");
    });
    const sel = host.getSelectedObject();
    if (!sel?.uuid) {
      return;
    }
    rootEl.querySelector(`.sceneTreeRow[data-tree-uuid="${sel.uuid}"]`)?.classList.add("sceneTreeRowSelected");
  }

  function revealSceneTreeRowForObject(obj) {
    if (!obj?.uuid || !rootEl) {
      return;
    }
    host.getEditorViewChrome?.()?.peekRightDock?.();
    host.getRightDockPanel?.()?.switchTab?.("sceneTree");
    render();
    requestAnimationFrame(() => {
      const wrap = rootEl.querySelector(`.sceneTreeRowWrap[data-tree-uuid="${obj.uuid}"]`);
      if (!wrap) {
        return;
      }
      let el = wrap.parentElement;
      while (el && el !== rootEl) {
        if (el.classList.contains("sceneTreeChildren")) {
          el.hidden = false;
          const rowPrev = el.previousElementSibling;
          const btn = rowPrev?.querySelector?.(".sceneTreeExpandBtn");
          if (btn) {
            btn.textContent = "▾";
          }
        }
        el = el.parentElement;
      }
      syncRowHighlight();
      const row = wrap.querySelector(".sceneTreeRow");
      row?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    });
  }

  function syncSceneTreeUi() {
    const selectedObj = host.getSelectedObject();
    updatePropPanelTitle(selectedObj);
    syncPropInputs(selectedObj);
    materialTree.render(selectedObj);
    syncRowHighlight();
  }

  function render() {
    const scene = host.getScene();
    if (!rootEl || !scene) {
      return;
    }
    host.getSceneTreeContextMenu?.()?.close?.();
    rootEl.innerHTML = "";
    const uuidMap = buildUuidMap(scene);
    const plain = buildEditorSceneTreePlain(scene, {
      shouldSkipObject: isRuntimeOnlyObject
    });
    renderRows(rootEl, plain, uuidMap, 0);
    syncRowHighlight();
  }

  function clear() {
    if (rootEl) {
      rootEl.innerHTML = "";
    }
    syncPropInputs(null);
  }

  function updatePropPanelTitle(model) {
    if (!propPanelTitle) {
      return;
    }
    if (!model?.userData?.objJson) {
      propPanelTitle.textContent = "属性";
      return;
    }
    const data = model.userData.objJson;
    const name = String(data.name || model.name || "").trim();
    const id = String(data.threeJsonId || "").trim();
    const suffix = name || id || "未命名";
    propPanelTitle.textContent = `属性 - ${suffix}`;
  }

  function syncPropInputs(model) {
    if (!prop.name) {
      return;
    }
    updatePropPanelTitle(model);
    propSyncing = true;
    try {
      const data = model?.userData?.objJson;
      if (!data || typeof data !== "object") {
        prop.name.value = model?.name || "";
        if (prop.label) prop.label.value = "";
        if (prop.position) prop.position.value = "";
        if (prop.rotation) prop.rotation.value = "";
        if (prop.scale) prop.scale.value = "";
        if (prop.visible) prop.visible.checked = model?.visible !== false;
        currentPropPanelThreeJsonId = "";
        syncDomainPropSection(model);
        syncInfoPanelPropSection(null);
        materialTree.render(model);
        host.getEventEditorPanel()?.syncFromSelection?.();
        return;
      }
      prop.name.value = data.name || model?.name || "";
      if (prop.label) prop.label.value = data.label || "";
      const p = data.position || {};
      const r = data.rotation || {};
      const s = data.scale || {};
      if (prop.position) {
        prop.position.value = formatVec3ForPropInput(p.x, p.y, p.z);
      }
      if (prop.rotation) {
        prop.rotation.value = formatVec3ForPropInput(r.rotationX ?? r.x, r.rotationY ?? r.y, r.rotationZ ?? r.z);
      }
      if (prop.scale) {
        prop.scale.value = formatVec3ForPropInput(s.scaleX ?? 1, s.scaleY ?? 1, s.scaleZ ?? 1);
      }
      if (prop.visible) {
        prop.visible.checked = model?.visible !== false;
      }
      if (prop.castShadow) {
        prop.castShadow.checked = Boolean(model?.castShadow);
      }
      if (prop.receiveShadow) {
        prop.receiveShadow.checked = Boolean(model?.receiveShadow);
      }
      if (prop.textureUrl) {
        prop.textureUrl.value = readTextureUrl(data);
      }
      const textureRepeat = readTextureRepeatFromObjJson(data);
      if (prop.textureRepeatX) {
        prop.textureRepeatX.value = String(textureRepeat.x);
      }
      if (prop.textureRepeatY) {
        prop.textureRepeatY.value = String(textureRepeat.y);
      }
      if (prop.color) {
        prop.color.value = toHexColorString(readMaterialFieldFromObjJson(data, "color", "#ffffff"), "#ffffff");
      }
      if (prop.emissive) {
        prop.emissive.value = toHexColorString(readMaterialFieldFromObjJson(data, "emissive", "#000000"), "#000000");
      }
      if (prop.emissiveIntensity) {
        prop.emissiveIntensity.value = String(Number(readMaterialFieldFromObjJson(data, "emissiveIntensity", 0)) || 0);
      }
      if (prop.opacity) {
        prop.opacity.value = String(clamp01(readMaterialFieldFromObjJson(data, "opacity", 1), 1));
      }
      if (prop.metalness) {
        prop.metalness.value = String(clamp01(readMaterialFieldFromObjJson(data, "metalness", 0), 0));
      }
      if (prop.roughness) {
        prop.roughness.value = String(clamp01(readMaterialFieldFromObjJson(data, "roughness", 1), 1));
      }
      if (prop.doubleSide) {
        prop.doubleSide.checked = readMaterialFieldFromObjJson(data, "side", "front") === "double";
      }
      if (prop.wireframe) {
        prop.wireframe.checked = Boolean(readMaterialFieldFromObjJson(data, "wireframe", false));
      }
      currentPropPanelThreeJsonId = String(data?.threeJsonId || "").trim();
      syncDomainPropSection(model);
      syncInfoPanelPropSection(data);
      materialTree.render(model);
    } finally {
      propSyncing = false;
      host.getEventEditorPanel()?.syncFromSelection?.();
    }
  }

  function syncInfoPanelPropSection(data) {
    const section = document.getElementById("sceneTreePropInfoPanelSection");
    const dismissTriggerEl = document.getElementById("sceneTreePropDismissTrigger");
    if (!section || !dismissTriggerEl) {
      return;
    }
    const objType = typeof data?.objType === "string" ? data.objType.trim().toLowerCase() : "";
    const isInfoPanel = objType === "infopanel";
    section.hidden = !isInfoPanel;
    if (!isInfoPanel) {
      return;
    }
    dismissTriggerEl.value = normalizeDismissTrigger(
      data.dismissTrigger ?? (data.fix === false ? "dblclick" : "none")
    );
  }

  function readTextureUrl(data) {
    if (boxUsesIntentionalMaterialsArray(data)) {
      return resolveBoxDefaultTextureUrl(data) || "";
    }
    return resolveTextureSource(data.material) || "";
  }

  function syncDomainPropSection(model) {
    const scene = host.getScene();
    const domainSection = document.getElementById("sceneTreePropDomainSection");
    const domainStateInput = document.getElementById("sceneTreePropDomainState");
    const domainIdInput = document.getElementById("sceneTreePropDomainId");
    const domainHandlerInput = document.getElementById("sceneTreePropDomainHandler");
    const domainObjTypeInput = document.getElementById("sceneTreePropDomainObjType");
    const domainThreeJsonIdInput = document.getElementById("sceneTreePropDomainThreeJsonId");
    const domainRoot = resolveDomainDeployRoot(model, scene);
    if (!domainSection) {
      return;
    }
    const showDomain = Boolean(domainRoot);
    domainSection.hidden = !showDomain;
    if (!showDomain || !domainRoot) {
      return;
    }
    const shell = domainRoot.userData?.objJson || {};
    const state = getDomainEditState(domainRoot);
    const stateLabel = host.getEditorDomainDrillIn?.()?.formatDomainEditStateLabel?.(state) || String(state || "-");
    if (domainStateInput) {
      domainStateInput.value = stateLabel;
    }
    if (domainIdInput) {
      domainIdInput.value = String(shell.domain || "");
    }
    if (domainHandlerInput) {
      domainHandlerInput.value = String(shell.handler || "");
    }
    if (domainObjTypeInput) {
      domainObjTypeInput.value = String(shell.objType || "");
    }
    if (domainThreeJsonIdInput) {
      domainThreeJsonIdInput.value = String(shell.threeJsonId || "");
    }
  }

  function normalizeDescriptorForHistorySnapshot(descriptor) {
    if (!descriptor || typeof descriptor !== "object") {
      return descriptor;
    }
    const out = JSON.parse(JSON.stringify(descriptor));
    if (detectRuntimeMaterialsArray(out)) {
      delete out.materials;
    }
    if (out.material && typeof out.material === "object") {
      out.material = sanitizeMaterialJsonForExport(out.material);
    }
    if (Array.isArray(out.materials)) {
      out.materials = out.materials.map((entry) => sanitizeMaterialJsonForExport(entry));
    }
    const mat = out.material;
    if (mat && typeof mat === "object" && typeof mat.textureUrl === "string" && !mat.textureUrl.trim()) {
      delete mat.textureUrl;
      if (Object.keys(mat).length === 0) {
        delete out.material;
      }
    }
    if (Array.isArray(out.materials) && out.materials.length === 6 && !out.material) {
      return out;
    }
    if (mat && Array.isArray(out.materials) && out.materials.length === 6) {
      const orphanEmptyMaterial =
        typeof mat.textureUrl === "string" &&
        !mat.textureUrl.trim() &&
        !resolveTextureSource(mat) &&
        (mat.color === undefined || mat.color === "");
      if (orphanEmptyMaterial) {
        delete out.material;
      }
    }
    return out;
  }

  function captureObjectHistorySnapshot(threeJsonId, object3D) {
    const id = String(threeJsonId || "").trim();
    if (!id) {
      return null;
    }
    const fromRegistry = captureObjectSnapshot(id);
    if (fromRegistry) {
      return normalizeDescriptorForHistorySnapshot(fromRegistry);
    }
    const live = object3D?.userData?.objJson;
    if (live && typeof live === "object" && String(live.threeJsonId || "").trim() === id) {
      return normalizeDescriptorForHistorySnapshot(live);
    }
    return null;
  }

  function applyPropsFromInputs(options = {}) {
    const { silent = false, recordHistory = true, forceRedeploy = false } = options;
    const selectedObj = host.getSelectedObject();
    if (!selectedObj) {
      if (!silent) {
        host.showMessage("请先在场景树中选中对象。", "warning");
      }
      return;
    }
    const data = selectedObj.userData?.objJson;
    if (!data || typeof data !== "object") {
      if (!silent) {
        host.showMessage("当前选中节点无 objJson，无法写回变换。", "warning");
      }
      return;
    }
    const threeJsonId = String(data.threeJsonId || "").trim();
    const beforeObjJson = recordHistory && threeJsonId ? captureObjectHistorySnapshot(threeJsonId, selectedObj) : null;
    const nm = String(prop.name?.value ?? "").trim();
    const prevName = data.name;
    if (nm) {
      data.name = nm;
      selectedObj.name = nm;
    }
    if (nm && nm !== prevName) {
      refreshRegisteredObject(selectedObj, data);
    }
    const lb = String(prop.label?.value ?? "").trim();
    if (lb) {
      data.label = lb;
    } else {
      delete data.label;
    }
    const pos = parseVec3PropInput(prop.position?.value, [0, 0, 0]);
    const rot = parseVec3PropInput(prop.rotation?.value, [0, 0, 0]);
    const scl = parseVec3PropInput(prop.scale?.value, [1, 1, 1]);
    data.position = { x: pos.a, y: pos.b, z: pos.c };
    data.rotation = { rotationX: rot.a, rotationY: rot.b, rotationZ: rot.c };
    data.scale = { scaleX: scl.a, scaleY: scl.b, scaleZ: scl.c };
    writeTextureUrlToObjJson(data, prop.textureUrl?.value ?? "");
    writeTextureRepeatToObjJson(data, {
      x: prop.textureRepeatX?.value,
      y: prop.textureRepeatY?.value
    });
    const nextColor = toHexColorString(prop.color?.value, "#ffffff");
    const nextEmissive = toHexColorString(prop.emissive?.value, "#000000");
    const nextEmissiveIntensity = Number(prop.emissiveIntensity?.value);
    const nextOpacity = clamp01(prop.opacity?.value, 1);
    const nextMetalness = clamp01(prop.metalness?.value, 0);
    const nextRoughness = clamp01(prop.roughness?.value, 1);
    const nextDoubleSide = prop.doubleSide?.checked === true;
    const nextWireframe = prop.wireframe?.checked === true;
    writeMaterialFieldToObjJson(data, "color", nextColor);
    writeMaterialFieldToObjJson(data, "emissive", nextEmissive);
    writeMaterialFieldToObjJson(
      data,
      "emissiveIntensity",
      Number.isFinite(nextEmissiveIntensity) ? nextEmissiveIntensity : 0
    );
    writeMaterialFieldToObjJson(data, "opacity", nextOpacity);
    writeMaterialFieldToObjJson(data, "metalness", nextMetalness);
    writeMaterialFieldToObjJson(data, "roughness", nextRoughness);
    writeMaterialFieldToObjJson(data, "wireframe", nextWireframe);
    writeMaterialFieldToObjJson(data, "side", nextDoubleSide ? "double" : "front");
    selectedObj.visible = prop.visible?.checked !== false;
    data.visible = selectedObj.visible;
    if (prop.castShadow) {
      selectedObj.castShadow = prop.castShadow.checked === true;
      data.castShadow = selectedObj.castShadow;
    }
    if (prop.receiveShadow) {
      selectedObj.receiveShadow = prop.receiveShadow.checked === true;
      data.receiveShadow = selectedObj.receiveShadow;
    }
    const objType = typeof data.objType === "string" ? data.objType.trim().toLowerCase() : "";
    const dismissTriggerEl = document.getElementById("sceneTreePropDismissTrigger");
    if (objType === "infopanel" && dismissTriggerEl) {
      const trigger = normalizeDismissTrigger(dismissTriggerEl.value);
      delete data.fix;
      delete data.dismissTrigger;
      if (trigger === "dblclick") {
        data.fix = false;
      } else if (trigger !== "none") {
        data.fix = false;
        data.dismissTrigger = trigger;
      }
      void host.getSceneRuntime?.()?.eventMechanism?.rebind?.();
    }
    syncEditorMeshVisualFromObjJson(selectedObj, data);
    applyObjectTransform(selectedObj, data);
    syncBoxModelTransformFromObject3D(selectedObj);
    host.getRightSidebarCache?.()?.invalidateRightSidebarSceneJsonTextCache?.();
    if (recordHistory && threeJsonId && beforeObjJson) {
      const afterObjJson = captureObjectHistorySnapshot(threeJsonId, selectedObj);
      if (afterObjJson && JSON.stringify(beforeObjJson) !== JSON.stringify(afterObjJson)) {
        host.getEditorHistory()?.pushObjectObjJsonSnapshot(
          threeJsonId,
          beforeObjJson,
          afterObjJson,
          "场景树属性"
        );
      }
    }
    const doRedeploy =
      forceRedeploy || (isBlurRedeployEnabled() && shouldRedeployForDescriptorMaterial(data));
    if (doRedeploy && threeJsonId) {
      applyPropertyRedeployAfterEdit({ silent: true });
    }
    host.getSceneReserialize?.()?.markSceneNeedsReserialize?.();
    host.getRightSidebarCache?.()?.invalidateRightSidebarSceneJsonTextCache?.();
    const nextSelected = host.getSelectedObject() || selectedObj;
    syncPropInputs(nextSelected);
    host.getEditorInteraction()?.refreshBoxEdge?.(nextSelected);
    host.getEditorInteraction()?.refreshMeshList?.();
    render();
    if (!silent) {
      host.showMessage(
        doRedeploy ? "已应用属性并重建对象。" : "已应用属性到对象。",
        "success"
      );
    }
  }

  function getPropPanelThreeJsonId() {
    return currentPropPanelThreeJsonId;
  }

  function syncPropPanelSelectionFromCache() {
    const hit = findByThreeJsonId(currentPropPanelThreeJsonId);
    if (!hit) {
      return;
    }
    host.setSelectedObject(hit);
    syncPropInputs(hit);
    syncRowHighlight();
  }

  function selectFromTree(obj) {
    if (!obj || isRuntimeOnlyObject(obj)) {
      return;
    }
    host.setSelectedObject(obj);
    syncPropInputs(obj);
    syncRowHighlight();
    host.getCodeEditor?.()?.maybeLocateThreeJsonIdInCodeEditor?.(obj);
  }

  function setSelectionByThreeJsonId(id) {
    const obj = findByThreeJsonId(id);
    if (!obj) {
      return { ok: false, error: `Object not found for threeJsonId "${id}".` };
    }
    selectFromTree(obj);
    return { ok: true };
  }

  prop.applyBtn?.addEventListener("click", () =>
    applyPropsFromInputs({ silent: false, recordHistory: true, forceRedeploy: true })
  );

  const blurApplyInputs = [
    prop.name,
    prop.position,
    prop.rotation,
    prop.scale,
    prop.textureUrl,
    prop.textureRepeatX,
    prop.textureRepeatY,
    prop.emissiveIntensity,
    prop.opacity,
    prop.metalness,
    prop.roughness
  ];
  blurApplyInputs.forEach((input) => {
    input?.addEventListener("blur", () => {
      if (propSyncing || !host.getSelectedObject()) {
        return;
      }
      const isMaterialField =
        input === prop.textureUrl ||
        input === prop.textureRepeatX ||
        input === prop.textureRepeatY ||
        input === prop.emissiveIntensity ||
        input === prop.opacity ||
        input === prop.metalness ||
        input === prop.roughness;
      applyPropsFromInputs({
        silent: true,
        recordHistory: true,
        forceRedeploy: isMaterialField && isBlurRedeployEnabled()
      });
    });
  });

  [prop.visible, prop.castShadow, prop.receiveShadow, prop.color, prop.emissive, prop.doubleSide, prop.wireframe].forEach(
    (input) => {
      input?.addEventListener("change", () => {
        if (propSyncing || !host.getSelectedObject()) {
          return;
        }
        const isMaterialField =
          input === prop.color ||
          input === prop.emissive ||
          input === prop.doubleSide ||
          input === prop.wireframe;
        applyPropsFromInputs({
          silent: true,
          recordHistory: true,
          forceRedeploy: isMaterialField && isBlurRedeployEnabled()
        });
      });
    }
  );

  rootEl?.addEventListener("scroll", () => {}, { passive: true });

  return {
    render,
    clear,
    selectFromTree,
    setSelectionByThreeJsonId,
    findByThreeJsonId,
    getObjectByUuid,
    readThreeJsonId,
    syncPropInputs,
    syncSceneTreeUi,
    applyPropertyRedeployAfterEdit,
    captureObjectHistorySnapshot,
    revealSceneTreeRowForObject,
    isRuntimeOnlyObject,
    getPropPanelThreeJsonId,
    syncPropPanelSelectionFromCache
  };
}

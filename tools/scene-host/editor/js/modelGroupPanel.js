import {
  addObjectFromDescriptor,
  addObjectFromDescriptorAsync,
  captureObjectSnapshot
} from "threejson";
import { getBusinessDomainApi } from "../../../../core/handler/businessDomainRegistry.js";
import { buildEditorPrimitiveDescriptor } from "./editorPrimitiveDescriptors.js";
import { t } from "../../shared/i18n/index.js";

const MODEL_DOMAIN_WHITELIST = new Set([
  "box",
  "wall",
  "glass",
  "floor",
  "door",
  "device.cabinet",
  "nativeThree",
  "sceneHighlight"
]);

const MODEL_DOMAIN_META = {
  box: { label: "盒子", group: "biz", order: 10 },
  wall: { label: "墙体", group: "biz", order: 20 },
  glass: { label: "玻璃", group: "biz", order: 30 },
  floor: { label: "地板", group: "biz", order: 40 },
  door: { label: "门", group: "biz", order: 50 },
  "device.cabinet": { label: "机柜", group: "biz", order: 60 },
  nativeThree: { label: "原生模型", group: "biz", order: 90 },
  sceneHighlight: { label: "场景高亮", group: "biz", order: 100 }
};

const MODEL_GROUP_TITLES = {
  basic: "基本几何体",
  irregular: "组合与不规则",
  fx: "特效与信息",
  biz: "业务模型"
};

function modelLabel(key, fallback) {
  return t(`editor.model.${key}`, fallback || key);
}

function modelGroupTitle(groupKey) {
  return t(`editor.modelGroup.${groupKey}`, MODEL_GROUP_TITLES[groupKey] || groupKey);
}

function getModelPanelGroups() {
  const groups = {
    basic: [
      { key: "box", label: modelLabel("box", "立方体"), kind: "objType" },
      { key: "sphere", label: modelLabel("sphere", "球体"), kind: "objType" },
      { key: "plane", label: modelLabel("plane", "平面"), kind: "objType" },
      { key: "line", label: modelLabel("line", "线段"), kind: "objType" },
      { key: "cylinder", label: modelLabel("cylinder", "圆柱"), kind: "objType" },
      { key: "cone", label: modelLabel("cone", "圆锥"), kind: "objType" },
      { key: "ring", label: modelLabel("ring", "圆环"), kind: "objType" },
      { key: "torus", label: modelLabel("torus", "圆环体"), kind: "objType" },
      { key: "capsule", label: modelLabel("capsule", "胶囊体"), kind: "objType" }
    ],
    irregular: [
      { key: "group", label: modelLabel("group", "分组"), kind: "objType" },
      { key: "shapePlane", label: modelLabel("shapePlane", "不规则平面"), kind: "objType" },
      { key: "irregularPlane", label: modelLabel("irregularPlane", "多边形平面"), kind: "objType" },
      { key: "shapeExtrude", label: modelLabel("shapeExtrude", "拉伸体"), kind: "objType" },
      { key: "irregularGeometry", label: modelLabel("irregularGeometry", "不规则集合体"), kind: "objType" },
      { key: "tube", label: modelLabel("tube", "管线"), kind: "objType" },
      { key: "bufferMesh", label: modelLabel("bufferMesh", "缓冲网格"), kind: "objType" },
      { key: "instanced", label: modelLabel("instanced", "实例化模型"), kind: "objType" }
    ],
    fx: [
      { key: "infoPanel", label: modelLabel("infoPanel", "信息面板"), kind: "objType" },
      { key: "css3dPanel", label: modelLabel("css3dPanel", "CSS3D 面板"), kind: "objType" },
      { key: "heatMap", label: modelLabel("heatMap", "热力图"), kind: "objType" },
      { key: "points", label: modelLabel("points", "点集"), kind: "objType" },
      { key: "sprite", label: modelLabel("sprite", "精灵"), kind: "objType" },
      { key: "audio", label: modelLabel("audio", "音频对象"), kind: "objType" }
    ],
    biz: []
  };
  const apiMap = getBusinessDomainApi();
  const ids = Object.keys(apiMap).filter((id) => MODEL_DOMAIN_WHITELIST.has(id));
  ids.sort((a, b) => (MODEL_DOMAIN_META[a]?.order || 999) - (MODEL_DOMAIN_META[b]?.order || 999));
  for (const id of ids) {
    const meta = MODEL_DOMAIN_META[id] || { label: id, group: "biz", order: 999 };
    groups.biz.push({ key: id, label: modelLabel(id, meta.label), kind: "domain" });
  }
  return groups;
}

function getModelEntryAvailability(entry, host) {
  if (entry.kind === "objType") {
    if (entry.key === "heatMap") {
      return { enabled: false, reason: "热力图需配置数据与贴图后再创建" };
    }
    if (entry.key === "audio") {
      return { enabled: false, reason: "音频对象需先配置音频资源 URL" };
    }
    if (entry.key === "css3dPanel") {
      return {
        enabled: false,
        reason: "CSS3D 面板由 createJsonScene 自动双 pass 加载；编辑器不支持 Raycaster 拾取"
      };
    }
    return { enabled: true, reason: "" };
  }
  if (entry.kind !== "domain") {
    return { enabled: true, reason: "" };
  }
  if (entry.key === "nativeThree") {
    return { enabled: false, reason: "需通过「导入原生 JSON」或文件入口载入" };
  }
  if (entry.key === "sceneHighlight") {
    const runtime = host.getSceneRuntime?.();
    if (!runtime?.composer || !runtime?.camera || !runtime?.renderer) {
      return { enabled: false, reason: "当前场景未初始化高亮所需上下文" };
    }
  }
  return { enabled: true, reason: "" };
}

export function createModelGroupPanel(host) {
  const modelGroupList = document.getElementById("modelGroupList");

  function captureOpenState() {
    if (!modelGroupList) {
      return {};
    }
    const state = {};
    modelGroupList.querySelectorAll("details.modelGroup[data-group-key]").forEach((el) => {
      const key = el.dataset.groupKey;
      if (key && key !== "presets") {
        state[key] = el.open;
      }
    });
    return state;
  }

  function isModelGroupOpenByDefault(groupKey) {
    return groupKey === "basic" || groupKey === "biz";
  }

  function resolveGroupOpen(groupKey, openState) {
    if (Object.prototype.hasOwnProperty.call(openState, groupKey)) {
      return openState[groupKey];
    }
    return isModelGroupOpenByDefault(groupKey);
  }

  async function deployDescriptor(descriptor) {
    const scene = host.getScene();
    const deployOpts = {
      parent: scene,
      context: { scene, camera: host.getCamera() ?? null }
    };
    let res = addObjectFromDescriptor(scene, descriptor, deployOpts);
    if (res.needsAsync) {
      res = await addObjectFromDescriptorAsync(scene, descriptor, deployOpts);
    }
    return res;
  }

  async function addBaseModel(entry) {
    const scene = host.getScene();
    if (!scene?.isScene) {
      return;
    }
    const modelEntry = typeof entry === "string" ? { key: entry, kind: "domain", label: entry } : entry;
    const availability = getModelEntryAvailability(modelEntry, host);
    if (!availability.enabled) {
      if (availability.reason) {
        host.showMessage(availability.reason, "warning");
      }
      return;
    }
    const modelKey = String(modelEntry?.key || "").trim();
    if (!modelKey) {
      return;
    }

    const history = host.getEditorHistory();

    try {
      if (modelEntry.kind === "objType") {
        const descriptor = buildEditorPrimitiveDescriptor(modelKey, host);
        const res = await deployDescriptor(descriptor);
        if (!res.ok) {
          host.showMessage(`添加失败：${res.error || "未知错误"}`, "error");
          return;
        }
        if (res.needsAsync) {
          host.showMessage(`「${modelEntry.label || modelKey}」正在后台加载，请稍候再选中。`, "info");
        }
        const addedSnapshot = captureObjectSnapshot(res.threeJsonId) || descriptor;
        history?.pushObjectAddEntry?.(
          res.threeJsonId,
          addedSnapshot,
          "",
          `添加组件：${modelEntry.label || modelKey}`
        );
        const next = res.object3D;
        if (next) {
          host.setSelectedObject(next);
          host.getEditorInteraction()?.selectFromTree?.(next);
          const boxHelper = host.getEditorInteraction()?.getBoxEdgeHelper?.();
          if (boxHelper?.visible) {
            host.getEditorInteraction()?.refreshBoxEdge?.(next);
          }
        }
        host.getEditorInteraction()?.refreshMeshList?.();
        host.showMessage(`已添加组件：${modelEntry.label || modelKey}`, "success");
        host.getSceneReserialize?.()?.markSceneNeedsReserialize?.();
        host.getSceneTree()?.render?.();
        return;
      }

      const domainApi = getBusinessDomainApi()[modelKey];
      const addToScene = domainApi?.addToScene;
      if (typeof addToScene !== "function") {
        host.showMessage(`当前域暂不支持一键添加：${modelKey}`, "warning");
        return;
      }
      const beforeSnapshot = history?.captureSceneSnapshot?.();
      addToScene(scene);
      if (beforeSnapshot) {
        history?.pushCapturedSceneSnapshot?.(
          beforeSnapshot,
          `添加组件：${modelEntry.label || modelKey}`
        );
      }
      host.getEditorInteraction()?.refreshMeshList?.();
      host.showMessage(`已添加组件：${modelEntry.label || modelKey}`, "success");
      host.getSceneReserialize?.()?.markSceneNeedsReserialize?.();
      host.getSceneTree()?.render?.();
    } catch (error) {
      console.error(error);
      host.showMessage(`添加组件失败：${error?.message || error}`, "error");
    }
  }

  function renderBuiltinGroups(openState = {}) {
    if (!modelGroupList) {
      return;
    }
    modelGroupList
      .querySelectorAll('details.modelGroup[data-group-key]:not([data-group-key="presets"])')
      .forEach((el) => el.remove());
    const groups = getModelPanelGroups();
    const fragment = document.createDocumentFragment();
    for (const groupKey of ["basic", "irregular", "fx", "biz"]) {
      const details = document.createElement("details");
      details.className = "modelGroup";
      details.dataset.groupKey = groupKey;
      details.open = resolveGroupOpen(groupKey, openState);
      const summary = document.createElement("summary");
      summary.className = "modelGroupSummary";
      summary.textContent = modelGroupTitle(groupKey);
      details.appendChild(summary);
      const grid = document.createElement("div");
      grid.className = "buttonGrid";
      for (const item of groups[groupKey] || []) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "toolBtn";
        btn.textContent = item.label;
        const itemAvailability = getModelEntryAvailability(item, host);
        btn.disabled = !itemAvailability.enabled;
        if (!itemAvailability.enabled && itemAvailability.reason) {
          btn.title = itemAvailability.reason;
        }
        btn.addEventListener("click", () => {
          void addBaseModel(item);
        });
        grid.appendChild(btn);
      }
      details.appendChild(grid);
      fragment.appendChild(details);
    }
    const presetGroup = modelGroupList.querySelector('details.modelGroup[data-group-key="presets"]');
    if (presetGroup) {
      modelGroupList.insertBefore(fragment, presetGroup);
    } else {
      modelGroupList.appendChild(fragment);
    }
  }

  function init() {
    const openState = captureOpenState();
    if (modelGroupList) {
      modelGroupList.innerHTML = "";
    }
    renderBuiltinGroups(openState);
  }

  return {
    init,
    refreshBuiltinGroups() {
      renderBuiltinGroups(captureOpenState());
    },
    addBaseModel
  };
}

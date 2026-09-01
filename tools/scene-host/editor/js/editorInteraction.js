import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { DragControls } from "three/examples/jsm/controls/DragControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import {
  clearImpactCheck,
  createBoxEdgeHelper,
  impactHandler,
  pickEditableObject,
  sceneHighlight,
  snapshotBoxModelTransformFromObject3D,
  syncBoxModelTransformFromObject3D,
  trackDisposableResource
} from "threejson";
import { BOX_EDGE_HELPER_DEFAULT_COLOR } from "../../../../core/theme/runtimeVisualDefaults.js";
import {
  HIGHLIGHT_ALARM_RED,
  HIGHLIGHT_LOCATE_AMBER
} from "../../../../domains/sceneHighlight/channels.js";
import { isDescendantOf, isHitOnTransformControlsHelper } from "../../../../core/util/meshPick.js";
import { DEFAULT_EVENT_NOTICE } from "./editorChromeUi.js";

function isEditableMesh(obj, boxEdge) {
  if (!obj || obj === boxEdge?.helper || obj.name === "floor") {
    return false;
  }
  const objType = obj.userData?.objJson?.objType;
  if (!objType) {
    return false;
  }
  const nonEditableTypes = new Set([
    "infoPanel",
    "css3dPanel",
    "light",
    "wind",
    "heatMap",
    "leakLine"
  ]);
  return !nonEditableTypes.has(objType);
}

export function createEditorInteraction(host) {
  const canvasContainer = document.getElementById("canvasContainer");
  const transModeToggle = document.getElementById("transModeToggle");

  let transformControls = null;
  let transformControlsHelper = null;
  let dragControls = null;
  let boxEdge = null;
  let composer = null;
  let selectionVisual = null;
  let highlightPageSetup = null;
  let objectEditActive = false;
  let dragSnapshot = null;
  let meshElementTransformSession = null;
  let listenersBound = false;

  function isCanvasDirtySuppressed() {
    return host.getSuppressCanvasDirty?.()?.isSuppressed?.() ?? false;
  }

  function getScene() {
    return host.getScene();
  }

  function getCamera() {
    return host.getCamera();
  }

  function getRenderer() {
    return host.getRenderer();
  }

  function getControls() {
    return host.getControls();
  }

  function getRenderLoop() {
    return host.getRenderLoop?.();
  }

  function getSysConfig() {
    return host.getSysConfig();
  }

  function getEditorSettings() {
    return host.getEditorSettings();
  }

  function resolveBoxHelperColor() {
    return getEditorSettings()?.editing?.boxHelperColor || BOX_EDGE_HELPER_DEFAULT_COLOR;
  }

  function getHighlightChannelOptions() {
    const channels = getEditorSettings()?.editing?.highlightChannels || {};
    const mk = (hex) => ({ visibleEdgeColor: hex, hiddenEdgeColor: hex });
    return {
      info: mk(channels.info || "#ffffff"),
      locate: mk(channels.locate || HIGHLIGHT_LOCATE_AMBER),
      alarm: mk(channels.alarm || HIGHLIGHT_ALARM_RED)
    };
  }

  function clearHighlights() {
    selectionVisual?.clearHighlight?.();
    selectionVisual?.clearInfoHighlight?.();
    selectionVisual?.clearLocateHighlights?.();
    selectionVisual?.clearAlarmHighlights?.();
  }

  function syncTransModeButtonsActive(mode) {
    document.querySelectorAll("[data-trans-mode]").forEach((btn) => {
      const active = btn.dataset.transMode === mode;
      btn.classList.toggle("editModeSegActive", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function syncTransModeButtonsVisibility() {
    if (transModeToggle) {
      transModeToggle.hidden = !objectEditActive;
    }
  }

  function switchTransMode(mode = "translate", silent = false) {
    if (!transformControls) {
      return;
    }
    transformControls.setMode(mode);
    syncTransModeButtonsActive(mode);
    if (!silent) {
      host.showMessage(`变换模式：${mode}`, "info");
    }
    if (objectEditActive) {
      host.setEventNotice?.(`编辑模式：当前为 ${mode}，拖动 gizmo 编辑物体；右键退出编辑。`);
    }
  }

  function hideBoxEdge() {
    boxEdge?.hide?.();
  }

  function showBoxEdge(obj) {
    if (!obj) {
      return;
    }
    const scene = getScene();
    if (!scene) {
      return;
    }
    if (!boxEdge) {
      boxEdge = createBoxEdgeHelper(scene, resolveBoxHelperColor());
      trackDisposableResource(boxEdge);
    } else if (boxEdge.helper?.material?.color) {
      boxEdge.helper.material.color.set(resolveBoxHelperColor());
    }
    boxEdge.show(obj);
  }

  function refreshBoxEdge(obj) {
    if (objectEditActive && obj) {
      showBoxEdge(obj);
    }
  }

  function refreshBoxEdgeColor() {
    if (boxEdge?.helper?.material?.color) {
      boxEdge.helper.material.color.set(resolveBoxHelperColor());
    }
    const selected = host.getSelectedObject();
    if (objectEditActive && selected) {
      showBoxEdge(selected);
    }
  }

  function getBoxEdgeHelper() {
    return boxEdge?.helper ?? null;
  }

  function detachGizmo() {
    const transientSession = meshElementTransformSession;
    meshElementTransformSession = null;
    objectEditActive = false;
    transformControls?.detach?.();
    transientSession?.onDetach?.(transientSession.target);
    getSysConfig().impactCheckFlag = false;
    hideBoxEdge();
    syncTransModeButtonsVisibility();
  }

  function initTransformControls() {
    const scene = getScene();
    const camera = getCamera();
    const renderer = getRenderer();
    if (!scene || !camera || !renderer?.domElement) {
      return;
    }
    transformControls = new TransformControls(camera, renderer.domElement);
    transformControlsHelper = transformControls.getHelper();
    transformControlsHelper.renderOrder = Infinity;
    scene.add(transformControlsHelper);

    transformControls.addEventListener("mouseDown", () => {
      void host.getAiSidebar?.()?.interruptAiSessionIfActive?.("编辑场景物体");
      const target = transformControls?.object || host.getSelectedObject();
      if (meshElementTransformSession?.target === target) {
        meshElementTransformSession.before = {
          position: target.position.clone(),
          quaternion: target.quaternion.clone(),
          scale: target.scale.clone()
        };
        if (getControls()) getControls().enabled = false;
        return;
      }
      const id = String(target?.userData?.objJson?.threeJsonId || "").trim();
      const before = snapshotBoxModelTransformFromObject3D(target);
      dragSnapshot = id && before ? { threeJsonId: id, before } : null;
      if (getControls()) {
        getControls().enabled = false;
      }
      if (getSysConfig().impactCheckFlag) {
        clearImpactCheck(getScene());
      }
    });

    transformControls.addEventListener("mouseUp", () => {
      if (getControls()) {
        getControls().enabled = true;
      }
      const target = transformControls?.object || host.getSelectedObject();
      if (meshElementTransformSession?.target === target) {
        const session = meshElementTransformSession;
        const before = session.before;
        session.before = null;
        const changed = !before
          || !before.position.equals(target.position)
          || !before.quaternion.equals(target.quaternion)
          || !before.scale.equals(target.scale);
        if (changed) {
          const transform = {
            position: target.position.clone(),
            quaternion: target.quaternion.clone(),
            scale: target.scale.clone()
          };
          const commit = typeof session.onCommitTransform === "function"
            ? session.onCommitTransform(transform, before)
            : session.onCommit?.(target.position.clone(), before?.position);
          void Promise.resolve(commit).catch((error) => {
            host.showMessage(`控制网格顶点更新失败：${error?.message || error}`, "error");
          });
        }
        dragSnapshot = null;
        return;
      }
      if (!isCanvasDirtySuppressed() && target) {
        syncBoxModelTransformFromObject3D(target);
        host.getEditorDomainDrillIn?.()?.syncEditStateAfterTransform?.(target);
        host.getSceneTree()?.syncPropInputs(target);
        host.getSceneReserialize?.()?.markSceneDocumentSynced?.();
        host.getRightSidebarCache?.()?.invalidateRightSidebarSceneJsonTextCache?.();
        if (host.getCodeEditor()?.isCodeEditMode?.()) {
          void host.getCodeEditor()?.refreshFromScene?.();
        }
        if (dragSnapshot?.threeJsonId) {
          const after = snapshotBoxModelTransformFromObject3D(target);
          const beforeJson = JSON.stringify(dragSnapshot.before);
          const afterJson = JSON.stringify(after);
          if (beforeJson !== afterJson) {
            host.getEditorHistory()?.pushTransformDelta(
              dragSnapshot.threeJsonId,
              dragSnapshot.before,
              after,
              "变换物体"
            );
          }
        }
      }
      dragSnapshot = null;
      if (getSysConfig().impactCheckFlag && target) {
        impactHandler(target, getScene());
      }
    });

    transformControls.addEventListener("objectChange", () => {
      if (isCanvasDirtySuppressed() || !transformControls?.object) {
        return;
      }
      host.getSceneReserialize?.()?.markSceneNeedsReserialize?.();
    });

    trackDisposableResource(transformControls);
    trackDisposableResource(transformControlsHelper);
  }

  function ensureTransformControls() {
    const scene = getScene();
    if (!scene || !getCamera() || !getRenderer()?.domElement) {
      return;
    }
    const helperOnScene =
      transformControlsHelper &&
      Array.isArray(scene.children) &&
      scene.children.includes(transformControlsHelper);
    if (transformControls && helperOnScene) {
      return;
    }
    if (transformControls) {
      try {
        transformControls.detach?.();
        transformControls.dispose?.();
      } catch {
        /* ignore */
      }
      transformControls = null;
      transformControlsHelper = null;
    }
    initTransformControls();
  }

  function initHighlight() {
    const scene = getScene();
    const camera = getCamera();
    const renderer = getRenderer();
    if (!scene || !camera || !renderer || composer) {
      return;
    }
    composer = new EffectComposer(renderer);
    trackDisposableResource(composer);
    highlightPageSetup = sceneHighlight.createPageHighlightSetup(scene, camera, {
      composer,
      renderer,
      channelOptions: getHighlightChannelOptions()
    });
    selectionVisual = highlightPageSetup.controller;
    getSysConfig().initFlags.highLightInitFlag = true;
    getRenderLoop()?.setComposer?.(composer);
  }

  function canvasPickNdc(event) {
    if (!canvasContainer) {
      return null;
    }
    const rect = canvasContainer.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const width = rect.width;
    const height = rect.height;
    if (width <= 0 || height <= 0) {
      return null;
    }
    return new THREE.Vector2((localX / width) * 2 - 1, -(localY / height) * 2 + 1);
  }

  function mouseClickObj(event) {
    const ndc = canvasPickNdc(event);
    const scene = getScene();
    const camera = getCamera();
    if (!ndc || !scene || !camera) {
      return null;
    }
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);
    return intersects.length ? intersects[0].object : null;
  }

  function pickCanvasEditableObject(event) {
    const ndc = canvasPickNdc(event);
    const scene = getScene();
    const camera = getCamera();
    if (!ndc || !scene || !camera) {
      return null;
    }
    return pickEditableObject({
      ndc,
      camera,
      scene,
      objects: scene.children,
      isEditable: (obj) => isEditableMesh(obj, boxEdge)
    });
  }

  function enterEditMode(obj) {
    const sysConfig = getSysConfig();
    if (sysConfig.dragLocked || sysConfig.sceneLocked || !transformControls) {
      return;
    }
    if (obj && isEditableMesh(obj, boxEdge) && obj.name !== "XYZ") {
      if (meshElementTransformSession) {
        const previous = meshElementTransformSession;
        meshElementTransformSession = null;
        previous.onDetach?.(previous.target);
      }
      objectEditActive = true;
      transformControls.attach(obj);
      sysConfig.rightClickedFlag = false;
      sysConfig.impactCheckFlag = true;
      switchTransMode(getEditorSettings()?.editing?.defaultTransformMode || "translate", true);
      syncTransModeButtonsVisibility();
      showBoxEdge(obj);
      host.setEventNotice?.("编辑模式：拖动坐标轴编辑物体；右键退出编辑并恢复场景模式。");
    }
  }

  /** Attach the existing TransformControls to an editor-only control-mesh element. The caller
   * owns the transient target and receives one commit callback on mouse-up. */
  function attachMeshElementTransform(target, options = {}) {
    if (!target?.isObject3D) return false;
    ensureTransformControls();
    if (!transformControls) return false;
    if (meshElementTransformSession) {
      const previous = meshElementTransformSession;
      meshElementTransformSession = null;
      previous.onDetach?.(previous.target);
    }
    meshElementTransformSession = {
      target,
      onCommit: options.onCommit,
      onCommitTransform: options.onCommitTransform,
      onDetach: options.onDetach,
      before: null
    };
    objectEditActive = true;
    transformControls.attach(target);
    switchTransMode(options.mode || "translate", true);
    syncTransModeButtonsVisibility();
    hideBoxEdge();
    host.setEventNotice?.("控制网格模式：可切换移动、旋转、缩放；提交后选中控制元素会原子更新。");
    return true;
  }

  function exitEditMode() {
    host.getEditorDomainDrillIn?.()?.resolveOnExit?.();
    detachGizmo();
    switchTransMode(getEditorSettings()?.editing?.defaultTransformMode || "translate", true);
    getSysConfig().rightClickedFlag = true;
    clearHighlights();
    try {
      clearImpactCheck(getScene());
    } catch {
      /* ignore */
    }
    objectEditActive = false;
    refreshMeshList();
    host.setEventNotice?.(DEFAULT_EVENT_NOTICE);
    host.getSceneTree()?.render();
  }

  function selectFromTree(obj) {
    if (!obj || host.getSceneTree()?.isRuntimeOnlyObject(obj)) {
      return;
    }
    detachGizmo();
    clearHighlights();
    host.setSelectedObject(obj);
    selectionVisual?.setHighlight(obj);
    host.getSceneTree()?.syncSceneTreeUi?.();
    host.getCodeEditor?.()?.maybeLocateThreeJsonIdInCodeEditor?.(obj);
    host.setEventNotice?.(
      "已高亮对象。双击场景树：高亮+描边+编辑；画布双击物体：仅描边+编辑；点击物体或坐标轴可取消高亮；右键清除高亮/描边。"
    );
  }

  function selectTreeDoubleClick(obj) {
    if (!obj || host.getSceneTree()?.isRuntimeOnlyObject(obj)) {
      return;
    }
    if (!isEditableMesh(obj, boxEdge)) {
      selectFromTree(obj);
      return;
    }
    const domainRoot = host.getEditorDomainDrillIn?.()?.resolveDomainRootForObject?.(obj);
    if (domainRoot && host.getEditorDomainDrillIn()?.tryEnterOnRootDoubleClick?.(domainRoot)) {
      host.setSelectedObject(obj);
      selectionVisual?.setHighlight(obj);
      host.getSceneTree()?.syncSceneTreeUi?.();
      host.getSceneTree()?.revealSceneTreeRowForObject?.(obj);
      return;
    }
    host.setSelectedObject(obj);
    selectionVisual?.setHighlight(obj);
    enterEditMode(obj);
    host.getSceneTree()?.syncSceneTreeUi?.();
    host.getSceneTree()?.revealSceneTreeRowForObject?.(obj);
  }

  function dismissEditorHighlightOnCanvasPointerDown(event) {
    if (event.button !== 0 || !selectionVisual?.isHighlightActive?.()) {
      return;
    }
    const hit = mouseClickObj(event);
    if (!hit) {
      return;
    }
    const selected = host.getSelectedObject();
    const onSelected = selected && isDescendantOf(hit, selected);
    if (onSelected || isHitOnTransformControlsHelper(hit, transformControlsHelper)) {
      selectionVisual.clearHighlight();
    }
  }

  function onCanvasDoubleClick(event) {
    const currObj = pickCanvasEditableObject(event) ?? mouseClickObj(event);
    if (!currObj) {
      return;
    }
    const domainRoot = host.getEditorDomainDrillIn?.()?.resolveDomainRootForObject?.(currObj);
    if (domainRoot && host.getEditorDomainDrillIn()?.tryEnterOnRootDoubleClick?.(domainRoot)) {
      host.setSelectedObject(currObj);
      clearHighlights();
      host.getSceneTree()?.syncPropInputs(currObj);
      host.getSceneTree()?.render();
      host.getSceneTree()?.revealSceneTreeRowForObject?.(currObj);
      return;
    }
    host.setSelectedObject(currObj);
    clearHighlights();
    if (!isEditableMesh(currObj, boxEdge) && getSysConfig().clickHighLightFlag) {
      selectionVisual?.setHighlight(currObj);
    }
    enterEditMode(currObj);
    host.getSceneTree()?.syncPropInputs(currObj);
    host.getSceneTree()?.render();
    host.getSceneTree()?.revealSceneTreeRowForObject?.(currObj);
  }

  function onCanvasContextMenu(event) {
    event.preventDefault();
    exitEditMode();
  }

  function bindListeners() {
    if (listenersBound) {
      return;
    }
    listenersBound = true;
    document.addEventListener("dblclick", onCanvasDoubleClick);
    canvasContainer?.addEventListener("contextmenu", onCanvasContextMenu);
    canvasContainer?.addEventListener("pointerdown", dismissEditorHighlightOnCanvasPointerDown, true);
  }

  document.querySelectorAll("[data-trans-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.transMode;
      if (mode) {
        host.closeAllDropdowns?.();
        switchTransMode(mode);
      }
    });
  });

  function unbindListeners() {
    if (!listenersBound) {
      return;
    }
    listenersBound = false;
    document.removeEventListener("dblclick", onCanvasDoubleClick);
    canvasContainer?.removeEventListener("contextmenu", onCanvasContextMenu);
    canvasContainer?.removeEventListener("pointerdown", dismissEditorHighlightOnCanvasPointerDown, true);
  }

  function refreshMeshList() {
    const scene = getScene();
    if (!scene) {
      return;
    }
    const list = [];
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj !== boxEdge?.helper) {
        list.push(obj);
      }
    });
    const sysConfig = getSysConfig();
    sysConfig.meshList = list;
    sysConfig.meshObjects = list.filter((obj) => isEditableMesh(obj, boxEdge));
    initDragControls();
    host.getSceneTree()?.render?.();
  }

  function initDragControls() {
    const scene = getScene();
    const camera = getCamera();
    const renderer = getRenderer();
    if (!scene || !camera || !renderer?.domElement) {
      return;
    }
    if (dragControls) {
      dragControls.dispose();
      dragControls = null;
    }
    const objects = getSysConfig().meshObjects || [];
    if (!objects.length) {
      return;
    }
    dragControls = new DragControls(objects, camera, renderer.domElement);
    dragControls.enabled = Boolean(getEditorSettings()?.editing?.dragControlsEnabled);
    dragControls.addEventListener("dragstart", (event) => {
      void host.getAiSidebar?.()?.interruptAiSessionIfActive?.("拖动物体");
      const target = event?.object || host.getSelectedObject();
      const id = String(target?.userData?.objJson?.threeJsonId || "").trim();
      const before = snapshotBoxModelTransformFromObject3D(target);
      dragSnapshot = id && before ? { threeJsonId: id, before } : null;
      if (getControls()) {
        getControls().enabled = false;
      }
    });
    dragControls.addEventListener("dragend", (event) => {
      if (getControls()) {
        getControls().enabled = true;
      }
      refreshMeshList();
      if (isCanvasDirtySuppressed()) {
        dragSnapshot = null;
        return;
      }
      const target = event?.object || host.getSelectedObject();
      if (target) {
        host.getSceneReserialize?.()?.syncAllTransformsFromSceneToLinkedObjJson?.();
        host.getSceneReserialize?.()?.markSceneDocumentSynced?.();
        host.getRightSidebarCache?.()?.invalidateRightSidebarSceneJsonTextCache?.();
        host.getEditorDomainDrillIn?.()?.syncEditStateAfterTransform?.(target);
        host.getSceneTree()?.syncPropInputs(target);
        if (dragSnapshot?.threeJsonId) {
          const after = snapshotBoxModelTransformFromObject3D(target);
          const beforeJson = JSON.stringify(dragSnapshot.before);
          const afterJson = JSON.stringify(after);
          if (beforeJson !== afterJson) {
            host.getEditorHistory()?.pushTransformDelta(
              dragSnapshot.threeJsonId,
              dragSnapshot.before,
              after,
              "拖动物体"
            );
          }
        }
      }
      dragSnapshot = null;
    });
    trackDisposableResource(dragControls);
  }

  function syncDragControlsFromSettings() {
    if (dragControls) {
      dragControls.enabled = Boolean(getEditorSettings()?.editing?.dragControlsEnabled);
      return;
    }
    if (getScene()?.isScene) {
      refreshMeshList();
    }
  }

  function initAfterSceneLoad() {
    ensureTransformControls();
    initHighlight();
    refreshMeshList();
    host.getGridHelper?.()?.syncEditorGridHelperFromSettings?.();
    getRenderLoop()?.setComposer?.(composer || null);
    bindListeners();
    syncTransModeButtonsVisibility();
    host.getViewPreserve?.()?.bindEditorViewPreserveListeners?.();
  }

  function dispose() {
    unbindListeners();
    detachGizmo();
    clearHighlights();
    try {
      transformControls?.dispose?.();
    } catch {
      /* ignore */
    }
    try {
      dragControls?.dispose?.();
    } catch {
      /* ignore */
    }
    dragControls = null;
    transformControls = null;
    transformControlsHelper = null;
    boxEdge = null;
    composer = null;
    selectionVisual = null;
    highlightPageSetup = null;
    dragSnapshot = null;
    objectEditActive = false;
    getRenderLoop()?.setComposer?.(null);
  }

  return {
    initAfterSceneLoad,
    dispose,
    selectFromTree,
    selectTreeDoubleClick,
    enterEditMode,
    exitEditMode,
    clearHighlights,
    refreshBoxEdge,
    refreshBoxEdgeColor,
    getBoxEdgeHelper,
    getTransformControls: () => transformControls,
    getComposer: () => composer,
    getTransformControlsHelper: () => transformControlsHelper,
    attachMeshElementTransform,
    isObjectEditActive: () => objectEditActive,
    syncTransModeButtonsVisibility,
    syncDragControlsFromSettings,
    refreshMeshList,
    ensureTransformControls,
    detachGizmo,
    switchTransMode
  };
}

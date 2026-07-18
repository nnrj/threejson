import * as THREE from "three";
import { removeObjectById } from "threejson";
import {
  exportSceneTreeContextObjectGlb,
  exportSceneTreeContextObjectJson,
  exportSceneTreeContextObjectTjz
} from "./editorObjectExport.js";

export function resolveRemoveCaptureSubtree(target) {
  const data = target?.userData?.objJson;
  const objType = String(data?.objType || "").trim().toLowerCase();
  const isGroupLike = target instanceof THREE.Group || objType === "group";
  if (!isGroupLike) {
    return false;
  }
  const hasEmbedded =
    (Array.isArray(data?.boxModelList) && data.boxModelList.length > 0) ||
    (Array.isArray(data?.subGroup) && data.subGroup.length > 0) ||
    (Array.isArray(data?.subScene) && data.subScene.length > 0);
  return !hasEmbedded;
}

export function createSceneTreeContextMenu(host) {
  const menuEl = document.getElementById("sceneTreeContextMenu");
  const rootEl = document.getElementById("sceneTreeRoot");
  const exportItem = document.getElementById("sceneTreeContextExportItem");
  const exportJsonBtn = document.getElementById("sceneTreeContextExportJsonBtn");
  const exportTjzBtn = document.getElementById("sceneTreeContextExportTjzBtn");
  const exportGlbBtn = document.getElementById("sceneTreeContextExportGlbBtn");
  const toggleVisibleBtn = document.getElementById("sceneTreeContextToggleVisibleBtn");
  const deleteBtn = document.getElementById("sceneTreeContextDeleteBtn");

  let targetUuid = "";

  function resolveTargetUuid() {
    return String(targetUuid || "").trim();
  }

  function getTargetObject() {
    return host.getSceneTree()?.getObjectByUuid?.(resolveTargetUuid()) ?? null;
  }

  function close() {
    menuEl?.classList.remove("visible");
    targetUuid = "";
    exportItem?.classList.remove("submenuFlipLeft");
    updateSubmenuArrow(exportItem);
  }

  function updateSubmenuArrow(item) {
    const arrow = item?.querySelector(".sceneTreeContextArrow");
    if (!arrow) {
      return;
    }
    arrow.textContent = item.classList.contains("submenuFlipLeft") ? "◂" : "▸";
  }

  function syncSubmenuFlip() {
    const submenu = exportItem?.querySelector(".sceneTreeContextSubmenu");
    if (!exportItem || !submenu || !menuEl?.classList.contains("visible")) {
      return;
    }
    const gap = 4;
    const prevDisplay = submenu.style.display;
    const prevVisibility = submenu.style.visibility;
    const prevPointerEvents = submenu.style.pointerEvents;
    submenu.style.visibility = "hidden";
    submenu.style.display = "block";
    submenu.style.pointerEvents = "none";
    const submenuWidth = submenu.offsetWidth + 8;
    submenu.style.display = prevDisplay;
    submenu.style.visibility = prevVisibility;
    submenu.style.pointerEvents = prevPointerEvents;

    const itemRect = exportItem.getBoundingClientRect();
    const needsFlip = itemRect.right + submenuWidth + gap > window.innerWidth;
    exportItem.classList.toggle("submenuFlipLeft", needsFlip);
    updateSubmenuArrow(exportItem);
  }

  function updateVisibilityLabel(target) {
    if (!toggleVisibleBtn) {
      return;
    }
    const isVisible = target?.visible !== false;
    toggleVisibleBtn.textContent = isVisible ? "隐藏" : "显示";
  }

  function openAt(clientX, clientY, uuid) {
    if (!menuEl || !uuid) {
      return;
    }
    targetUuid = uuid;
    updateVisibilityLabel(getTargetObject());
    exportItem?.classList.remove("submenuFlipLeft");
    updateSubmenuArrow(exportItem);
    menuEl.classList.add("visible");
    menuEl.style.left = "0px";
    menuEl.style.top = "0px";
    const menuRect = menuEl.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - menuRect.width - 8);
    const maxTop = Math.max(8, window.innerHeight - menuRect.height - 8);
    const left = Math.min(Math.max(8, clientX), maxLeft);
    const top = Math.min(Math.max(8, clientY), maxTop);
    menuEl.style.left = `${left}px`;
    menuEl.style.top = `${top}px`;
    requestAnimationFrame(() => {
      syncSubmenuFlip();
      requestAnimationFrame(syncSubmenuFlip);
    });
  }

  function toggleObjectVisibility(target) {
    if (!target) {
      return;
    }
    target.visible = !target.visible;
    if (target.userData?.objJson && typeof target.userData.objJson === "object") {
      target.userData.objJson.visible = target.visible;
    }
    host.getSceneReserialize?.()?.markSceneNeedsReserialize?.();
    const selected = host.getSelectedObject();
    host.getSceneTree()?.syncPropInputs?.(selected?.uuid === target.uuid ? selected : selected || target);
    host.getSceneTree()?.render?.();
  }

  async function deleteSceneObject(target) {
    const scene = host.getScene();
    if (!target?.uuid || !scene?.isScene) {
      return;
    }
    const ok = await host.confirmYesNo(`是否确认删除对象 [${target.name || target.uuid}] ?`, { title: "删除对象" });
    if (!ok) {
      return;
    }
    const threeJsonId = String(target.userData?.objJson?.threeJsonId || "").trim();
    if (!threeJsonId) {
      host.showMessage("无法删除：对象缺少 threeJsonId。", "warning");
      return;
    }
    const captureSubtree = resolveRemoveCaptureSubtree(target);
    const removed = removeObjectById(scene, threeJsonId, { captureSubtree });
    if (!removed.ok) {
      if (removed.protected) {
        host.showMessage("无法删除受保护的运行时对象（相机/渲染器等）。", "warning");
      } else {
        host.showMessage(`删除失败：${removed.error || "未知错误"}`, "warning");
      }
      return;
    }
    host.getEditorHistory()?.pushObjectRemoveEntry?.(removed, "删除物体");
    if (host.getSelectedObject()?.uuid === target.uuid) {
      host.setSelectedObject(null);
      host.getSceneTree()?.syncPropInputs?.(null);
    }
    host.showMessage("删除成功，点击保存可导出最新场景。", "success");
    host.getEditorInteraction()?.refreshMeshList?.();
    host.getSceneReserialize?.()?.markSceneNeedsReserialize?.();
    host.getSceneTree()?.render?.();
  }

  function init() {
    exportItem?.addEventListener("pointerenter", () => {
      syncSubmenuFlip();
    });
    exportJsonBtn?.addEventListener("click", () => {
      void exportSceneTreeContextObjectJson(host, resolveTargetUuid());
      close();
    });
    exportTjzBtn?.addEventListener("click", () => {
      void exportSceneTreeContextObjectTjz(host, resolveTargetUuid());
      close();
    });
    exportGlbBtn?.addEventListener("click", () => {
      void exportSceneTreeContextObjectGlb(host, resolveTargetUuid());
      close();
    });
    toggleVisibleBtn?.addEventListener("click", () => {
      const targetObj = getTargetObject();
      close();
      if (!targetObj) {
        host.showMessage("未定位到对象。", "warning");
        return;
      }
      toggleObjectVisibility(targetObj);
    });
    deleteBtn?.addEventListener("click", () => {
      const targetObj = getTargetObject();
      close();
      if (!targetObj) {
        host.showMessage("未定位到要删除的对象。", "warning");
        return;
      }
      void deleteSceneObject(targetObj);
    });

    document.addEventListener("click", (event) => {
      if (!menuEl?.classList.contains("visible")) {
        return;
      }
      if (menuEl.contains(event.target)) {
        return;
      }
      close();
    });
    document.addEventListener("contextmenu", (event) => {
      if (!menuEl?.classList.contains("visible")) {
        return;
      }
      if (menuEl.contains(event.target)) {
        return;
      }
      if (event.target?.closest?.(".sceneTreeRow")) {
        return;
      }
      close();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        close();
      }
    });
    window.addEventListener("resize", close);
    rootEl?.addEventListener("scroll", close, { passive: true });
  }

  return {
    init,
    openAt,
    close
  };
}

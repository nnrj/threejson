import {
  deleteUserScenePreset,
  loadPresetSceneEntries,
  readPresetJson,
  readScenePresetsRecord,
  renameUserScenePreset
} from "../../shared/js/scenePresetsStore.js";
import { openOrCloseProgressManager } from "threejson";

const MODEL_GROUP_TITLE = "场景预设";

export function createPresetScenePanel(host) {
  const modelGroupList = document.getElementById("modelGroupList");
  const contextMenu = document.getElementById("presetSceneContextMenu");
  const contextRenameBtn = document.getElementById("presetSceneContextRenameBtn");
  const contextDeleteBtn = document.getElementById("presetSceneContextDeleteBtn");
  let contextTargetId = "";

  function captureOpenState() {
    if (!modelGroupList) {
      return {};
    }
    const state = {};
    modelGroupList.querySelectorAll("details.modelGroup[data-group-key]").forEach((el) => {
      const key = el.dataset.groupKey;
      if (key) {
        state[key] = el.open;
      }
    });
    return state;
  }

  function resolveGroupOpen(groupKey, openState) {
    if (Object.prototype.hasOwnProperty.call(openState, groupKey)) {
      return openState[groupKey];
    }
    return groupKey === "presets";
  }

  function closePresetSceneContextMenu() {
    contextMenu?.classList.remove("visible");
    contextMenu?.setAttribute("hidden", "");
    contextTargetId = "";
  }

  function openPresetSceneContextMenu(clientX, clientY, presetId) {
    if (!contextMenu || !presetId) {
      return;
    }
    contextTargetId = presetId;
    contextMenu.removeAttribute("hidden");
    contextMenu.classList.add("visible");
    contextMenu.style.left = "0px";
    contextMenu.style.top = "0px";
    const menuRect = contextMenu.getBoundingClientRect();
    const left = Math.min(clientX, window.innerWidth - menuRect.width - 8);
    const top = Math.min(clientY, window.innerHeight - menuRect.height - 8);
    contextMenu.style.left = `${Math.max(8, left)}px`;
    contextMenu.style.top = `${Math.max(8, top)}px`;
  }

  async function openPresetScene(entry) {
    if (!entry?.id) {
      host.showMessage("场景预设配置无效。", "warning");
      return;
    }
    const ok = await host.confirmOverwriteIfDirty?.({ actionLabel: "打开场景预设" });
    if (!ok) {
      return;
    }
    const parsed = await readPresetJson(entry.id);
    if (!parsed) {
      host.showMessage("场景预设缓存不存在，请刷新页面后重试。", "warning");
      return;
    }
    host.toggleStartupEmptyState?.(false);
    host.getUi?.()?.setLoadingMessage?.("正在加载场景预设...");
    openOrCloseProgressManager(true);
    const loaded = await host.ingestScenePayload(parsed, entry.label || entry.id);
    if (!loaded) {
      host.getUi?.()?.setLoading?.(false);
      openOrCloseProgressManager(false);
      return;
    }
    host.markSceneSaved?.();
    host.getEditorDocumentState?.()?.syncDocumentTitle?.();
  }

  function renderPresetGroup(entries, openState = {}) {
    if (!modelGroupList || !Array.isArray(entries) || !entries.length) {
      return;
    }
    modelGroupList.querySelector('details.modelGroup[data-group-key="presets"]')?.remove();
    const details = document.createElement("details");
    details.className = "modelGroup";
    details.dataset.groupKey = "presets";
    details.open = resolveGroupOpen("presets", openState);
    const summary = document.createElement("summary");
    summary.className = "modelGroupSummary";
    summary.textContent = MODEL_GROUP_TITLE;
    details.appendChild(summary);
    const grid = document.createElement("div");
    grid.className = "buttonGrid";
    for (const entry of entries) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = entry.source === "user" ? "toolBtn presetSceneBtnUser" : "toolBtn";
      btn.textContent = entry.label;
      btn.dataset.presetId = entry.id;
      btn.title =
        entry.source === "user" ? `打开自定义预设：${entry.label}` : `打开整场景：${entry.label}`;
      btn.addEventListener("click", () => {
        void openPresetScene(entry);
      });
      if (entry.source === "user") {
        btn.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          event.stopPropagation();
          openPresetSceneContextMenu(event.clientX, event.clientY, entry.id);
        });
      }
      grid.appendChild(btn);
    }
    details.appendChild(grid);
    modelGroupList.appendChild(details);
  }

  async function refresh() {
    if (!modelGroupList) {
      return;
    }
    const openState = captureOpenState();
    try {
      const entries = await loadPresetSceneEntries();
      renderPresetGroup(entries, openState);
    } catch (error) {
      console.warn("[scene-editor preset panel]", error);
      host.showMessage("场景预设清单加载失败。", "warning");
    }
  }

  function wireContextMenu() {
    contextRenameBtn?.addEventListener("click", () => {
      void (async () => {
        const presetId = contextTargetId;
        closePresetSceneContextMenu();
        if (!presetId) {
          return;
        }
        const record = await readScenePresetsRecord();
        const preset = record.presets?.[presetId];
        if (!preset || preset.source !== "user") {
          return;
        }
        const nextLabel = await host.getSceneNameModals?.()?.openSceneNameModalAndWait?.(
          preset.label,
          {
            title: "重命名预设",
            nameLabel: "预设名称",
            hint: "请输入新的预设名称。",
            confirmLabel: "保存"
          }
        );
        if (!nextLabel) {
          return;
        }
        const ok = await renameUserScenePreset(presetId, nextLabel);
        if (ok) {
          await refresh();
          host.showMessage("预设已重命名。", "success");
        }
      })();
    });
    contextDeleteBtn?.addEventListener("click", () => {
      void (async () => {
        const presetId = contextTargetId;
        closePresetSceneContextMenu();
        if (!presetId) {
          return;
        }
        const record = await readScenePresetsRecord();
        const preset = record.presets?.[presetId];
        if (!preset || preset.source !== "user") {
          return;
        }
        const ok = window.confirm(`确定删除预设「${preset.label}」？此操作不可恢复。`);
        if (!ok) {
          return;
        }
        await deleteUserScenePreset(presetId);
        await refresh();
        host.showMessage("预设已删除。", "success");
      })();
    });
    contextMenu?.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    document.addEventListener("click", (event) => {
      if (!contextMenu?.classList.contains("visible")) {
        return;
      }
      if (contextMenu.contains(event.target)) {
        return;
      }
      closePresetSceneContextMenu();
    });
  }

  async function init() {
    wireContextMenu();
    await refresh();
  }

  return {
    init,
    refresh,
    async openPresetById(presetId) {
      const entries = await loadPresetSceneEntries();
      const entry = entries.find((item) => item.id === presetId);
      if (!entry) {
        host.showMessage("场景预设尚未就绪，请稍后重试。", "warning");
        return;
      }
      host.closeAllDropdowns?.();
      await openPresetScene(entry);
    }
  };
}

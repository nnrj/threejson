import { parseSceneJsonString, resolveScenePayloadForLoad } from "threejson";
import {
  EDITOR_RECENT_SCENES_KEY,
  EDITOR_SCENE_SNAPSHOT_KEY,
  editorSessionIdbGet,
  editorSessionIdbPut
} from "../../shared/js/editorSessionIdb.js";
import { readUserSavedBaselineRecord } from "../../shared/js/userBaselineStore.js";
import {
  buildCaptureOptionsForContext,
  captureCurrentSessionJsonText
} from "./editorSessionCapture.js";

const MAX_RECENT_SCENES = 12;

const GENERIC_RECENT_SCENE_LABELS = new Set([
  "快照恢复",
  "最近打开场景",
  "场景JSON侧栏",
  "AI 阶段预览",
  "已保存场景",
  "未命名场景",
  "未命名文件"
]);

function isGenericRecentSceneLabel(label) {
  const text = String(label || "").trim();
  return !text || GENERIC_RECENT_SCENE_LABELS.has(text);
}

function readSceneDocumentNameFromPayload(payload) {
  const label = String(payload?.label || "").trim();
  if (label) {
    return label;
  }
  const name = String(payload?.name || "").trim();
  return name || "";
}

function resolveRecentSceneDisplayLabel(payload, hintLabel = "", priorLabel = "") {
  const docName = readSceneDocumentNameFromPayload(payload);
  if (docName) {
    return docName;
  }
  const base = String(hintLabel || "").trim().split(/[/\\]/).pop() || "";
  if (/\.json$/i.test(base)) {
    return base;
  }
  const prior = String(priorLabel || "").trim();
  if (prior && !isGenericRecentSceneLabel(prior)) {
    return prior;
  }
  const hint = String(hintLabel || "").trim();
  if (hint && !isGenericRecentSceneLabel(hint)) {
    return hint;
  }
  return "未命名场景";
}

function formatRecentSceneEntry(one) {
  let title = String(one?.label || one?.name || "").trim();
  if (isGenericRecentSceneLabel(title)) {
    title = String(one?.name || "").trim();
  }
  if (!title || isGenericRecentSceneLabel(title)) {
    title = "未命名场景";
  }
  const time = Number(one?.updatedAt) || 0;
  const when = time ? new Date(time).toLocaleString() : "未知时间";
  return { title, when };
}

function ensureSceneDocumentThreeJsonId(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "";
  }
  const current = String(payload.threeJsonId || "").trim();
  if (current) {
    return current;
  }
  const next =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `scene-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  payload.threeJsonId = next;
  return next;
}

export function createRecentScenesController(host) {
  let items = [];

  const dom = {
    menuList: document.getElementById("menuRecentScenesList"),
    emptyList: document.getElementById("emptyStateRecentList"),
    modalList: document.getElementById("recentScenesModalList"),
    modal: document.getElementById("recentScenesModal"),
    modalClose: document.getElementById("recentScenesModalCloseBtn")
  };

  async function readRecentScenesRecord() {
    const current = await editorSessionIdbGet(EDITOR_RECENT_SCENES_KEY);
    if (current && typeof current === "object" && Array.isArray(current.items)) {
      return current;
    }
    return { version: 1, items: [] };
  }

  async function writeRecentScenes(nextItems) {
    const cleaned = Array.isArray(nextItems) ? nextItems.slice(0, MAX_RECENT_SCENES) : [];
    await editorSessionIdbPut(EDITOR_RECENT_SCENES_KEY, {
      version: 1,
      items: cleaned,
      updatedAt: Date.now()
    });
    items = cleaned;
    syncUi();
  }

  async function readSceneSnapshotsRecord() {
    const current = await editorSessionIdbGet(EDITOR_SCENE_SNAPSHOT_KEY);
    if (current && typeof current === "object" && current.scenes && typeof current.scenes === "object") {
      return current;
    }
    return { version: 1, scenes: {} };
  }

  async function writeSceneSnapshot(sceneThreeJsonId, jsonText) {
    const key = String(sceneThreeJsonId || "").trim();
    if (!key || !jsonText) {
      return;
    }
    const record = await readSceneSnapshotsRecord();
    record.scenes[key] = {
      json: String(jsonText),
      updatedAt: Date.now()
    };
    await editorSessionIdbPut(EDITOR_SCENE_SNAPSHOT_KEY, record);
  }

  async function readSceneSnapshot(sceneThreeJsonId) {
    const key = String(sceneThreeJsonId || "").trim();
    if (!key) {
      return null;
    }
    const record = await readSceneSnapshotsRecord();
    return record.scenes?.[key] || null;
  }

  function renderList(hostEl, withRemove = false) {
    if (!hostEl) {
      return;
    }
    hostEl.innerHTML = "";
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "topDropdownInfo";
      empty.textContent = "暂无记录";
      hostEl.appendChild(empty);
      return;
    }
    items.forEach((one) => {
      const meta = formatRecentSceneEntry(one);
      if (withRemove) {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.gap = "6px";
        row.style.alignItems = "center";
        const openBtn = document.createElement("button");
        openBtn.type = "button";
        openBtn.className = "editorStartupRecentItem";
        openBtn.innerHTML = `${meta.title}<div class="editorStartupRecentMeta">${meta.when}</div>`;
        openBtn.addEventListener("click", () => {
          void openById(one.sceneThreeJsonId);
        });
        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "miniBtn";
        delBtn.textContent = "删除";
        delBtn.addEventListener("click", () => {
          void removeEntry(one.sceneThreeJsonId);
        });
        row.appendChild(openBtn);
        row.appendChild(delBtn);
        hostEl.appendChild(row);
        return;
      }
      const row = document.createElement("button");
      row.type = "button";
      row.className = "editorStartupRecentItem";
      row.innerHTML = `${meta.title}<div class="editorStartupRecentMeta">${meta.when}</div>`;
      row.addEventListener("click", () => {
        host.closeAllDropdowns?.();
        void openById(one.sceneThreeJsonId);
      });
      hostEl.appendChild(row);
    });
  }

  function syncUi() {
    renderList(dom.menuList, false);
    renderList(dom.emptyList, false);
    renderList(dom.modalList, true);
  }

  async function repairRecentSceneLabelsIfNeeded() {
    const list = Array.isArray(items) ? [...items] : [];
    let changed = false;
    const baselineRecord = await readUserSavedBaselineRecord();
    for (const one of list) {
      if (!isGenericRecentSceneLabel(one?.label) && one?.name) {
        continue;
      }
      const key = String(one?.sceneThreeJsonId || "").trim();
      if (!key) {
        continue;
      }
      const baselineLabel = baselineRecord.scenes?.[key]?.label;
      const snap = await readSceneSnapshot(key);
      if (!snap?.json) {
        if (baselineLabel && !isGenericRecentSceneLabel(baselineLabel) && baselineLabel !== one.label) {
          one.label = baselineLabel;
          one.name = baselineLabel;
          changed = true;
        }
        continue;
      }
      try {
        const parsed = parseSceneJsonString(snap.json);
        const payload = resolveScenePayloadForLoad(parsed);
        const fixed = resolveRecentSceneDisplayLabel(payload, one?.label || "", baselineLabel || "");
        const docName = readSceneDocumentNameFromPayload(payload);
        if (fixed !== one.label || (docName && docName !== one.name)) {
          one.label = fixed;
          if (docName) {
            one.name = docName;
          }
          changed = true;
        }
      } catch (error) {
        console.warn("[scene-editor recent] repair label failed:", error);
      }
    }
    if (changed) {
      await writeRecentScenes(list);
    }
  }

  async function loadFromStorage() {
    const record = await readRecentScenesRecord();
    items = record.items || [];
    await repairRecentSceneLabelsIfNeeded();
    syncUi();
  }

  async function upsertEntry(entry) {
    const key = String(entry?.sceneThreeJsonId || "").trim();
    if (!key) {
      return;
    }
    const now = Date.now();
    const merged = { ...entry, sceneThreeJsonId: key, updatedAt: now };
    const next = [merged];
    for (const one of items) {
      if (String(one?.sceneThreeJsonId || "").trim() === key) {
        continue;
      }
      next.push(one);
      if (next.length >= MAX_RECENT_SCENES) {
        break;
      }
    }
    await writeRecentScenes(next);
  }

  async function removeEntry(sceneThreeJsonId) {
    const key = String(sceneThreeJsonId || "").trim();
    if (!key) {
      return;
    }
    const next = items.filter((one) => String(one?.sceneThreeJsonId || "").trim() !== key);
    await writeRecentScenes(next);
  }

  async function clearHistory() {
    await writeRecentScenes([]);
    host.showMessage("已清除最近打开列表（场景快照缓存仍保留）。", "info");
  }

  async function captureSessionJsonText(captureOptions) {
    const options = captureOptions || buildCaptureOptionsForContext(host, "fullReplace");
    return captureCurrentSessionJsonText(host, options);
  }

  async function saveCurrentScene(label = "", captureOptions) {
    try {
      const payload = host.getSysConfig()?.jsonData;
      const sceneThreeJsonId = ensureSceneDocumentThreeJsonId(payload || {});
      if (!sceneThreeJsonId) {
        return;
      }
      const json = await captureSessionJsonText(captureOptions);
      if (!json) {
        return;
      }
      await writeSceneSnapshot(sceneThreeJsonId, json);
      const recentLabel = resolveRecentSceneDisplayLabel(payload, label, host.getCurrentSceneLabel?.() || "");
      await upsertEntry({
        sceneThreeJsonId,
        label: recentLabel,
        name: readSceneDocumentNameFromPayload(payload) || recentLabel
      });
    } catch (error) {
      console.warn("[scene-editor recent]", error);
    }
  }

  async function openById(sceneThreeJsonId) {
    const snap = await readSceneSnapshot(sceneThreeJsonId);
    if (!snap?.json) {
      host.showMessage("该历史记录的缓存场景不存在，请重新从文件打开。", "warning");
      host.toggleStartupEmptyState?.(true);
      return false;
    }
    const parsed = parseSceneJsonString(snap.json);
    const payload = resolveScenePayloadForLoad(parsed);
    const existingEntry = items.find(
      (one) => String(one?.sceneThreeJsonId || "").trim() === String(sceneThreeJsonId || "").trim()
    );
    const openLabel = resolveRecentSceneDisplayLabel(payload, existingEntry?.label || "");
    dom.modal?.classList.remove("visible");
    const ok = await host.confirmOverwriteIfDirty?.({
      actionLabel: "打开最近场景"
    });
    if (!ok) {
      return false;
    }
    const loaded = await host.ingestScenePayload(parsed, openLabel);
    host.toggleStartupEmptyState?.(false);
    return true;
  }

  dom.modalClose?.addEventListener("click", () => {
    dom.modal?.classList.remove("visible");
  });
  dom.modal?.addEventListener("click", (event) => {
    if (event.target === dom.modal) {
      dom.modal.classList.remove("visible");
    }
  });

  return {
    loadFromStorage,
    saveCurrentScene,
    openById,
    removeEntry,
    clearHistory,
    writeSceneSnapshot,
    upsertEntry,
    syncUi,
    getFirstSceneId: () => String(items[0]?.sceneThreeJsonId || "").trim(),
    openModal() {
      syncUi();
      dom.modal?.classList.add("visible");
    }
  };
}

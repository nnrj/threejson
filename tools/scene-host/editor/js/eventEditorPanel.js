import { parseEventScript } from "../../../../core/runtime/eventMechanism/eventScript/parser.js";
import { resolveEventScriptMode } from "../../../../core/runtime/eventMechanism/eventScript/config.js";
import { listObjTypeEventCapabilities } from "../../../../core/runtime/eventMechanism/objTypeEventCapabilities.js";
import { resolveDomainDeployRoot } from "../lib/domainEditSession.js";

function el(id) {
  return document.getElementById(id);
}

function normalizeObjType(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function eventLabel(name) {
  return String(name || "").trim();
}

function collectEventScriptLibraryEntries(host) {
  const data = host.getSysConfig()?.jsonData;
  const list = [];
  const pushEntry = (entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const id = String(entry.threeJsonId || entry.id || "").trim();
    if (!id) {
      return;
    }
    const kind = String(entry.assetKind || "").trim().toLowerCase();
    if (kind !== "eventscript") {
      return;
    }
    list.push({
      id,
      name: String(entry.name || id).trim()
    });
  };
  if (Array.isArray(data?.assetLibrary)) {
    data.assetLibrary.forEach(pushEntry);
  }
  if (Array.isArray(data?.worldInfo?.assetLibrary)) {
    data.worldInfo.assetLibrary.forEach(pushEntry);
  }
  return list;
}

function resolveSelectedEventTarget(host) {
  const selected = host.getSelectedObject?.();
  const scene = host.getScene?.();
  if (!selected) {
    return null;
  }
  const domainRoot = resolveDomainDeployRoot(selected, scene);
  if (domainRoot) {
    return { kind: "domain", object3D: domainRoot };
  }
  const objJson = selected.userData?.objJson;
  if (!objJson || typeof objJson !== "object") {
    return null;
  }
  return { kind: "plain", object3D: selected, objJson };
}

export function createEventEditorPanel(host) {
  const hintEl = el("eventEditorHint");
  const domainBlankEl = el("eventEditorDomainBlank");
  const formEl = el("eventEditorForm");
  const objectLabelEl = el("eventEditorObjectLabel");
  const eventSelectEl = el("eventEditorEventName");
  const modeBadgeEl = el("eventEditorModeBadge");
  const scriptEl = el("eventEditorScript");
  const parseStatusEl = el("eventEditorParseStatus");
  const pickLibBtn = el("eventEditorPickLibBtn");
  const toggleModeBtn = el("eventEditorToggleModeBtn");
  const resetBtn = el("eventEditorResetBtn");
  const applyBtn = el("eventEditorApplyBtn");
  const libDialog = el("eventEditorLibDialog");
  const libListEl = el("eventEditorLibList");
  const libCancelBtn = el("eventEditorLibCancelBtn");

  let syncing = false;

  function setParseStatus(text, kind = "") {
    if (!parseStatusEl) {
      return;
    }
    parseStatusEl.textContent = text || "";
    parseStatusEl.dataset.kind = kind;
  }

  function runLightweightParse(source, mode) {
    const text = String(source || "");
    if (!text.trim()) {
      setParseStatus("");
      return;
    }
    if (mode === "javascript") {
      setParseStatus("JavaScript 模式：保存前不做 DSL 语法校验。", "info");
      return;
    }
    try {
      parseEventScript(text);
      setParseStatus("DSL 语法检查通过。", "ok");
    } catch (error) {
      setParseStatus(String(error.message || error), "error");
    }
  }

  function listEventNamesForTarget(target) {
    const objJson = target.objJson;
    const objType = normalizeObjType(objJson.objType);
    const allowed = listObjTypeEventCapabilities(objType);
    const existing = objJson.events && typeof objJson.events === "object" ? Object.keys(objJson.events) : [];
    const merged = new Set([...allowed, ...existing.map((name) => eventLabel(name)).filter(Boolean)]);
    return Array.from(merged).sort();
  }

  function readCurrentEventConfig(objJson, eventName) {
    const events = objJson.events && typeof objJson.events === "object" ? objJson.events : {};
    const cfg = events[eventName];
    return cfg && typeof cfg === "object" ? cfg : {};
  }

  function fillEventSelect(names, selectedName) {
    if (!eventSelectEl) {
      return;
    }
    eventSelectEl.innerHTML = "";
    if (!names.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "（无可编辑事件）";
      eventSelectEl.appendChild(opt);
      eventSelectEl.disabled = true;
      return;
    }
    eventSelectEl.disabled = false;
    for (const name of names) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      eventSelectEl.appendChild(opt);
    }
    if (selectedName && names.includes(selectedName)) {
      eventSelectEl.value = selectedName;
    }
  }

  function syncFromSelection() {
    syncing = true;
    try {
      const targetWrap = resolveSelectedEventTarget(host);
      if (!targetWrap) {
        if (hintEl) {
          hintEl.hidden = false;
          hintEl.textContent = "请先在场景树中选中对象。";
        }
        domainBlankEl && (domainBlankEl.hidden = true);
        formEl && (formEl.hidden = true);
        return;
      }
      if (targetWrap.kind === "domain") {
        if (hintEl) {
          hintEl.hidden = true;
        }
        domainBlankEl && (domainBlankEl.hidden = false);
        formEl && (formEl.hidden = true);
        return;
      }

      const { object3D, objJson } = targetWrap;
      if (hintEl) {
        hintEl.hidden = true;
      }
      domainBlankEl && (domainBlankEl.hidden = true);
      formEl && (formEl.hidden = false);

      const label =
        String(objJson.label || objJson.name || object3D.name || objJson.threeJsonId || "").trim() ||
        "未命名对象";
      if (objectLabelEl) {
        objectLabelEl.value = label;
      }

      const names = listEventNamesForTarget(targetWrap);
      const prevEvent = eventSelectEl?.value || "";
      fillEventSelect(names, names.includes(prevEvent) ? prevEvent : names[0]);

      const eventName = eventSelectEl?.value || "";
      const eventCfg = readCurrentEventConfig(objJson, eventName);
      const sceneConfig = host.getSysConfig()?.jsonData?.sceneConfig;
      const mode = resolveEventScriptMode(sceneConfig, eventCfg);
      if (modeBadgeEl) {
        modeBadgeEl.textContent = mode;
      }
      const scriptText = String(eventCfg.script ?? eventCfg.scriptUrl ?? "").trim();
      if (scriptEl) {
        scriptEl.value = scriptText;
      }
      runLightweightParse(scriptText, mode);
    } finally {
      syncing = false;
    }
  }

  function writeEventConfigToObjJson(objJson, eventName, nextCfg) {
    if (!eventName) {
      return;
    }
    if (!objJson.events || typeof objJson.events !== "object" || Array.isArray(objJson.events)) {
      objJson.events = {};
    }
    if (!nextCfg || typeof nextCfg !== "object" || !Object.keys(nextCfg).length) {
      delete objJson.events[eventName];
      if (!Object.keys(objJson.events).length) {
        delete objJson.events;
      }
      return;
    }
    objJson.events[eventName] = nextCfg;
  }

  async function applyAndBind() {
    const targetWrap = resolveSelectedEventTarget(host);
    if (!targetWrap || targetWrap.kind !== "plain") {
      host.showMessage?.("请选中可编辑事件的 plain 对象。", "warning");
      return;
    }
    const eventName = eventSelectEl?.value || "";
    if (!eventName) {
      host.showMessage?.("请选择平台事件。", "warning");
      return;
    }
    const objJson = targetWrap.objJson;
    const sceneConfig = host.getSysConfig()?.jsonData?.sceneConfig;
    const prevCfg = readCurrentEventConfig(objJson, eventName);
    const mode = resolveEventScriptMode(sceneConfig, prevCfg);
    const scriptText = String(scriptEl?.value ?? "").trim();

    if (mode === "dsl" && scriptText) {
      try {
        parseEventScript(scriptText);
      } catch (error) {
        host.showMessage?.(String(error.message || error), "error");
        return;
      }
    }

    const nextCfg = { ...prevCfg };
    if (scriptText.startsWith("lib://")) {
      nextCfg.script = scriptText;
      delete nextCfg.scriptUrl;
    } else if (/^https?:\/\//i.test(scriptText)) {
      nextCfg.script = scriptText;
      delete nextCfg.scriptUrl;
    } else if (scriptText) {
      nextCfg.script = scriptText;
      delete nextCfg.scriptUrl;
    } else {
      delete nextCfg.script;
      delete nextCfg.scriptUrl;
    }
    if (mode === "javascript") {
      nextCfg.mode = "javascript";
    } else if (nextCfg.mode === "javascript") {
      delete nextCfg.mode;
    }

    writeEventConfigToObjJson(objJson, eventName, Object.keys(nextCfg).length ? nextCfg : null);
    host.markSceneDirty?.();
    host.getSceneReserialize?.()?.markSceneNeedsReserialize?.();
    host.getRightSidebarCache?.()?.invalidateRightSidebarSceneJsonTextCache?.();

    const handle = host.getSceneRuntime?.()?.eventMechanism;
    if (handle?.rebind) {
      try {
        await handle.rebind();
        host.showMessage?.("事件脚本已写入并重新绑定。", "success");
      } catch (error) {
        host.showMessage?.(String(error.message || error), "error");
      }
    } else {
      host.showMessage?.("事件脚本已写入 JSON（当前画布未绑定事件运行时）。", "info");
    }
    syncFromSelection();
    host.getRunScenePreview?.()?.scheduleHotReload?.();
  }

  function toggleMode() {
    const targetWrap = resolveSelectedEventTarget(host);
    if (!targetWrap || targetWrap.kind !== "plain") {
      return;
    }
    const eventName = eventSelectEl?.value || "";
    if (!eventName) {
      return;
    }
    const objJson = targetWrap.objJson;
    const cfg = readCurrentEventConfig(objJson, eventName);
    const sceneConfig = host.getSysConfig()?.jsonData?.sceneConfig;
    const mode = resolveEventScriptMode(sceneConfig, cfg);
    if (!objJson.events || typeof objJson.events !== "object") {
      objJson.events = {};
    }
    if (!objJson.events[eventName] || typeof objJson.events[eventName] !== "object") {
      objJson.events[eventName] = {};
    }
    if (mode === "javascript") {
      delete objJson.events[eventName].mode;
    } else {
      objJson.events[eventName].mode = "javascript";
    }
    host.markSceneDirty?.();
    syncFromSelection();
  }

  function resetDraft() {
    syncFromSelection();
    host.showMessage?.("已重置为对象 JSON 中的事件脚本。", "info");
  }

  function openLibPicker() {
    const entries = collectEventScriptLibraryEntries(host);
    if (!libDialog || !libListEl) {
      if (!entries.length) {
        host.showMessage?.("资源库中没有 eventScript 条目。", "warning");
        return;
      }
      const first = entries[0];
      if (scriptEl) {
        scriptEl.value = `lib://${first.id}`;
      }
      runLightweightParse(scriptEl?.value, modeBadgeEl?.textContent || "dsl");
      return;
    }
    libListEl.innerHTML = "";
    if (!entries.length) {
      const row = document.createElement("div");
      row.className = "eventEditorLibEmpty";
      row.textContent = "资源库中没有 assetKind: eventScript 条目。";
      libListEl.appendChild(row);
    } else {
      for (const entry of entries) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "eventEditorLibPickBtn";
        btn.textContent = `${entry.name} (lib://${entry.id})`;
        btn.addEventListener("click", () => {
          if (scriptEl) {
            scriptEl.value = `lib://${entry.id}`;
          }
          runLightweightParse(scriptEl?.value, modeBadgeEl?.textContent || "dsl");
          libDialog.close?.();
        });
        libListEl.appendChild(btn);
      }
    }
    libDialog.showModal?.();
  }

  eventSelectEl?.addEventListener("change", () => syncFromSelection());
  scriptEl?.addEventListener("input", () => {
    if (syncing) {
      return;
    }
    runLightweightParse(scriptEl.value, modeBadgeEl?.textContent || "dsl");
  });
  applyBtn?.addEventListener("click", () => {
    void applyAndBind();
  });
  toggleModeBtn?.addEventListener("click", () => toggleMode());
  resetBtn?.addEventListener("click", () => resetDraft());
  pickLibBtn?.addEventListener("click", () => openLibPicker());
  libCancelBtn?.addEventListener("click", () => libDialog?.close?.());

  return {
    syncFromSelection,
    applyAndBind
  };
}

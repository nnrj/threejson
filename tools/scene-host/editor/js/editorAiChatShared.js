/** Logic shared by editorAiGeneratePanel.js and editorAiAdjustPanel.js — the two AI-edit tabs
 * intentionally split apart (see editorAiEditPanel.js's removal) so the user picks generate vs.
 * adjust explicitly instead of an LLM intent-classifier guessing per turn, but both tabs still
 * render and persist into the SAME per-scene conversation (editorAiChatStore.js is already keyed
 * by scene, not by tab) and share identical provider/credential resolution. This module holds
 * exactly that overlap; anything that differs between the two tabs (the actual generate/adjust AI
 * call, tab-specific composer controls) stays in each panel's own file. */
import { BUILTIN_PROVIDER_TYPE, ensureEditorBuiltinApiKey } from "./editorBuiltinAiProvider.js";
import { appendAiChatTurn, getAiChatHistory, resolveSceneKeyFromLabel } from "./editorAiChatStore.js";
import { parseSceneJsonString } from "threejson";
import { t } from "../../shared/i18n/index.js";

export function isAiAbortError(err) {
  const name = err?.name || "";
  return name === "AbortError" || /aborted/i.test(String(err?.message || err));
}

export function formatAssemblyParentWarnings(batchOrResult) {
  const warnings = batchOrResult?.assemblyWarnings || batchOrResult?.batch?.assemblyWarnings || [];
  return Array.isArray(warnings) ? warnings.filter(Boolean).join(" ") : "";
}

export function friendlyAiEditError(error) {
  if (error?.code === "BUILTIN_QUOTA_EXCEEDED") {
    return t(
      "editor.ai.error.builtinQuotaExceeded",
      "内置供应商的限额体验已用完。可在「设置 → AI 助手」切换为自己的供应商。"
    );
  }
  if (error?.code === "INVALID_API_KEY_HEADER_VALUE") {
    return t(
      "editor.ai.error.invalidApiKeyHeader",
      "API Key 中包含无法用于请求头的字符，请确认只粘贴了供应商提供的 API Key。"
    );
  }
  return error?.message || String(error || t("editor.ai.error.unknown", "未知错误"));
}

/** Renders into whichever `messagesEl` the caller passes in — each tab has its own message-list
 * DOM element, but both read/write the same store record for the current scene, so switching
 * tabs always shows the full, current conversation regardless of which tab produced which turn.
 * Deliberately does NOT memoize "already rendered this scene" (the pre-split single-tab version
 * did) — with two independent panels sharing one store, that memo would skip a re-render after
 * the *other* tab appends a turn. Re-fetching from IndexedDB on every show is cheap enough. */
export function createAiChatHistoryController({ host, messagesEl }) {
  function scrollToBottom() {
    if (messagesEl) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  function appendMessage(role, text) {
    if (!messagesEl) {
      return null;
    }
    const row = document.createElement("div");
    row.className = `aiEditMsg aiEditMsg${role === "user" ? "User" : "Assistant"}`;
    const body = document.createElement("div");
    body.className = "aiEditMsgBody";
    body.textContent = text;
    row.appendChild(body);
    messagesEl.appendChild(row);
    scrollToBottom();
    return body;
  }

  function updateMessage(bodyEl, text) {
    if (bodyEl) {
      bodyEl.textContent = text;
      scrollToBottom();
    }
  }

  async function renderHistoryForCurrentScene() {
    const sceneKey = resolveSceneKeyFromLabel(host.getCurrentSceneLabel?.());
    if (messagesEl) {
      messagesEl.innerHTML = "";
    }
    try {
      const turns = await getAiChatHistory(sceneKey);
      for (const turn of turns) {
        appendMessage(turn.role, turn.text);
      }
    } catch (error) {
      console.warn("[editor] failed to load AI chat history:", error);
    }
  }

  async function persistTurn(role, text) {
    const sceneKey = resolveSceneKeyFromLabel(host.getCurrentSceneLabel?.());
    try {
      await appendAiChatTurn(sceneKey, { role, text });
    } catch (error) {
      console.warn("[editor] failed to persist AI chat turn:", error);
    }
  }

  async function recentTurnSummaries() {
    const sceneKey = resolveSceneKeyFromLabel(host.getCurrentSceneLabel?.());
    try {
      const turns = await getAiChatHistory(sceneKey);
      return turns
        .filter((turn) => turn.role === "user")
        .slice(-10)
        .map((turn) => ({ turnId: turn.id, summary: turn.text.slice(0, 200) }));
    } catch {
      return [];
    }
  }

  return { appendMessage, updateMessage, scrollToBottom, renderHistoryForCurrentScene, persistTurn, recentTurnSummaries };
}

/** Finds the ai.providers[] entry the quick-select currently points at, falling back to
 * ai.defaultProviderId and then the first configured provider. Both AI-edit tabs read/write the
 * SAME ai.defaultProviderId — there's one "current provider" for the editor, not one per tab. */
export function getSelectedProvider(host) {
  const ai = host.getEditorSettings()?.ai || {};
  const providers = Array.isArray(ai.providers) ? ai.providers : [];
  if (!providers.length) {
    return null;
  }
  return providers.find((p) => p.id === ai.defaultProviderId) || providers[0];
}

export function getCredentials(host) {
  const provider = getSelectedProvider(host);
  if (!provider) {
    return { provider: "", apiKey: "", model: undefined, baseUrl: undefined };
  }
  const creds = {
    provider: provider.provider || "chatgpt",
    apiKey: String(provider.apiKey || "").trim(),
    model: String(provider.model || "").trim() || undefined,
    baseUrl: undefined
  };
  if (provider.provider === "custom") {
    creds.baseUrl = String(provider.baseUrl || "").trim() || undefined;
  } else if (provider.provider === BUILTIN_PROVIDER_TYPE) {
    creds.baseUrl = String(host.getEditorSettings()?.ai?.builtinBackendUrl || "").trim() || undefined;
  }
  return creds;
}

export function getAgentOptions(host) {
  const ai = host.getEditorSettings()?.ai || {};
  return {
    enabled: ai.agentEnabled === true,
    depth: ai.agentDepth || "medium",
    iterativeApply: ai.agentIterativeApply !== false,
    progressiveGenerate: true,
    fitViewEachRound: ai.agentFitViewEachRound === true
  };
}

export async function ensureUsableCredentials(host) {
  let creds = getCredentials(host);
  if (!creds.apiKey && creds.provider === BUILTIN_PROVIDER_TYPE) {
    await ensureEditorBuiltinApiKey({
      getEditorSettings: () => host.getEditorSettings(),
      persistSettings: () => host.persistSettingsRememberingAiKey?.(),
      onIssued: () => {}
    });
    creds = getCredentials(host);
  }
  return creds;
}

/** Populates a provider quick-select + wires its change handler and the adjacent settings-jump
 * gear button once. Call again on every tab show to refresh options/selection (cheap). */
export function createProviderSelectSync({ host, selectEl, settingsBtnEl }) {
  let wired = false;
  return function syncProviderSelect() {
    if (!selectEl) {
      return;
    }
    const ai = host.getEditorSettings()?.ai || {};
    const providers = Array.isArray(ai.providers) ? ai.providers : [];
    selectEl.innerHTML = "";
    if (!providers.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = t("editor.ai.edit.noProvider", "（未配置供应商）");
      selectEl.appendChild(opt);
      selectEl.disabled = true;
    } else {
      selectEl.disabled = false;
      for (const provider of providers) {
        const opt = document.createElement("option");
        opt.value = provider.id;
        opt.textContent = provider.label || provider.id;
        selectEl.appendChild(opt);
      }
      const selected = getSelectedProvider(host);
      selectEl.value = selected?.id || providers[0].id;
    }
    if (!wired) {
      wired = true;
      selectEl.addEventListener("change", () => {
        const ai2 = host.getEditorSettings()?.ai;
        if (ai2) {
          ai2.defaultProviderId = selectEl.value;
          host.persistSettings?.();
        }
      });
      settingsBtnEl?.addEventListener("click", () => {
        host.openEditorSettings?.("ai");
      });
    }
  };
}

/** If the built-in provider is currently selected but has no usable key yet, attempts one
 * (deduped) ensure and — on failure — shows the same info-toast ThreeBox shows for an
 * unreachable built-in backend. Call on tab show. */
export async function checkBuiltinProviderAvailability(host, onRefreshed) {
  const provider = getSelectedProvider(host);
  if (provider?.provider !== BUILTIN_PROVIDER_TYPE || provider.apiKey) {
    return;
  }
  await ensureEditorBuiltinApiKey({
    getEditorSettings: () => host.getEditorSettings(),
    persistSettings: () => host.persistSettingsRememberingAiKey?.(),
    onUnavailable: () =>
      host.showMessage(
        t("editor.ai.builtin.unavailableToast", "内置供应商无法访问，请在「设置 → AI 助手」配置供应商。"),
        "info"
      )
  });
  onRefreshed?.();
}

/** Replaces a plain red-toast "no provider configured" error with a confirm dialog offering to
 * jump straight to Settings → AI 助手. */
export async function promptNoProviderConfigured(host) {
  const goToSettings = await host.confirmYesNo(
    t("editor.ai.error.noProviderConfiguredConfirm", "尚未配置可用的 AI 供应商。是否前往「设置 → AI 助手」添加供应商？"),
    { title: t("editor.ai.error.noProviderConfiguredTitle", "未配置供应商") }
  );
  if (goToSettings) {
    host.openEditorSettings?.("ai");
  }
}

export async function applyScenePayload(host, jsonString, hintLabel, options = {}) {
  if (!options.skipDirtyConfirm) {
    const ok = await host.confirmOverwriteIfDirty?.({ actionLabel: `载入「${hintLabel}」` });
    if (!ok) {
      return false;
    }
  }
  const obj = parseSceneJsonString(String(jsonString || "").trim());
  return host.ingestScenePayload(obj, hintLabel, {
    keepDirtyAfterLoad: options.keepDirtyAfterLoad === true
  });
}

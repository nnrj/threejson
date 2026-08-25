import { buildStructuredTurnEnvelope, parseSceneJsonString } from "threejson/ai";
import { sceneToStandardJsonSimple } from "threejson";
import {
  batchResultsHaveSceneMutation,
  batchResultsHaveSuccessfulAdjustment,
  formatObjectGetFeedbackFromBatch
} from "../../../../core/ai/sceneCommandSkill.js";
import { resolveAiAdjustContextPayload, runAiAdjustTurn } from "../../shared/js/aiTurnOrchestrator.js";
import {
  applyScenePayload,
  checkBuiltinProviderAvailability,
  createAiChatHistoryController,
  createEditorAiTurnContext,
  createProviderSelectSync,
  ensureUsableCredentials,
  formatAssemblyParentWarnings,
  friendlyAiEditError,
  getAgentOptions,
  isAiAbortError,
  promptNoProviderConfigured,
  waitForAiActivityPaint
} from "./editorAiChatShared.js";
import { t } from "../../shared/i18n/index.js";
import { formatAgentProgressLabel } from "../../shared/js/aiAgentProgressLabels.js";
import { runEditorSceneTexturePipeline } from "./editorTexturePipeline.js";

/** "AI 调整" tab: always adjusts the currently loaded scene in place — never generates a fresh
 * one. Split out from the old merged "AI 编辑" tab (editorAiEditPanel.js, now removed) specifically
 * so the user's choice of tab *is* the intent, instead of an LLM classifying it per turn from
 * wording alone. Shares its conversation history with editorAiGeneratePanel.js (same per-scene
 * record in editorAiChatStore.js) so switching tabs shows one continuous transcript. */
export function createEditorAiAdjustPanel(host) {
  const dom = {
    messages: document.getElementById("aiAdjustMessages"),
    attachedRow: document.getElementById("aiAdjustAttachedRow"),
    promptInput: document.getElementById("aiAdjustPromptInput"),
    sendBtn: document.getElementById("aiAdjustSendBtn"),
    stopBtn: document.getElementById("aiAdjustStopBtn"),
    attachBtn: document.getElementById("aiAdjustAttachBtn"),
    attachMenu: document.getElementById("aiAdjustAttachMenu"),
    fileInput: document.getElementById("aiAdjustFileInput"),
    libraryPicker: document.getElementById("aiAdjustLibraryPicker"),
    outputModeSelect: document.getElementById("aiAdjustOutputModeSelect"),
    includeFullJsonCheckbox: document.getElementById("aiAdjustIncludeFullJsonCheckbox"),
    includeSpatialSummaryCheckbox: document.getElementById("aiAdjustIncludeSpatialSummaryCheckbox"),
    providerSelect: document.getElementById("aiAdjustProviderSelect"),
    providerSettingsBtn: document.getElementById("aiAdjustProviderSettingsBtn")
  };

  const historyCtl = createAiChatHistoryController({ host, messagesEl: dom.messages });
  const syncProviderSelect = createProviderSelectSync({
    host,
    selectEl: dom.providerSelect,
    settingsBtnEl: dom.providerSettingsBtn
  });

  let busy = false;
  let abortController = null;
  let pendingAttachment = null; // { name, url? } — text-only reference, no vision/parsing (see clarification)

  function setBusy(next) {
    busy = next;
    if (dom.sendBtn) {
      dom.sendBtn.disabled = busy;
      dom.sendBtn.textContent = busy ? t("editor.ai.edit.sending", "生成中...") : t("editor.ai.edit.send", "发送");
    }
    dom.stopBtn?.toggleAttribute("hidden", !busy);
  }

  function renderAttachedChip() {
    if (!dom.attachedRow) {
      return;
    }
    dom.attachedRow.innerHTML = "";
    if (!pendingAttachment) {
      dom.attachedRow.hidden = true;
      return;
    }
    dom.attachedRow.hidden = false;
    const chip = document.createElement("span");
    chip.className = "aiEditAttachedChip";
    chip.textContent = `📎 ${pendingAttachment.name}`;
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", () => {
      pendingAttachment = null;
      if (dom.fileInput) dom.fileInput.value = "";
      renderAttachedChip();
    });
    chip.appendChild(removeBtn);
    dom.attachedRow.appendChild(chip);
  }

  function setAttachment(name, url) {
    pendingAttachment = { name, url };
    renderAttachedChip();
  }

  async function onFileSelected() {
    const file = dom.fileInput?.files?.[0];
    if (!file) {
      return;
    }
    setAttachment(file.name);
    if (dom.fileInput) dom.fileInput.value = "";
  }

  function isImageLibraryEntry(entry) {
    const kind = String(entry?.assetKind ?? "texture").trim().toLowerCase();
    return kind === "image" || kind === "texture";
  }

  function renderLibraryPickerEntries() {
    if (!dom.libraryPicker) {
      return;
    }
    const entries = (host.getAssetLibraryPanel?.()?.listEntries?.() || []).filter(isImageLibraryEntry);
    dom.libraryPicker.innerHTML = "";
    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "aiEditAttachMenuEmpty";
      empty.textContent = t("editor.ai.edit.libraryEmpty", "资源库暂无可用资源，请先上传。");
      dom.libraryPicker.appendChild(empty);
      return;
    }
    entries.forEach((entry) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = entry.name || entry.threeJsonId || "(未命名)";
      btn.addEventListener("click", () => {
        const url = String(entry.url ?? entry.textureUrl ?? entry.src ?? "");
        setAttachment(entry.name || entry.threeJsonId, url || undefined);
        toggleLibraryPicker(false);
      });
      dom.libraryPicker.appendChild(btn);
    });
  }

  function toggleLibraryPicker(show) {
    if (!dom.libraryPicker) {
      return;
    }
    const nextHidden = show === false ? true : !dom.libraryPicker.hidden ? true : false;
    dom.libraryPicker.hidden = nextHidden;
    if (!nextHidden) {
      renderLibraryPickerEntries();
    }
  }

  function toggleAttachMenu(show) {
    if (!dom.attachMenu) {
      return;
    }
    const nextHidden = show === false ? true : !dom.attachMenu.hidden ? true : false;
    dom.attachMenu.hidden = nextHidden;
    dom.attachBtn?.setAttribute("aria-expanded", nextHidden ? "false" : "true");
    if (nextHidden) {
      toggleLibraryPicker(false);
    }
  }

  function wireAttachMenuActions() {
    dom.attachMenu?.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        const action = btn.dataset.action;
        toggleAttachMenu(false);
        if (action === "file") {
          dom.fileInput?.click();
        } else if (action === "library") {
          toggleLibraryPicker();
        }
      });
    });
  }

  /** No vision/parsing for adjust attachments (see the AI调整 "+"按钮 clarification) — an
   * attached file/resource just becomes a short text reference appended to the prompt actually
   * sent to the model, not a real content transfer. */
  function buildPromptWithAttachmentNote(prompt, attachment) {
    if (!attachment) {
      return prompt;
    }
    const note = attachment.url ? `参考资源：${attachment.name}，${attachment.url}` : `参考资源：${attachment.name}`;
    return `${prompt}\n\n（${note}）`;
  }

  /** Reads/writes the update-output-mode select + the two附带 checkboxes directly against
   * host.getEditorSettings().ai — the same settings object Settings→AI助手 edits, so this tab's
   * quick controls and the Settings modal stay in sync (whichever was touched last wins on
   * reopen). */
  let quickOptionsWired = false;
  function syncQuickOptionsFromSettings() {
    const ai = host.getEditorSettings()?.ai || {};
    if (dom.outputModeSelect) {
      dom.outputModeSelect.value = ai.updateOutputMode || "auto";
    }
    if (dom.includeFullJsonCheckbox) {
      dom.includeFullJsonCheckbox.checked = ai.includeFullJson === true;
    }
    if (dom.includeSpatialSummaryCheckbox) {
      dom.includeSpatialSummaryCheckbox.checked = ai.includeSpatialSummary === true;
    }
    if (!quickOptionsWired) {
      quickOptionsWired = true;
      dom.outputModeSelect?.addEventListener("change", () => {
        const ai2 = host.getEditorSettings()?.ai;
        if (ai2) {
          ai2.updateOutputMode = dom.outputModeSelect.value;
          host.persistSettings?.();
        }
      });
      dom.includeFullJsonCheckbox?.addEventListener("change", () => {
        const ai2 = host.getEditorSettings()?.ai;
        if (ai2) {
          ai2.includeFullJson = dom.includeFullJsonCheckbox.checked;
          host.persistSettings?.();
        }
      });
      dom.includeSpatialSummaryCheckbox?.addEventListener("change", () => {
        const ai2 = host.getEditorSettings()?.ai;
        if (ai2) {
          ai2.includeSpatialSummary = dom.includeSpatialSummaryCheckbox.checked;
          host.persistSettings?.();
        }
      });
    }
  }

  /** Adjustment is always iterative now (no more "agent enabled" gate — see
   * core/ai/sceneAgent.js's module docblock), so a turn can genuinely take several rounds instead
   * of one quick cascade. Without progress feedback the status message would just sit frozen on
   * "正在连接 AI 并分析调整方案…" for the whole thing. Writes textContent directly (not through
   * historyCtl.updateMessage) so the "still busy" activity styling stays in effect until the turn
   * actually finishes — same approach as editorAiGeneratePanel.js's createGenerateStatusUpdater. */
  function createAdjustStatusUpdater(assistantBody) {
    return (progress) => {
      if (!progress || !assistantBody) {
        return;
      }
      const label = formatAgentProgressLabel(progress, t);
      if (!label) {
        return;
      }
      assistantBody.textContent = label;
      historyCtl.scrollToBottom();
    };
  }

  async function getSceneJsonText() {
    await host.ensureCanvasSyncedBeforeExport?.();
    const scene = host.getScene();
    if (!scene?.isScene) {
      return "{}";
    }
    const payload = sceneToStandardJsonSimple(scene, {
      ...host.buildSceneToJsonOptions?.({ merge: false, format: "standard" }),
      merge: false,
      format: "standard"
    });
    return JSON.stringify(payload, null, 2);
  }

  function notifyCommandBatchOutcome(batch, successMessage) {
    const results = batch?.results;
    const adjusted =
      batch?.sceneMutated === true ||
      batchResultsHaveSuccessfulAdjustment(results) ||
      (batch?.ok === true && Array.isArray(results) && results.length === 0);
    if (!adjusted) {
      host.showMessage(t("editor.ai.message.queryOnly", "AI 仅执行查询命令，场景未修改。"), "error");
      return t("editor.ai.message.queryOnly", "AI 仅执行查询命令，场景未修改。");
    }
    const assemblyWarning = formatAssemblyParentWarnings(batch);
    const viewOnly = !batchResultsHaveSceneMutation(results) && batchResultsHaveSuccessfulAdjustment(results);
    const noContentChange = batch?.ok === true && Array.isArray(results) && results.length === 0;
    if (viewOnly) {
      const msg = t("editor.ai.message.cameraAdjusted", "AI 已调整相机/视角。");
      host.showMessage(msg, "success");
      return msg;
    }
    if (noContentChange) {
      const msg = t("editor.ai.message.noChangeRequested", "已按您的要求，未修改场景内容。");
      host.showMessage(msg, "success");
      return msg;
    }
    host.markSceneDirty?.();
    const agent = getAgentOptions(host);
    if (agent.fitViewEachRound && batch?.sceneMutated) {
      host.getCommandLayer().getApi()?.fitView?.("scene");
    }
    const baseMsg = successMessage || t("editor.ai.message.sceneUpdated", "AI 已更新场景。");
    const msg = assemblyWarning ? `${baseMsg} ${assemblyWarning}` : baseMsg;
    host.showMessage(msg, assemblyWarning ? "warning" : "success");
    return msg;
  }

  /** Applies an adjust-turn result directly onto the live scene via
   * `host.getCommandLayer().runBatch` — this is what keeps AI edits flowing through the same
   * mutation APIs `editorHistory.js` already tracks, so Ctrl+Z / Ctrl+Y undo/redo works with no
   * extra wiring. Falls back to a full scene replace for the json-full/json-incremental stages,
   * which have no "commands" to replay. */
  async function applyAdjustResult(result, successMessage) {
    if (result.liveApplied === true) {
      return notifyCommandBatchOutcome(
        {
          ok: true,
          results: result.liveBatchResults || [],
          sceneMutated: result.liveSceneMutated === true
        },
        successMessage
      );
    }
    if (result.stage === "commands" && Array.isArray(result.commands) && result.commands.length) {
      host.getCommandLayer().ensure();
      const batch = await host.getCommandLayer().runBatch(result.commands, { label: "AI 调整" });
      if (!batch.ok) {
        const err = batch.results?.find((item) => !item.ok)?.error || "命令执行失败";
        host.showMessage(String(err), "error");
        return `失败：${err}`;
      }
      return notifyCommandBatchOutcome(batch, successMessage);
    }
    const loaded = await applyScenePayload(host, result.sceneJsonString, "AI 调整", { skipDirtyConfirm: true });
    if (!loaded) {
      return t("editor.ai.message.cancelled", "已取消载入。");
    }
    host.markSceneDirty?.();
    host.showMessage(successMessage, "success");
    return successMessage;
  }

  async function handleSend() {
    if (busy) {
      return;
    }
    const prompt = dom.promptInput?.value?.trim() || "";
    if (!prompt) {
      return;
    }
    if (!host.getScene()) {
      host.showMessage(
        t("editor.ai.adjust.noScene", "当前没有可调整的场景，请先在「AI 生成」中生成或导入一个场景。"),
        "error"
      );
      return;
    }
    const attachment = pendingAttachment;
    const effectivePrompt = buildPromptWithAttachmentNote(prompt, attachment);
    const userBody = historyCtl.appendMessage("user", prompt);
    const assistantBody = historyCtl.appendActivityMessage(
      t("editor.ai.edit.preparingAdjust", "正在连接 AI 并分析调整方案…")
    );
    setBusy(true);
    abortController = new AbortController();
    let requestStarted = false;
    await waitForAiActivityPaint();

    try {
      abortController.signal.throwIfAborted?.();
      const creds = await ensureUsableCredentials(host);
      if (!creds.apiKey) {
        historyCtl.removeMessage(userBody);
        historyCtl.removeMessage(assistantBody);
        void promptNoProviderConfigured(host);
        return;
      }
      abortController.signal.throwIfAborted?.();
      requestStarted = true;
      if (dom.promptInput) {
        dom.promptInput.value = "";
      }
      if (attachment) {
        pendingAttachment = null;
        if (dom.fileInput) dom.fileInput.value = "";
        renderAttachedChip();
      }
      void historyCtl.persistTurn("user", prompt);

      const agentOptions = getAgentOptions(host);
      const configuredSceneMaxTokens = Number(host.getEditorSettings()?.ai?.sceneMaxOutputTokens);
      const sceneTokenOptions = Number.isFinite(configuredSceneMaxTokens) && configuredSceneMaxTokens > 0
        ? { maxTokens: Math.round(configuredSceneMaxTokens) }
        : {};
      const providerOptions = {
        provider: creds.provider,
        apiKey: creds.apiKey,
        model: creds.model,
        baseUrl: creds.baseUrl,
        providerAdapter: creds.providerAdapter,
        userId: creds.userId,
        requestContext: createEditorAiTurnContext(prompt)
      };
      const targetSceneJsonString = await getSceneJsonText();
      const targetSceneJson = parseSceneJsonString(targetSceneJsonString);
      const contextPayload = resolveAiAdjustContextPayload(targetSceneJson, host.getEditorSettings()?.ai || {});
      const envelope = buildStructuredTurnEnvelope({
        userPrompt: effectivePrompt,
        intent: "adjust",
        contextPayload,
        includeReferenceLinks: true
      });
      const updateOutputMode = host.getEditorSettings()?.ai?.updateOutputMode || "auto";
      const liveBatchResults = [];
      let liveSceneMutated = false;
      const result = await runAiAdjustTurn({
        userPrompt: effectivePrompt,
        envelope,
        targetSceneJsonString,
        providerOptions,
        ...sceneTokenOptions,
        agentOptions,
        updateOutputMode,
        strictOutputMode: updateOutputMode !== "auto",
        resolveContextPayload: (sceneJson) => resolveAiAdjustContextPayload(sceneJson, host.getEditorSettings()?.ai || {}),
        onAgentProgress: createAdjustStatusUpdater(assistantBody),
        applyCommands: async (commands, meta = {}) => {
          abortController.signal.throwIfAborted?.();
          host.getCommandLayer().ensure();
          const batch = await host.getCommandLayer().runBatch(commands, {
            label: meta.label || `AI 自动调整第 ${meta.round || 1} 轮`
          });
          const results = Array.isArray(batch?.results) ? batch.results : [];
          liveBatchResults.push(...results);
          const sceneMutated = batch?.sceneMutated === true || batchResultsHaveSceneMutation(results);
          liveSceneMutated = liveSceneMutated || sceneMutated;
          return {
            ok: batch?.ok !== false,
            sceneMutated,
            objectGetFeedback: formatObjectGetFeedbackFromBatch(results),
            error: results.find((item) => item?.ok === false)?.error
          };
        },
        refreshContext: async () => {
          const currentSceneJsonString = await getSceneJsonText();
          const currentSceneJson = parseSceneJsonString(currentSceneJsonString);
          return {
            ...resolveAiAdjustContextPayload(currentSceneJson, host.getEditorSettings()?.ai || {}),
            currentSceneJsonString
          };
        },
        capabilityLookup: true,
        signal: abortController.signal
      });
      if (result.liveApplied === true) {
        result.liveBatchResults = liveBatchResults;
        result.liveSceneMutated = liveSceneMutated;
      }
      let resultText = await applyAdjustResult(result, t("editor.ai.edit.adjustDone", "AI 已更新场景。"));
      if (result.agentResult?.completed === false) {
        resultText = t(
          "editor.ai.message.refineBudgetExhausted",
          "场景调整已应用，但自动细化达到轮数上限，AI 未明确确认已经完善完成。"
        );
        host.showMessage(resultText, "warning");
      }

      await runEditorSceneTexturePipeline(host, {
        prompt: effectivePrompt,
        providerOptions,
        previousScene: targetSceneJson,
        signal: abortController.signal,
        onProgress: (text) => {
          assistantBody.textContent = text;
          historyCtl.scrollToBottom();
        }
      });

      historyCtl.updateMessage(assistantBody, resultText);
      void historyCtl.persistTurn("assistant", resultText);
    } catch (error) {
      if (!requestStarted) {
        historyCtl.removeMessage(userBody);
        historyCtl.removeMessage(assistantBody);
        if (!isAiAbortError(error)) {
          host.showMessage(friendlyAiEditError(error), "error");
        }
        return;
      }
      if (isAiAbortError(error)) {
        historyCtl.updateMessage(assistantBody, t("editor.ai.message.aborted", "已停止生成。"));
        void historyCtl.persistTurn("assistant", t("editor.ai.message.aborted", "已停止生成。"));
      } else {
        console.error("[editor] AI adjust turn failed:", error);
        const feedback = historyCtl.updateErrorMessage(assistantBody, error);
        const msg = feedback?.message || friendlyAiEditError(error);
        host.showMessage(msg, "error");
        void historyCtl.persistTurn("assistant", msg);
      }
    } finally {
      setBusy(false);
      abortController = null;
    }
  }

  function init() {
    dom.sendBtn?.addEventListener("click", () => void handleSend());
    dom.promptInput?.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        void handleSend();
      }
    });
    dom.stopBtn?.addEventListener("click", () => {
      abortController?.abort();
    });
    dom.attachBtn?.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleAttachMenu();
    });
    document.addEventListener("click", (event) => {
      if (dom.attachMenu && !dom.attachMenu.hidden && !dom.attachMenu.contains(event.target) && event.target !== dom.attachBtn) {
        toggleAttachMenu(false);
      }
    });
    wireAttachMenuActions();
    dom.fileInput?.addEventListener("change", () => void onFileSelected());
    syncQuickOptionsFromSettings();
    syncProviderSelect();
  }

  function onShown() {
    void historyCtl.renderHistoryForCurrentScene();
    syncQuickOptionsFromSettings();
    syncProviderSelect();
    void checkBuiltinProviderAvailability(host, syncProviderSelect);
    dom.promptInput?.focus({ preventScroll: true });
  }

  function onSettingsSaved() {
    syncQuickOptionsFromSettings();
    syncProviderSelect();
  }

  return {
    init,
    onShown,
    onSettingsSaved,
    isBusy: () => busy
  };
}

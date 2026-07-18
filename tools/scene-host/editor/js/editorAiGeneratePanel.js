import { runAiGenerateTurn, runAiImageGenerateTurn } from "../../shared/js/aiTurnOrchestrator.js";
import { parseUploadedSceneJsonFile, parseUploadedTjzFile } from "../../shared/js/sceneFileUpload.js";
import {
  applyScenePayload,
  checkBuiltinProviderAvailability,
  createAiChatHistoryController,
  createProviderSelectSync,
  ensureUsableCredentials,
  friendlyAiEditError,
  getAgentOptions,
  isAiAbortError,
  promptNoProviderConfigured
} from "./editorAiChatShared.js";
import { t } from "../../shared/i18n/index.js";

const ATTACHMENT_ICON = { image: "🖼", json: "📄", tjz: "📦" };

/** "AI 生成" tab: always generates a fresh scene from the prompt — never adjusts the current
 * scene. Split out from the old merged "AI 编辑" tab (editorAiEditPanel.js, now removed)
 * specifically so the user's choice of tab *is* the intent, instead of an LLM classifying it per
 * turn from wording alone. Shares its conversation history with editorAiAdjustPanel.js (same
 * per-scene record in editorAiChatStore.js) so switching tabs shows one continuous transcript.
 *
 * A single `pendingAttachment` slot (image / json / tjz — mutually exclusive, attaching a new one
 * replaces whatever was there) feeds the send flow: an image attachment routes through
 * runAiImageGenerateTurn (real vision input); a json/tjz attachment is parsed and injected as a
 * text reference into the prompt sent to the plain runAiGenerateTurn (no vision call — see
 * buildPromptWithReference) since the underlying generate call has no "reference scene" concept
 * of its own. */
export function createEditorAiGeneratePanel(host) {
  const dom = {
    messages: document.getElementById("aiGenerateMessages"),
    attachedRow: document.getElementById("aiGenerateAttachedRow"),
    promptInput: document.getElementById("aiGeneratePromptInput"),
    sendBtn: document.getElementById("aiGenerateSendBtn"),
    stopBtn: document.getElementById("aiGenerateStopBtn"),
    attachBtn: document.getElementById("aiGenerateAttachBtn"),
    attachMenu: document.getElementById("aiGenerateAttachMenu"),
    imageFileInput: document.getElementById("aiGenerateImageFileInput"),
    jsonFileInput: document.getElementById("aiGenerateJsonFileInput"),
    tjzFileInput: document.getElementById("aiGenerateTjzFileInput"),
    imageLibraryPicker: document.getElementById("aiGenerateImageLibraryPicker"),
    imageModeCheckbox: document.getElementById("aiGenerateImageModeCheckbox"),
    imageArea: document.getElementById("aiGenerateImageArea"),
    imageBase64Input: document.getElementById("aiGenerateImageBase64Input"),
    providerSelect: document.getElementById("aiGenerateProviderSelect"),
    providerSettingsBtn: document.getElementById("aiGenerateProviderSettingsBtn")
  };

  const historyCtl = createAiChatHistoryController({ host, messagesEl: dom.messages });
  const syncProviderSelect = createProviderSelectSync({
    host,
    selectEl: dom.providerSelect,
    settingsBtnEl: dom.providerSettingsBtn
  });

  let busy = false;
  let abortController = null;
  let pendingAttachment = null; // { kind: 'image'|'json'|'tjz', name, dataUrl?, sceneJson? }

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
    const icon = ATTACHMENT_ICON[pendingAttachment.kind] || "📎";
    const chip = document.createElement("span");
    chip.className = "aiEditAttachedChip";
    chip.textContent = `${icon} ${pendingAttachment.name || t("editor.ai.edit.attachedImage", "附件")}`;
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", () => clearAttachment());
    chip.appendChild(removeBtn);
    dom.attachedRow.appendChild(chip);
  }

  function syncImageAreaVisibility() {
    const on = dom.imageModeCheckbox?.checked === true;
    if (dom.imageArea) {
      dom.imageArea.hidden = !on;
    }
  }

  function clearAttachment() {
    pendingAttachment = null;
    if (dom.imageModeCheckbox) {
      dom.imageModeCheckbox.checked = false;
    }
    if (dom.imageFileInput) dom.imageFileInput.value = "";
    if (dom.jsonFileInput) dom.jsonFileInput.value = "";
    if (dom.tjzFileInput) dom.tjzFileInput.value = "";
    renderAttachedChip();
    syncImageAreaVisibility();
  }

  function setAttachment(kind, name, extra) {
    pendingAttachment = { kind, name, ...extra };
    if (dom.imageModeCheckbox) {
      dom.imageModeCheckbox.checked = kind === "image";
    }
    renderAttachedChip();
    syncImageAreaVisibility();
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("读取文件失败。"));
      reader.readAsDataURL(file);
    });
  }

  async function onImageFileSelected() {
    const file = dom.imageFileInput?.files?.[0];
    if (!file) {
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setAttachment("image", file.name, { dataUrl });
      void host.getAssetLibraryPanel?.()?.addEntryFromFile?.(file);
    } catch (error) {
      host.showMessage(String(error?.message || error), "error");
    } finally {
      if (dom.imageFileInput) dom.imageFileInput.value = "";
    }
  }

  function estimateJsonSizeKb(sceneJson) {
    return Math.max(1, Math.round(JSON.stringify(sceneJson).length / 1024));
  }

  async function onJsonFileSelected() {
    const file = dom.jsonFileInput?.files?.[0];
    if (!file) {
      return;
    }
    try {
      const sceneJson = await parseUploadedSceneJsonFile(file);
      const kb = estimateJsonSizeKb(sceneJson);
      setAttachment("json", file.name, { sceneJson });
      host.showMessage(
        t(
          "editor.ai.generate.referenceAttachedWarning",
          "已附加参考场景「{name}」（约 {kb} KB），完整场景 JSON 会随本次请求发送，可能显著增加 Token 消耗。"
        )
          .replace("{name}", file.name)
          .replace("{kb}", String(kb)),
        "warning"
      );
    } catch (error) {
      host.showMessage(String(error?.message || error), "error");
    } finally {
      if (dom.jsonFileInput) dom.jsonFileInput.value = "";
    }
  }

  async function onTjzFileSelected() {
    const file = dom.tjzFileInput?.files?.[0];
    if (!file) {
      return;
    }
    try {
      const sceneJson = await parseUploadedTjzFile(file);
      const kb = estimateJsonSizeKb(sceneJson);
      setAttachment("tjz", file.name, { sceneJson });
      host.showMessage(
        t(
          "editor.ai.generate.referenceAttachedWarning",
          "已附加参考场景「{name}」（约 {kb} KB），完整场景 JSON 会随本次请求发送，可能显著增加 Token 消耗。"
        )
          .replace("{name}", file.name)
          .replace("{kb}", String(kb)),
        "warning"
      );
    } catch (error) {
      host.showMessage(String(error?.message || error), "error");
    } finally {
      if (dom.tjzFileInput) dom.tjzFileInput.value = "";
    }
  }

  function isImageLibraryEntry(entry) {
    const kind = String(entry?.assetKind ?? "texture").trim().toLowerCase();
    return kind === "image" || kind === "texture";
  }

  function renderLibraryPickerEntries() {
    if (!dom.imageLibraryPicker) {
      return;
    }
    const entries = (host.getAssetLibraryPanel?.()?.listEntries?.() || []).filter(isImageLibraryEntry);
    dom.imageLibraryPicker.innerHTML = "";
    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "aiEditAttachMenuEmpty";
      empty.textContent = t("editor.ai.edit.libraryEmpty", "资源库暂无可用图片，请先上传。");
      dom.imageLibraryPicker.appendChild(empty);
      return;
    }
    entries.forEach((entry) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = entry.name || entry.threeJsonId || "(未命名)";
      btn.addEventListener("click", () => {
        const url = String(entry.url ?? entry.textureUrl ?? entry.src ?? "");
        if (!url) {
          host.showMessage(t("editor.ai.edit.libraryEntryNoUrl", "该资源没有可用的 url。"), "error");
          return;
        }
        setAttachment("image", entry.name || entry.threeJsonId, { dataUrl: url });
        toggleLibraryPicker(false);
      });
      dom.imageLibraryPicker.appendChild(btn);
    });
  }

  function toggleLibraryPicker(show) {
    if (!dom.imageLibraryPicker) {
      return;
    }
    const nextHidden = show === false ? true : !dom.imageLibraryPicker.hidden ? true : false;
    dom.imageLibraryPicker.hidden = nextHidden;
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
        if (action === "image") {
          dom.imageFileInput?.click();
        } else if (action === "json") {
          dom.jsonFileInput?.click();
        } else if (action === "tjz") {
          dom.tjzFileInput?.click();
        } else if (action === "library") {
          toggleLibraryPicker();
        }
      });
    });
  }

  /** Base64/data-URL paste support: accepts either a full `data:image/...;base64,...` string or a
   * bare base64 blob (assumed PNG). Deliberately conservative about what counts as "valid" (only
   * base64 alphabet, minimum length) — false negatives just leave the textarea untouched rather
   * than risk sending garbage as an image payload. */
  function normalizeBase64Input(raw) {
    const trimmed = String(raw || "").trim();
    if (!trimmed) {
      return null;
    }
    if (/^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(trimmed)) {
      return trimmed;
    }
    const cleaned = trimmed.replace(/\s+/g, "");
    if (cleaned.length < 32 || !/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) {
      return null;
    }
    return `data:image/png;base64,${cleaned}`;
  }

  function estimateBase64SizeKb(dataUrl) {
    const commaIdx = dataUrl.indexOf(",");
    const b64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
    const bytes = Math.floor((b64.length * 3) / 4);
    return Math.max(1, Math.round(bytes / 1024));
  }

  function handleBase64Paste() {
    const raw = dom.imageBase64Input?.value || "";
    if (!raw.trim()) {
      return;
    }
    const dataUrl = normalizeBase64Input(raw);
    if (dom.imageBase64Input) {
      dom.imageBase64Input.value = "";
    }
    if (!dataUrl) {
      host.showMessage(t("editor.ai.generate.base64Invalid", "无法识别粘贴的 Base64 图片数据。"), "error");
      return;
    }
    const kb = estimateBase64SizeKb(dataUrl);
    setAttachment(
      "image",
      t("editor.ai.generate.pastedImageName", "粘贴的图片（约 {kb} KB）").replace("{kb}", String(kb)),
      { dataUrl }
    );
    host.showMessage(
      t(
        "editor.ai.generate.base64TokenWarning",
        "已使用粘贴的 Base64 图片（约 {kb} KB），这会显著增加请求体积与 Token 消耗。"
      ).replace("{kb}", String(kb)),
      "warning"
    );
  }

  function syncImageModeUi() {
    syncImageAreaVisibility();
    if (!dom.imageModeCheckbox?.checked && pendingAttachment?.kind === "image") {
      clearAttachment();
    }
  }

  /** json/tjz attachments have no vision call to ride along on — instead their parsed scene JSON
   * is folded into the prompt text itself as an explicit, clearly-labeled reference block, so the
   * plain (non-vision) runAiGenerateTurn call sees it as part of userPrompt. */
  function buildPromptWithReference(prompt, attachment) {
    const refJsonText = JSON.stringify(attachment.sceneJson);
    return (
      `参考场景 JSON（来自「${attachment.name}」，仅供风格/结构参考，不会直接使用，请根据下方描述重新生成场景）：\n` +
      `${refJsonText}\n\n用户描述：\n${prompt}`
    );
  }

  async function handleSend() {
    if (busy) {
      return;
    }
    const prompt = dom.promptInput?.value?.trim() || "";
    const attachment = pendingAttachment;
    if (!prompt && !attachment) {
      return;
    }
    const creds = await ensureUsableCredentials(host);
    if (!creds.apiKey) {
      void promptNoProviderConfigured(host);
      return;
    }

    if (dom.promptInput) {
      dom.promptInput.value = "";
    }
    const userText = prompt || t("editor.ai.edit.imageOnlyPrompt", "（看图生成）");
    historyCtl.appendMessage("user", userText);
    void historyCtl.persistTurn("user", userText);

    const assistantBody = historyCtl.appendMessage("assistant", t("editor.ai.edit.working", "AI 正在处理..."));
    setBusy(true);
    abortController = new AbortController();
    if (attachment) {
      clearAttachment();
    }

    try {
      const agentOptions = getAgentOptions(host);
      const providerOptions = { provider: creds.provider, apiKey: creds.apiKey, model: creds.model, baseUrl: creds.baseUrl };
      let resultText;

      if (attachment?.kind === "image") {
        const result = await runAiImageGenerateTurn({
          prompt,
          image: attachment.dataUrl,
          providerOptions,
          agentOptions,
          signal: abortController.signal
        });
        const loaded = await applyScenePayload(host, result.sceneJsonString, "AI 看图生成");
        resultText = loaded
          ? t("editor.ai.edit.imageDone", "看图生成场景已载入。")
          : t("editor.ai.message.cancelled", "已取消载入。");
        if (loaded) {
          host.showMessage(resultText, "success");
        }
      } else {
        const dirty = host.getEditorDocumentState?.()?.isDirty?.();
        if (dirty) {
          const ok = await host.confirmOverwriteIfDirty?.({ actionLabel: "开始 AI 生成" });
          if (!ok) {
            historyCtl.updateMessage(assistantBody, t("editor.ai.message.cancelled", "已取消载入。"));
            return;
          }
        }
        const effectivePrompt =
          attachment?.kind === "json" || attachment?.kind === "tjz"
            ? buildPromptWithReference(prompt, attachment)
            : prompt;
        const result = await runAiGenerateTurn({
          userPrompt: effectivePrompt,
          providerOptions,
          agentOptions,
          onDelta: (delta) =>
            historyCtl.updateMessage(assistantBody, `${t("editor.ai.edit.working", "AI 正在处理...")}\n${delta}`),
          signal: abortController.signal
        });
        const loaded = await applyScenePayload(host, result.sceneJsonString, "AI 生成", { skipDirtyConfirm: true });
        resultText = loaded ? t("editor.ai.edit.generateDone", "AI 场景已载入。") : t("editor.ai.message.cancelled", "已取消载入。");
        if (loaded) {
          host.markSceneDirty?.();
          host.showMessage(resultText, "success");
        }
      }

      historyCtl.updateMessage(assistantBody, resultText);
      void historyCtl.persistTurn("assistant", resultText);
    } catch (error) {
      if (isAiAbortError(error)) {
        historyCtl.updateMessage(assistantBody, t("editor.ai.message.aborted", "已停止生成。"));
        void historyCtl.persistTurn("assistant", t("editor.ai.message.aborted", "已停止生成。"));
      } else {
        console.error("[editor] AI generate turn failed:", error);
        const msg = friendlyAiEditError(error);
        historyCtl.updateMessage(assistantBody, `${t("editor.ai.edit.failed", "失败：")}${msg}`);
        host.showMessage(msg, "error");
        void historyCtl.persistTurn("assistant", `${t("editor.ai.edit.failed", "失败：")}${msg}`);
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
    dom.imageFileInput?.addEventListener("change", () => void onImageFileSelected());
    dom.jsonFileInput?.addEventListener("change", () => void onJsonFileSelected());
    dom.tjzFileInput?.addEventListener("change", () => void onTjzFileSelected());
    dom.imageModeCheckbox?.addEventListener("change", syncImageModeUi);
    dom.imageBase64Input?.addEventListener("paste", () => window.setTimeout(handleBase64Paste, 0));
    dom.imageBase64Input?.addEventListener("change", handleBase64Paste);
    syncImageModeUi();
    syncProviderSelect();
  }

  function onShown() {
    void historyCtl.renderHistoryForCurrentScene();
    syncProviderSelect();
    void checkBuiltinProviderAvailability(host, syncProviderSelect);
    dom.promptInput?.focus({ preventScroll: true });
  }

  return {
    init,
    onShown,
    onSettingsSaved: syncProviderSelect,
    isBusy: () => busy
  };
}

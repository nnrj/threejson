import { createSceneAiClient, sceneToStandardJsonSimple } from "threejson";
import {
  batchResultsHaveSceneMutation,
  batchResultsHaveSuccessfulAdjustment
} from "../../../../core/ai/sceneCommandSkill.js";
import { looksLikeMicroDslLine } from "../../../../core/command/microDsl.js";
import { runEditorAiUpdate } from "../lib/ai/index.js";
import { EDITOR_SETTINGS_DEFAULTS } from "../../shared/js/editorSettingsSchema.js";
import {
  AI_UPDATE_MODE_UI,
  applyAiSettingsToSidebarDom,
  applyScenePayloadFromAiJsonString,
  bindAiPanelSubmitShortcut,
  buildAiAdjustLastResultText,
  buildSidebarTextureOptions,
  createAiSidebarStreamPreview,
  formatAssemblyParentWarnings,
  formatTextureFillWarning,
  isAiAbortError,
  scrollAiStreamPreviewToEnd,
  syncAiSettingsFromSidebarDom
} from "./editorAiSidebarAdvanced.js";

export function createAiSidebar(host) {
  const dom = {
    provider: document.getElementById("aiProviderSelect"),
    customBaseWrap: document.getElementById("aiCustomApiBaseWrap"),
    customBase: document.getElementById("aiCustomApiBaseInput"),
    apiKey: document.getElementById("aiApiKeyInput"),
    model: document.getElementById("aiModelInput"),
    remember: document.getElementById("aiRememberConfigCheckbox"),
    agentEnabled: document.getElementById("aiAgentEnabledCheckbox"),
    agentDepth: document.getElementById("aiAgentDepthSelect"),
    agentIterative: document.getElementById("aiAgentIterativeApplyCheckbox"),
    agentFitViewEachRound: document.getElementById("aiAgentFitViewEachRoundCheckbox"),
    generatePrompt: document.getElementById("aiGeneratePromptInput"),
    generateBtn: document.getElementById("aiGenerateBtn"),
    updatePrompt: document.getElementById("aiUpdatePromptInput"),
    updateBtn: document.getElementById("aiUpdateBtn"),
    updateMode: document.getElementById("aiUpdateOutputModeSelect"),
    updateHintSource: document.getElementById("aiUpdateHintSource"),
    updateHintMode: document.getElementById("aiUpdateHintMode"),
    includeFullJson: document.getElementById("aiIncludeFullJsonCheckbox"),
    includeSpatial: document.getElementById("aiIncludeSpatialSummaryCheckbox"),
    streamPreview: document.getElementById("aiStreamPreviewCheckbox"),
    stageAutoLoad: document.getElementById("aiStageAutoLoadCheckbox"),
    fillTextures: document.getElementById("aiFillTexturesCheckbox"),
    textureBrowserMode: document.getElementById("aiTextureBrowserModeSelect"),
    textureUploadWrap: document.getElementById("aiTextureUploadWrap"),
    textureUploadEndpoint: document.getElementById("aiTextureUploadEndpoint"),
    pickTextureDirBtn: document.getElementById("aiPickTextureDirBtn"),
    textureDirHint: document.getElementById("aiTextureDirHint"),
    imageFile: document.getElementById("aiImageFileInput"),
    imageBase64: document.getElementById("aiImageBase64Input"),
    imageMime: document.getElementById("aiImageMimeSelect"),
    imageUrl: document.getElementById("aiImageUrlInput"),
    imagePrompt: document.getElementById("aiImagePromptInput"),
    imageDetail: document.getElementById("aiImageDetailSelect"),
    imageBtn: document.getElementById("aiGenerateFromImageBtn"),
    message: document.getElementById("aiSceneMessage"),
    messageWrap: document.getElementById("aiSceneMessageWrap"),
    lastAdjustResult: document.getElementById("aiLastAdjustResult"),
    lastAdjustResultLabel: document.getElementById("aiLastAdjustResultLabel"),
    streamGenerate: document.getElementById("aiStreamPreviewGenerate"),
    streamAdjust: document.getElementById("aiStreamPreviewAdjust"),
    streamImage: document.getElementById("aiStreamPreviewImage"),
    stopBtns: () => document.querySelectorAll("[data-ai-stop]"),
    _textureDirectoryHandle: null,
    _textureZipSink: null
  };

  let agentSessionActive = false;
  let abortController = null;
  let activeLeftTab = "aiGenerate";
  let stageLoadChain = Promise.resolve();

  const streamPreview = createAiSidebarStreamPreview(dom, () => activeLeftTab);

  function setMessage(text) {
    if (dom.message) {
      dom.message.textContent = text || "";
    }
  }

  function getUpdateModeUiCopy(mode = getSidebarAiUpdateOutputMode()) {
    return AI_UPDATE_MODE_UI[mode] || AI_UPDATE_MODE_UI.commands;
  }

  function syncAiUpdateOutputModeUi() {
    const copy = getUpdateModeUiCopy();
    if (dom.updateBtn && !agentSessionActive) {
      dom.updateBtn.textContent = copy.buttonLabel;
    }
    if (dom.updateHintSource) {
      dom.updateHintSource.textContent = copy.hintSource;
    }
    if (dom.updateHintMode) {
      dom.updateHintMode.textContent = copy.hintMode;
    }
  }

  function syncAiTextureModeUi() {
    const mode = dom.textureBrowserMode?.value || "directory";
    dom.textureUploadWrap?.toggleAttribute("hidden", mode !== "upload");
    dom.pickTextureDirBtn?.toggleAttribute("hidden", mode !== "directory");
  }

  function syncAiCustomProviderUi() {
    dom.customBaseWrap?.toggleAttribute("hidden", dom.provider?.value !== "custom");
  }

  function setBusy(on, action = "") {
    const busy = Boolean(on);
    agentSessionActive = busy;
    dom.stopBtns().forEach((btn) => {
      btn.hidden = !busy;
    });
    if (dom.generateBtn) {
      dom.generateBtn.disabled = busy;
      dom.generateBtn.textContent = action === "generate" ? "生成中..." : "生成并载入";
    }
    if (dom.updateBtn) {
      dom.updateBtn.disabled = busy;
      const copy = getUpdateModeUiCopy();
      dom.updateBtn.textContent = action === "update" ? copy.busyLabel : copy.buttonLabel;
    }
    if (dom.imageBtn) {
      dom.imageBtn.disabled = busy;
      dom.imageBtn.textContent = action === "image" ? "看图生成中..." : "根据图片生成并载入";
    }
  }

  function normalizeCustomBase(raw) {
    let s = String(raw || "").trim();
    if (!s) {
      return "";
    }
    s = s.replace(/\/chat\/completions\/?$/i, "");
    return s.replace(/\/+$/, "");
  }

  function getCredentials() {
    const provider = dom.provider?.value || "chatgpt";
    const apiKey = dom.apiKey?.value?.trim() || "";
    const model = dom.model?.value?.trim() || "";
    if (!apiKey) {
      throw new Error("请先输入 API Key。");
    }
    const creds = {
      provider,
      apiKey,
      model: model || undefined,
      baseUrl: undefined,
      imageModel:
        host.getEditorSettings()?.ai?.defaultImageModel || EDITOR_SETTINGS_DEFAULTS.ai.defaultImageModel
    };
    if (provider === "custom") {
      const base = normalizeCustomBase(dom.customBase?.value);
      if (!base || !/^https?:\/\//i.test(base)) {
        throw new Error("自定义 Provider 请填写接口根 URL（须以 http:// 或 https:// 开头）。");
      }
      creds.baseUrl = base;
    }
    return creds;
  }

  function getClient() {
    const creds = getCredentials();
    const opts = { provider: creds.provider, apiKey: creds.apiKey, model: creds.model };
    if (creds.baseUrl) {
      opts.baseUrl = creds.baseUrl;
    }
    return createSceneAiClient(opts);
  }

  function getAgentOptions() {
    return {
      enabled: dom.agentEnabled?.checked === true,
      depth: dom.agentDepth?.value || "simple",
      iterativeApply: dom.agentIterative?.checked === true,
      fitViewEachRound: dom.agentFitViewEachRound?.checked === true
    };
  }

  function getSidebarAiUpdateOutputMode() {
    const mode = dom.updateMode?.value || "commands";
    if (["commands", "json-full", "json-incremental", "auto"].includes(mode)) {
      return mode;
    }
    return "commands";
  }

  function getSidebarStreamOptions() {
    if (!dom.streamPreview?.checked) {
      return {};
    }
    return { stream: true, streamPreview: true };
  }

  function getSidebarTransportOptions(extraOptions = {}) {
    return {
      signal: abortController?.signal,
      ...getSidebarStreamOptions(),
      ...extraOptions
    };
  }

  function beginAiOperation() {
    abortController?.abort();
    abortController = new AbortController();
    streamPreview.beginOperation();
    return abortController;
  }

  function persistAiPrefs() {
    syncAiSettingsFromSidebarDom(dom, host.getEditorSettings()?.ai);
    host.persistSettings?.();
  }

  function applySettingsFromEditor() {
    applyAiSettingsToSidebarDom(dom, host.getEditorSettings()?.ai);
    syncAiCustomProviderUi();
    streamPreview.syncDom();
    syncAiTextureModeUi();
    syncAiUpdateOutputModeUi();
  }

  function extractCommandScript(rawText) {
    const text = String(rawText ?? "").trim();
    if (!text) {
      return "";
    }
    const fenced = text.match(/```(?:command|commands|threejson|json)?\s*([\s\S]*?)\s*```/i);
    return (fenced && fenced[1] ? fenced[1] : text).trim();
  }

  function isLikelyCommandScript(rawText) {
    const body = extractCommandScript(rawText);
    if (!body) {
      return false;
    }
    if (body.startsWith("{") || body.startsWith("[")) {
      try {
        const parsed = JSON.parse(body);
        if (parsed && typeof parsed.op === "string") {
          return true;
        }
        if (Array.isArray(parsed) && parsed.every((item) => item && typeof item.op === "string")) {
          return true;
        }
      } catch {
        /* ignore */
      }
    }
    const lines = body
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    return lines.length > 0 && lines.every((line) => line.startsWith("{") || looksLikeMicroDslLine(line));
  }

  function renderAiAdjustLastResult(result, outputMode = getSidebarAiUpdateOutputMode()) {
    const formatted = buildAiAdjustLastResultText(result, outputMode);
    if (!formatted || !dom.lastAdjustResult) {
      dom.lastAdjustResult?.toggleAttribute("hidden", true);
      dom.lastAdjustResultLabel?.toggleAttribute("hidden", true);
      return;
    }
    if (dom.lastAdjustResultLabel) {
      dom.lastAdjustResultLabel.textContent = formatted.title;
      dom.lastAdjustResultLabel.toggleAttribute("hidden", false);
    }
    dom.lastAdjustResult.textContent = formatted.body;
    dom.lastAdjustResult.toggleAttribute("hidden", false);
    requestAnimationFrame(() => scrollAiStreamPreviewToEnd(dom.lastAdjustResult));
  }

  function notifyAiCommandBatchOutcome(batch, successMessage) {
    const results = batch?.results;
    const adjusted =
      batch?.sceneMutated === true ||
      batchResultsHaveSuccessfulAdjustment(results) ||
      (batch?.ok === true && Array.isArray(results) && results.length === 0);
    if (!adjusted) {
      const msg = "AI 仅执行查询命令，场景未修改。";
      host.showMessage(msg, "error");
      setMessage(msg);
      return false;
    }
    const assemblyWarning = formatAssemblyParentWarnings(batch);
    const viewOnly =
      !batchResultsHaveSceneMutation(results) && batchResultsHaveSuccessfulAdjustment(results);
    const noContentChange = batch?.ok === true && Array.isArray(results) && results.length === 0;
    if (viewOnly) {
      host.showMessage("AI 已调整相机/视角。", "success");
      setMessage("AI 已调整相机/视角。");
      return true;
    }
    if (noContentChange) {
      host.showMessage("已按您的要求，未修改场景内容。", "success");
      setMessage("已按您的要求，未修改场景内容。");
      return true;
    }
    const wasSession = agentSessionActive;
    if (wasSession) {
      host.markSceneDirty?.();
      const baseMsg = "AI 已更新场景。";
      const msg = assemblyWarning ? `${baseMsg} ${assemblyWarning}` : baseMsg;
      host.showMessage(msg, assemblyWarning ? "warning" : "success");
      setMessage(msg);
    } else {
      const baseMsg = successMessage || "AI 命令已执行。";
      const msg = assemblyWarning ? `${baseMsg} ${assemblyWarning}` : baseMsg;
      host.showMessage(msg, assemblyWarning ? "warning" : "success");
      setMessage(msg);
    }
    return true;
  }

  async function tryFinalizeAiCoreCommandsResult(commands, loadLabel, successMessage) {
    if (!Array.isArray(commands) || commands.length === 0) {
      return false;
    }
    host.getCommandLayer().ensure();
    const batch = await host.getCommandLayer().runBatch(commands, { label: loadLabel });
    if (!batch.ok) {
      const err = batch.results?.find((item) => !item.ok)?.error || "命令执行失败";
      setMessage(`失败：${err}`);
      host.showMessage(String(err), "error");
      return true;
    }
    notifyAiCommandBatchOutcome(batch, successMessage);
    return true;
  }

  async function tryFinalizeAiCommandScriptResult(script, loadLabel, successMessage) {
    if (!script || !isLikelyCommandScript(script)) {
      return false;
    }
    host.getCommandLayer().ensure();
    const batch = await host.getCommandLayer().runBatch(extractCommandScript(script), {
      label: loadLabel,
      stopOnError: true
    });
    if (!batch.ok) {
      const err = batch.results?.find((item) => !item.ok)?.error || "命令执行失败";
      setMessage(`失败：${err}`);
      host.showMessage(String(err), "error");
      return true;
    }
    notifyAiCommandBatchOutcome(batch, successMessage);
    return true;
  }

  async function finalizeAiSceneAgentResult(result, loadLabel, successMessage, finalizeOptions = {}) {
    if (result?.execOk === true) {
      notifyAiCommandBatchOutcome(result.batch || result, successMessage);
      return;
    }
    if (Array.isArray(result?.commands) && result.commands.length > 0) {
      const handled = await tryFinalizeAiCoreCommandsResult(result.commands, loadLabel, successMessage);
      if (handled) {
        return;
      }
    }
    const commandScript = result?.commandScript || result?.commandLines || "";
    if (commandScript) {
      const handled = await tryFinalizeAiCommandScriptResult(commandScript, loadLabel, successMessage);
      if (handled) {
        return;
      }
    }
    const sceneText = String(result?.sceneJsonString ?? "").trim();
    if (sceneText && isLikelyCommandScript(sceneText)) {
      const handled = await tryFinalizeAiCommandScriptResult(sceneText, loadLabel, successMessage);
      if (handled) {
        return;
      }
    }
    const wasSession = agentSessionActive;
    const loaded = await applyScenePayloadFromAiJsonString(host, result.sceneJsonString, loadLabel, {
      skipDirtyConfirm: finalizeOptions.skipDirtyConfirm === true || wasSession,
      keepDirtyAfterLoad: wasSession
    });
    if (!loaded) {
      setMessage("已取消载入。");
      return;
    }
    if (wasSession) {
      host.markSceneDirty?.();
      host.showMessage("AI 已更新场景。", "success");
    }
    const warn = formatTextureFillWarning(result.textureFillWarning);
    if (warn) {
      host.showMessage(warn, "error");
      setMessage(warn);
      return;
    }
    if (!wasSession) {
      host.showMessage(successMessage, "success");
    }
    setMessage(wasSession ? "AI 已更新场景。" : successMessage);
  }

  function enqueueAiStageSceneLoad(jsonString, hintLabel = "AI 阶段预览") {
    if (!jsonString || dom.stageAutoLoad?.checked !== true) {
      return stageLoadChain;
    }
    stageLoadChain = stageLoadChain
      .then(() =>
        applyScenePayloadFromAiJsonString(host, jsonString, hintLabel, {
          skipDirtyConfirm: true
        })
      )
      .catch((err) => {
        console.warn("stage auto-load", err);
      });
    return stageLoadChain;
  }

  function buildSidebarSceneAgentOnProgress(agent, texture, streamPreviewOn) {
    const streamOn = streamPreviewOn === true;
    return (payload) => {
      if (!payload) {
        return;
      }
      if (payload.kind === "stream" && streamOn && payload.previewDelta) {
        streamPreview.appendDelta(payload.previewDelta);
        setMessage("流式生成中…");
        return;
      }
      const stageJson = payload.sceneJsonString;
      const isStageLoad =
        (payload.kind === "scene_ready" || payload.kind === "stage_preview") && stageJson;
      if (isStageLoad) {
        void enqueueAiStageSceneLoad(stageJson, "AI 阶段预览").then(() => {
          setMessage(payload.message || "已载入阶段预览，纹理填充或后续步骤进行中…");
        });
        return;
      }
      if (payload.kind === "commands_applied") {
        if (agent.fitViewEachRound && payload.sceneMutated) {
          host.getCommandLayer().getApi()?.fitView?.("scene");
        }
        if (payload.sceneMutated) {
          host.markSceneDirty?.();
        }
        const label = payload.message || `第 ${payload.round || payload.step} 轮已应用到画布`;
        setMessage(`Agent [${payload.step}] ${label}`);
        return;
      }
      if (agent.enabled) {
        const label = payload.message || payload.kind || "进行中";
        setMessage(`Agent [${payload.step}] ${label}`);
        return;
      }
      if (texture?.enabled && payload.kind === "fill_textures") {
        setMessage(payload.message || "正在填充纹理…");
      }
    };
  }

  async function runSidebarSceneAgent(client, input, extraOptions = {}) {
    const agent = getAgentOptions();
    const texture = await buildSidebarTextureOptions(host, dom, getCredentials);
    const streamOpts = getSidebarStreamOptions();
    if (agent.enabled) {
      setMessage("Agent 多轮运行中（消耗更多 Token）…");
    }
    const result = await client.runSceneAgent(input, {
      agent,
      texture: texture || undefined,
      onProgress: buildSidebarSceneAgentOnProgress(agent, texture, streamOpts.streamPreview),
      ...getSidebarTransportOptions(extraOptions)
    });
    if (dom._textureZipSink?.finalizeDownload) {
      await dom._textureZipSink.finalizeDownload("threejson-ai-textures");
      host.showMessage("纹理已打包为 ZIP 下载；请解压到 resources/textures/ 后重新加载。", "success");
      dom._textureZipSink = null;
    }
    return result;
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

  async function interruptAiSessionIfActive(actionLabel = "手动编辑") {
    if (!agentSessionActive) {
      return true;
    }
    const ok = window.confirm(`AI 正在生成场景。${actionLabel} 将中止当前生成，是否继续？`);
    if (!ok) {
      return false;
    }
    abortController?.abort();
    setBusy(false);
    setMessage("已中止 AI 请求。");
    return true;
  }

  async function onGenerate() {
    const prompt = dom.generatePrompt?.value?.trim() || "";
    if (!prompt) {
      throw new Error("请输入生成提示词。");
    }
    const dirty = host.getEditorDocumentState?.()?.isDirty?.();
    if (dirty) {
      const ok = await host.confirmOverwriteIfDirty?.({ actionLabel: "开始 AI 生成" });
      if (!ok) {
        return;
      }
    }
    stageLoadChain = Promise.resolve();
    setMessage("AI 正在生成场景 JSON...");
    beginAiOperation();
    setBusy(true, "generate");
    try {
      const client = getClient();
      const result = await runSidebarSceneAgent(client, { mode: "generate", prompt });
      await stageLoadChain;
      await finalizeAiSceneAgentResult(result, "AI 生成", "AI 场景已载入。");
    } finally {
      setBusy(false);
    }
  }

  async function onUpdate() {
    const prompt = dom.updatePrompt?.value?.trim() || "";
    if (!prompt) {
      throw new Error("请输入修改说明。");
    }
    if (!host.getScene()) {
      throw new Error("场景尚未就绪。");
    }
    stageLoadChain = Promise.resolve();
    const outputMode = getSidebarAiUpdateOutputMode();
    const agent = getAgentOptions();
    const statusByMode = {
      commands: "AI 正在根据当前场景生成调整命令...",
      "json-full": "AI 正在根据当前场景生成 JSON 全量...",
      "json-incremental": "AI 正在根据当前场景生成 JSON 补丁...",
      auto: agent.enabled
        ? "AI Agent 正在自动选择命令或 JSON 调整..."
        : "AI 正在自动选择命令或 JSON 调整..."
    };
    const includeFullJson = dom.includeFullJson?.checked === true;
    const includeSpatialSummary = dom.includeSpatial?.checked === true;
    if (includeFullJson && includeSpatialSummary) {
      setMessage("已附带完整 JSON，空间摘要为可选补充。");
    } else {
      setMessage(statusByMode[outputMode] || statusByMode.commands);
    }
    beginAiOperation();
    setBusy(true, "update");
    try {
      const creds = getCredentials();
      const currentJson = await getSceneJsonText();
      host.getCommandLayer().ensure();
      const streamOpts = getSidebarStreamOptions();
      const result = await runEditorAiUpdate({
        prompt,
        editorApi: host.getCommandLayer().getApi(),
        aiOptions: {
          ...getSidebarTransportOptions(),
          provider: creds.provider,
          apiKey: creds.apiKey,
          model: creds.model,
          baseUrl: creds.baseUrl
        },
        includeFullJson,
        includeSpatialSummary,
        fullSceneJson: currentJson,
        getCurrentSceneJson: getSceneJsonText,
        label: "AI 调整",
        outputMode,
        agentEnabled: agent.enabled,
        agentOptions: agent,
        onProgress: buildSidebarSceneAgentOnProgress(agent, null, streamOpts.streamPreview)
      });
      if (result.outputMode === "commands" && result.execOk) {
        const results = result.batch?.results;
        const adjusted =
          result.sceneMutated === true ||
          batchResultsHaveSuccessfulAdjustment(results) ||
          (result.batch?.ok === true && Array.isArray(results) && results.length === 0);
        if (!adjusted) {
          if (result.iterativeApplied) {
            host.showMessage("已按您的要求，未修改场景内容。", "success");
            setMessage("Agent 迭代完成，场景无变更。");
            renderAiAdjustLastResult(result, outputMode);
            return;
          }
          const msg = "AI 仅执行查询命令，场景未修改。";
          host.showMessage(msg, "error");
          setMessage(msg);
          renderAiAdjustLastResult(result, outputMode);
          return;
        }
        const viewOnly =
          !batchResultsHaveSceneMutation(results) && batchResultsHaveSuccessfulAdjustment(results);
        const noContentChange = result.batch?.ok === true && Array.isArray(results) && results.length === 0;
        if (viewOnly) {
          host.showMessage("AI 已调整相机/视角。", "success");
          setMessage("AI 已调整相机/视角。");
          renderAiAdjustLastResult(result, outputMode);
          return;
        }
        if (noContentChange) {
          host.showMessage("已按您的要求，未修改场景内容。", "success");
          setMessage("已按您的要求，未修改场景内容。");
          renderAiAdjustLastResult(result, outputMode);
          return;
        }
        const assemblyWarning = formatAssemblyParentWarnings(result);
        const baseMsg = "AI 已更新场景。";
        const msg = assemblyWarning ? `${baseMsg} ${assemblyWarning}` : baseMsg;
        host.markSceneDirty?.();
        host.showMessage(msg, assemblyWarning ? "warning" : "success");
        setMessage(msg);
        renderAiAdjustLastResult(result, outputMode);
        host.getSceneTree()?.render();
        return;
      }
      if (result.sceneJsonString) {
        await stageLoadChain;
        await finalizeAiSceneAgentResult(result, "AI 调整", "AI 已更新场景。", {
          skipDirtyConfirm: true
        });
        renderAiAdjustLastResult(
          {
            ...result,
            updateMode: result.updateMode || (outputMode === "json-incremental" ? "incremental" : "full")
          },
          outputMode
        );
        return;
      }
      throw new Error("AI 调整未返回可用结果。");
    } finally {
      setBusy(false);
    }
  }

  function readImageFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("读取文件失败。"));
      reader.readAsDataURL(file);
    });
  }

  async function buildImagePayloadForVision() {
    const file = dom.imageFile?.files?.[0];
    if (file) {
      return readImageFileAsDataUrl(file);
    }
    const b64Block = dom.imageBase64?.value?.trim() || "";
    if (b64Block) {
      if (/^data:image\//i.test(b64Block)) {
        return b64Block;
      }
      const mime = dom.imageMime?.value?.trim() || "image/png";
      const cleaned = b64Block.replace(/\s+/g, "");
      return `data:${mime};base64,${cleaned}`;
    }
    const url = dom.imageUrl?.value?.trim() || "";
    if (url) {
      return url;
    }
    throw new Error("请提供图片：选择本地文件、填写 Base64，或填写 URL（优先级：文件 > Base64 > URL）。");
  }

  async function onImageGenerate() {
    const dirty = host.getEditorDocumentState?.()?.isDirty?.();
    if (dirty) {
      const ok = await host.confirmOverwriteIfDirty?.({ actionLabel: "开始 AI 看图生成" });
      if (!ok) {
        return;
      }
    }
    setBusy(true, "image");
    try {
      setMessage("正在准备图片并请求 AI...");
      const image = await buildImagePayloadForVision();
      const prompt = dom.imagePrompt?.value?.trim() || "";
      const imageDetail = dom.imageDetail?.value || "auto";
      stageLoadChain = Promise.resolve();
      beginAiOperation();
      const client = getClient();
      const result = await runSidebarSceneAgent(
        client,
        { mode: "fromImage", prompt, image },
        { imageDetail, maxTokens: 8192 }
      );
      await finalizeAiSceneAgentResult(result, "AI 看图生成", "看图生成场景已载入。");
    } finally {
      setBusy(false);
    }
  }

  async function onPickTextureDir() {
    if (!window.showDirectoryPicker) {
      host.showMessage("当前浏览器不支持目录选择，请改用 ZIP 下载模式。", "error");
      return;
    }
    try {
      dom._textureDirectoryHandle = await window.showDirectoryPicker();
      if (dom.textureDirHint) {
        dom.textureDirHint.textContent = "已授权纹理输出目录。";
      }
    } catch (err) {
      if (err?.name !== "AbortError") {
        console.warn(err);
      }
    }
  }

  function wireLeftTabs() {
    const tabs = [
      ["builtin", document.getElementById("leftSubTabBuiltin"), document.getElementById("leftSubPanelBuiltin")],
      ["aiConfig", document.getElementById("leftSubTabAiConfig"), document.getElementById("leftSubPanelAiConfig")],
      [
        "aiGenerate",
        document.getElementById("leftSubTabAiGenerate"),
        document.getElementById("leftSubPanelAiGenerate")
      ],
      ["aiAdjust", document.getElementById("leftSubTabAiAdjust"), document.getElementById("leftSubPanelAiAdjust")],
      ["aiImage", document.getElementById("leftSubTabAiImage"), document.getElementById("leftSubPanelAiImage")]
    ];
    const select = (which) => {
      activeLeftTab = which;
      for (const [id, tab, panel] of tabs) {
        const on = id === which;
        if (tab) {
          tab.classList.toggle("leftSubTabSelected", on);
          tab.setAttribute("aria-selected", on ? "true" : "false");
        }
        if (panel) {
          panel.hidden = !on;
        }
      }
      if (dom.messageWrap) {
        dom.messageWrap.hidden = which === "builtin";
      }
      streamPreview.syncDom();
      scrollAiStreamPreviewToEnd(dom.streamGenerate);
      scrollAiStreamPreviewToEnd(dom.streamAdjust);
      scrollAiStreamPreviewToEnd(dom.streamImage);
      scrollAiStreamPreviewToEnd(dom.lastAdjustResult);
    };
    tabs.forEach(([id, tab]) => {
      tab?.addEventListener("click", () => select(id));
    });
    const defaultTab =
      host.getEditorSettings()?.layout?.defaultLeftPanelTab || "builtin";
    select(defaultTab);
  }

  function handleAiError(err) {
    host.clearLoadingUi?.();
    if (isAiAbortError(err)) {
      setMessage("已中止。");
      return;
    }
    const msg = String(err?.message || err);
    setMessage(`失败：${msg}`);
    host.showMessage(msg, "error");
    console.error(err);
  }

  function init() {
    applySettingsFromEditor();
    wireLeftTabs();
    dom.provider?.addEventListener("change", () => {
      syncAiCustomProviderUi();
      persistAiPrefs();
    });
    [
      dom.apiKey,
      dom.model,
      dom.customBase,
      dom.remember,
      dom.agentEnabled,
      dom.agentDepth,
      dom.agentIterative,
      dom.agentFitViewEachRound
    ].forEach((el) => el?.addEventListener("change", persistAiPrefs));
    dom.updateMode?.addEventListener("change", () => {
      persistAiPrefs();
      syncAiUpdateOutputModeUi();
    });
    dom.includeFullJson?.addEventListener("change", persistAiPrefs);
    dom.includeSpatial?.addEventListener("change", persistAiPrefs);
    dom.streamPreview?.addEventListener("change", () => {
      persistAiPrefs();
      streamPreview.syncDom();
    });
    dom.stageAutoLoad?.addEventListener("change", persistAiPrefs);
    dom.textureBrowserMode?.addEventListener("change", () => {
      persistAiPrefs();
      syncAiTextureModeUi();
    });
    dom.generateBtn?.addEventListener("click", () => void onGenerate().catch(handleAiError));
    dom.updateBtn?.addEventListener("click", () => void onUpdate().catch(handleAiError));
    dom.imageBtn?.addEventListener("click", () => void onImageGenerate().catch(handleAiError));
    dom.pickTextureDirBtn?.addEventListener("click", () => void onPickTextureDir());
    dom.stopBtns().forEach((btn) => {
      btn.addEventListener("click", () => {
        abortController?.abort();
        setBusy(false);
        setMessage("已中止 AI 请求。");
      });
    });
    bindAiPanelSubmitShortcut(dom.generatePrompt, dom.generateBtn, onGenerate);
    bindAiPanelSubmitShortcut(dom.updatePrompt, dom.updateBtn, onUpdate);
    bindAiPanelSubmitShortcut(
      [dom.imagePrompt, dom.imageFile, dom.imageBase64, dom.imageUrl],
      dom.imageBtn,
      onImageGenerate
    );
  }

  async function runAgent(input, extraOptions = {}) {
    const client = getClient();
    const agent = getAgentOptions();
    const texture = await buildSidebarTextureOptions(host, dom, getCredentials);
    return runSidebarSceneAgent(client, input, {
      agent,
      texture: texture || undefined,
      ...getSidebarTransportOptions(extraOptions)
    });
  }

  return {
    init,
    applySettingsFromEditor,
    interruptAiSessionIfActive,
    setMessage,
    getClient,
    runAgent,
    isAgentSessionActive: () => agentSessionActive
  };
}

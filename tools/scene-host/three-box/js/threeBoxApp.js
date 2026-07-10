import { createThreeBoxViewChrome } from "./threeBoxViewChrome.js";
import { createThreeBoxSidebar } from "./threeBoxSidebar.js";
import { createThreeBoxTemplateGallery } from "./threeBoxTemplateGallery.js";
import { createThreeBoxSettingsModal } from "./threeBoxSettingsModal.js";
import { createThreeBoxChatPanel } from "./threeBoxChatPanel.js";
import { createThreeBoxSceneCard } from "./threeBoxSceneCard.js";
import { putTurn, getTurn, getTurnsForConversation, createTurnId } from "./threeBoxSessionStore.js";
import {
  resolveProviderOptions,
  buildResultDigest,
  runThreeBoxGenerateTurn,
  runThreeBoxAdjustTurn,
  runThreeBoxSummary,
  classifyThreeBoxTurnIntent,
  resolveAdjustContextPayload,
  exportRuntimeSceneJsonString,
  isProviderVisionCapable
} from "./threeBoxOrchestrator.js";
import { createThreeBoxAttachedContext } from "./threeBoxAttachedContext.js";
import { wireThreeBoxComposerStub } from "./threeBoxComposerStub.js";
import { buildStructuredTurnEnvelope } from "threejson/core";

function populateComposerModelSelect(settings) {
  const select = document.getElementById("composerModelSelect");
  if (!select) {
    return;
  }
  const providers = Array.isArray(settings?.ai?.providers) ? settings.ai.providers : [];
  const previousValue = select.value;
  select.innerHTML = "";
  if (providers.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "未配置模型";
    select.appendChild(opt);
    return;
  }
  for (const provider of providers) {
    const opt = document.createElement("option");
    opt.value = provider.id;
    opt.textContent = provider.label || provider.id;
    select.appendChild(opt);
  }
  const defaultId = settings.ai.defaultProviderId || providers[0].id;
  select.value = providers.some((p) => p.id === previousValue) ? previousValue : defaultId;
}

async function main() {
  const viewChrome = createThreeBoxViewChrome();
  viewChrome.init();

  const attachedContext = createThreeBoxAttachedContext();
  const templateGallery = createThreeBoxTemplateGallery({
    onSelectTemplate: (item, payload) => attachedContext.setTemplate(item, payload)
  });
  const settingsModal = createThreeBoxSettingsModal({
    onSave: (settings) => populateComposerModelSelect(settings)
  });
  settingsModal.init();
  populateComposerModelSelect(settingsModal.getSettings());

  let sidebar;
  // Each rendered scene card stays live in the DOM for the lifetime of the conversation (turns
  // are never disposed until "新聊天"/clear), so a later adjust turn can mutate an EARLIER turn's
  // still-live runtime directly via commands, rather than only ever regenerating full JSON.
  const sceneCardsByTurnId = new Map();

  function getVisionCapable() {
    const settings = settingsModal.getSettings();
    const selectedProviderId = document.getElementById("composerModelSelect")?.value;
    return isProviderVisionCapable(resolveProviderOptions(settings, selectedProviderId));
  }

  function stageResultLabel(stage) {
    if (stage === "commands") return "操作命令";
    if (stage === "json-incremental") return "JSON Patch";
    return "完整 JSON";
  }

  async function handleGenerateTurn(text, api, { conversationId, turnId }) {
    const settings = settingsModal.getSettings();
    const selectedProviderId = document.getElementById("composerModelSelect")?.value;
    const providerOptions = resolveProviderOptions(settings, selectedProviderId);

    const textEl = api.appendAssistantMessage("");
    const streaming = api.createStreamingBlock();
    api.appendToBody(textEl, streaming.el);
    let streamBuffer = "";

    try {
      const { sceneJson, sceneJsonString } = await runThreeBoxGenerateTurn({
        userPrompt: text,
        providerOptions,
        onDelta: (delta) => {
          streamBuffer += delta;
          streaming.update(streamBuffer);
        }
      });

      const digest = buildResultDigest(sceneJson);
      const recap =
        (await runThreeBoxSummary({
          userPrompt: text,
          mode: "generate",
          turnId,
          resultDigest: digest,
          providerOptions
        }).catch(() => "")) || "已根据您的描述生成场景。";

      streaming.remove();
      api.updateAssistantMessage(textEl, recap);
      api.appendToBody(textEl, api.buildJsonCollapse(sceneJsonString));
      const sceneCard = createThreeBoxSceneCard();
      api.appendToBody(textEl, sceneCard.el);
      await sceneCard.render(sceneJson);
      sceneCardsByTurnId.set(turnId, sceneCard);

      await putTurn({
        id: turnId,
        conversationId,
        seq: Date.now(),
        userPrompt: text,
        mode: "generate",
        targetTurnId: null,
        sceneJson: sceneJsonString,
        spatialSummary: "",
        recapSummary: recap,
        createdAt: Date.now()
      });
      sidebar.touchActiveConversation(text);
    } catch (error) {
      console.error("[three-box] generate turn failed:", error);
      streaming.remove();
      api.updateAssistantMessage(textEl, `生成失败：${error?.message || error}`);
    }
  }

  async function handleAdjustTurn(text, api, { conversationId, turnId, targetTurnId }) {
    const settings = settingsModal.getSettings();
    const selectedProviderId = document.getElementById("composerModelSelect")?.value;
    const providerOptions = resolveProviderOptions(settings, selectedProviderId);

    const targetTurn = await getTurn(targetTurnId);
    if (!targetTurn?.sceneJson) {
      // Safe fallback: target turn vanished from cache (e.g. cleared) — treat as a fresh generate.
      return handleGenerateTurn(text, api, { conversationId, turnId });
    }
    const targetSceneJson = JSON.parse(targetTurn.sceneJson);
    const targetSceneCard = sceneCardsByTurnId.get(targetTurnId);

    const textEl = api.appendAssistantMessage("");
    const streaming = api.createStreamingBlock();
    api.appendToBody(textEl, streaming.el);
    let streamBuffer = "";

    try {
      const contextPayload = resolveAdjustContextPayload(targetSceneJson, settings.ai);
      const envelope = buildStructuredTurnEnvelope({
        userPrompt: text,
        intent: "adjust",
        targetTurnId,
        contextPayload
      });

      const result = await runThreeBoxAdjustTurn({
        userPrompt: text,
        envelope,
        targetSceneJsonString: targetTurn.sceneJson,
        runtime: targetSceneCard?.getRuntime?.(),
        providerOptions,
        onDelta: (delta) => {
          streamBuffer += delta;
          streaming.update(streamBuffer);
        }
      });

      let sceneJson = result.sceneJson;
      let sceneJsonString = result.sceneJsonString;
      if (result.stage === "commands") {
        sceneJsonString = exportRuntimeSceneJsonString(targetSceneCard.getRuntime());
        sceneJson = JSON.parse(sceneJsonString);
      }

      const digest = buildResultDigest(sceneJson);
      const recap =
        (await runThreeBoxSummary({
          userPrompt: text,
          mode: "adjust",
          targetTurnId,
          turnId,
          resultDigest: digest,
          providerOptions
        }).catch(() => "")) || `已通过${stageResultLabel(result.stage)}调整了场景。`;

      streaming.remove();
      api.updateAssistantMessage(textEl, `${recap}（方式：${stageResultLabel(result.stage)}）`);
      api.appendToBody(textEl, api.buildJsonCollapse(sceneJsonString));
      const sceneCard = createThreeBoxSceneCard();
      api.appendToBody(textEl, sceneCard.el);
      await sceneCard.render(sceneJson);
      sceneCardsByTurnId.set(turnId, sceneCard);

      await putTurn({
        id: turnId,
        conversationId,
        seq: Date.now(),
        userPrompt: text,
        mode: "adjust",
        targetTurnId,
        sceneJson: sceneJsonString,
        spatialSummary: "",
        recapSummary: recap,
        createdAt: Date.now()
      });
      sidebar.touchActiveConversation(text);
    } catch (error) {
      console.error("[three-box] adjust turn failed:", error);
      streaming.remove();
      api.updateAssistantMessage(textEl, `调整失败：${error?.message || error}`);
    }
  }

  /** Consumes a sidebar-attached template (if any) as a "seed" turn: cached + rendered exactly
   * like a real turn, but with no AI call — it's the attached JSON verbatim. The user's actual
   * typed message is then handled as an adjust of this seed turn (see handleUserMessage), so it
   * flows through the same commands→patch→full fallback chain as any other adjustment, with a
   * live runtime available for the commands stage. Returns null if nothing was attached. */
  async function consumeAttachedContextAsSeedTurn(api) {
    const attached = attachedContext.get();
    if (!attached) {
      return null;
    }
    attachedContext.clear();

    const conversationId = sidebar.ensureActiveConversation().id;
    const seedTurnId = createTurnId();
    const sceneJsonString = JSON.stringify(attached.sceneJson, null, 2);

    const textEl = api.appendAssistantMessage(`已应用模板「${attached.label}」作为上下文。`);
    const sceneCard = createThreeBoxSceneCard();
    api.appendToBody(textEl, sceneCard.el);
    await sceneCard.render(attached.sceneJson);
    sceneCardsByTurnId.set(seedTurnId, sceneCard);

    await putTurn({
      id: seedTurnId,
      conversationId,
      seq: Date.now(),
      userPrompt: `(模板) ${attached.label}`,
      mode: "template",
      targetTurnId: null,
      sceneJson: sceneJsonString,
      spatialSummary: "",
      recapSummary: `已应用模板「${attached.label}」。`,
      createdAt: Date.now()
    });
    sidebar.touchActiveConversation(`模板：${attached.label}`);
    return { conversationId, seedTurnId };
  }

  async function handleUserMessage(text, api) {
    const settings = settingsModal.getSettings();
    const selectedProviderId = document.getElementById("composerModelSelect")?.value;
    const providerOptions = resolveProviderOptions(settings, selectedProviderId);
    if (!providerOptions || !providerOptions.apiKey) {
      api.appendAssistantMessage(
        "尚未配置可用的 AI 供应商。请点击左侧「AI 配置」，添加一个供应商并填写 API Key 后再试。"
      );
      return;
    }

    const seed = await consumeAttachedContextAsSeedTurn(api);
    if (seed) {
      const turnId = createTurnId();
      await handleAdjustTurn(text, api, { conversationId: seed.conversationId, turnId, targetTurnId: seed.seedTurnId });
      return;
    }

    const conversationId = sidebar.ensureActiveConversation().id;
    const turnId = createTurnId();
    const priorTurns = await getTurnsForConversation(conversationId).catch(() => []);

    if (!priorTurns.length) {
      await handleGenerateTurn(text, api, { conversationId, turnId });
      return;
    }

    const history = priorTurns.map((t) => ({ turnId: t.id, summary: t.recapSummary || t.userPrompt }));
    const classified = await classifyThreeBoxTurnIntent({ userPrompt: text, history }, providerOptions);
    if (classified.intent === "adjust" && classified.targetTurnId) {
      await handleAdjustTurn(text, api, { conversationId, turnId, targetTurnId: classified.targetTurnId });
    } else {
      await handleGenerateTurn(text, api, { conversationId, turnId });
    }
  }

  const chatPanel = createThreeBoxChatPanel({ onUserMessage: handleUserMessage });
  chatPanel.init();

  /** Disposes every currently-tracked scene card's WebGL context before dropping the map —
   * plain `Map.clear()` alone leaks a live renderer per turn (browsers cap concurrent WebGL
   * contexts, so repeated "新聊天" without this would eventually start silently losing contexts). */
  function disposeAllSceneCards() {
    for (const card of sceneCardsByTurnId.values()) {
      card.dispose?.();
    }
    sceneCardsByTurnId.clear();
  }

  /** Replaces the chat view with a past conversation's turns, replayed from the session cache
   * (no AI calls — same recap/JSON/scene-card render pipeline as a live turn, just fed cached
   * data instead of a fresh orchestrator result). */
  async function switchToConversation(conversationId) {
    disposeAllSceneCards();
    attachedContext.clear();
    chatPanel.clear();
    const turns = await getTurnsForConversation(conversationId).catch(() => []);
    if (!turns.length) {
      return;
    }
    chatPanel.showMessagesView();
    for (const turn of turns) {
      chatPanel.appendMessage("user", turn.userPrompt);
      const textEl = chatPanel.appendMessage("assistant", turn.recapSummary || "");
      chatPanel.appendToBody(textEl, chatPanel.buildJsonCollapse(turn.sceneJson));
      const sceneCard = createThreeBoxSceneCard();
      chatPanel.appendToBody(textEl, sceneCard.el);
      await sceneCard.render(JSON.parse(turn.sceneJson));
      sceneCardsByTurnId.set(turn.id, sceneCard);
    }
  }

  sidebar = createThreeBoxSidebar({
    onTemplateSearch: (query) => templateGallery.filter(query),
    openAiConfig: () => settingsModal.open("ai"),
    openSettings: () => settingsModal.open("general"),
    onNewChat: () => {
      disposeAllSceneCards();
      attachedContext.clear();
      chatPanel.clear();
    },
    onSelectConversation: (conversationId) => {
      void switchToConversation(conversationId);
    }
  });
  sidebar.init();
  await templateGallery.init();

  wireThreeBoxComposerStub({ getVisionCapable });
}

main();

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
  isProviderVisionCapable,
  resolveTurnSceneJsonString,
  resolveThreeBoxAgentOptions
} from "./threeBoxOrchestrator.js";
import { createThreeBoxAttachedContext } from "./threeBoxAttachedContext.js";
import { wireThreeBoxComposerStub } from "./threeBoxComposerStub.js";
import { createThreeBoxResourceLibrary } from "./threeBoxResourceLibrary.js";
import { buildStructuredTurnEnvelope } from "threejson";
import { initHostI18n, applyShellI18n, getHostLocale, normalizeLocale, t } from "../../shared/i18n/index.js";

function readRequestedLocaleFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search || "");
    const raw = params.get("lang") || params.get("locale") || "";
    return raw ? normalizeLocale(raw) : "";
  } catch (_error) {
    return "";
  }
}

function localeDisplayName(locale, displayLocale) {
  if (locale === "zh-CN") {
    return displayLocale === "zh-CN" ? "中文" : "Chinese";
  }
  return displayLocale === "zh-CN" ? "英文" : "English";
}

function shouldPromptLocaleSwitch(settingsLocale, requestedLocale) {
  const current = String(settingsLocale || "auto").trim();
  return (current === "zh-CN" || current === "en-US")
    && (requestedLocale === "zh-CN" || requestedLocale === "en-US")
    && current !== requestedLocale;
}

function confirmLocaleSwitch(settingsLocale, requestedLocale) {
  const zhRequested = localeDisplayName(requestedLocale, "zh-CN");
  const zhCurrent = localeDisplayName(settingsLocale, "zh-CN");
  const enRequested = localeDisplayName(requestedLocale, "en-US");
  const enCurrent = localeDisplayName(settingsLocale, "en-US");
  return window.confirm([
    `官网当前为${zhRequested}，但 ThreeBox 当前为${zhCurrent}。是否将 ThreeBox 切换为${zhRequested}？`,
    "",
    `The website is currently in ${enRequested}, but ThreeBox is currently in ${enCurrent}. Switch ThreeBox to ${enRequested}?`
  ].join("\n"));
}

/** Human-readable language name for the AI recap prompt (see core/ai/sceneChatSession.js's
 * `responseLanguage`) — keeps the "简短总结" text following the current UI locale setting instead
 * of whatever language the user happened to type their request in. */
function resolveSummaryResponseLanguage() {
  return getHostLocale() === "zh-CN" ? "Simplified Chinese" : "English";
}

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
    opt.textContent = t("threebox.app.noModelConfigured", "未配置模型");
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
  // `createThreeBoxSettingsModal` reads persisted settings synchronously (no `.init()` needed to
  // call `.getSettings()`), so it's constructed first purely to read `general.locale` for the
  // locale bootstrap below — nothing about it renders yet.
  const settingsModal = createThreeBoxSettingsModal({
    onSave: (settings) => {
      populateComposerModelSelect(settings);
      void applyHostLocaleFromSettings(settings);
    },
    // `templateGallery` is declared with `const` further down in `main()` — same forward-reference
    // pattern as `applyHostLocaleFromSettings` above, safe because these only run in response to a
    // later button click, well after `templateGallery` has been assigned.
    onRebuildTemplateThumbnails: () => templateGallery?.rebuildThumbnailCache(),
    onClearTemplateThumbnails: () => templateGallery?.clearThumbnailCache()
  });
  const requestedLocale = readRequestedLocaleFromUrl();
  const currentSettingsLocale = settingsModal.getSettings()?.general?.locale || "auto";
  if (shouldPromptLocaleSwitch(currentSettingsLocale, requestedLocale) && confirmLocaleSwitch(currentSettingsLocale, requestedLocale)) {
    settingsModal.updateSettings((next) => {
      next.general = { ...(next.general || {}), locale: requestedLocale };
    }, { notify: false, toast: false, closeModal: false });
  }

  /** Applies the "界面语言" (general.locale) setting to every data-i18n-tagged element in the
   * shell (sidebar, composer, hero, modals) plus every module that renders dynamic, non-attribute
   * content (sidebar history/relative time, template cards, resource list, pin-button tooltip) —
   * previously this setting was saved but never actually applied anywhere, so switching languages
   * had no visible effect. `viewChrome`/`sidebar`/`templateGallery`/`resourceLibrary` are declared
   * with `let`/`const` further down in `main()`; this function is only ever *invoked* after
   * they've been assigned (once eagerly right below their declarations, and again later from
   * `onSave`), so the closure over them here is safe despite the temporal-dead-zone-looking
   * forward reference. */
  async function applyHostLocaleFromSettings(settings) {
    await initHostI18n(settings?.general?.locale);
    applyShellI18n(document);
    viewChrome?.refresh();
    resourceLibrary?.refresh();
    sidebar?.refresh();
    templateGallery?.refresh();
  }
  // Bootstrap the locale before any dynamic content renders for the first time.
  await initHostI18n(settingsModal.getSettings()?.general?.locale);
  applyShellI18n(document);

  const viewChrome = createThreeBoxViewChrome();
  viewChrome.init();

  const attachedContext = createThreeBoxAttachedContext();
  const templateGallery = createThreeBoxTemplateGallery({
    onSelectTemplate: (item, payload) => attachedContext.setTemplate(item, payload)
  });
  const resourceLibrary = createThreeBoxResourceLibrary({ attachedContext });
  resourceLibrary.init();
  settingsModal.init();
  populateComposerModelSelect(settingsModal.getSettings());

  let sidebar;
  // Each rendered scene card stays live in the DOM for the lifetime of the conversation (turns
  // are never disposed until "新聊天"/clear). History is immutable: an adjust turn always builds
  // its own private offscreen runtime (see threeBoxOrchestrator.js) and renders the result into a
  // brand-new scene card for the NEW turn — an earlier turn's card is never touched.
  const sceneCardsByTurnId = new Map();

  function getVisionCapable() {
    const settings = settingsModal.getSettings();
    const selectedProviderId = document.getElementById("composerModelSelect")?.value;
    return isProviderVisionCapable(resolveProviderOptions(settings, selectedProviderId));
  }

  function stageResultLabel(stage) {
    if (stage === "commands") return t("threebox.app.stageCommands", "操作命令");
    if (stage === "json-incremental") return t("threebox.app.stageJsonPatch", "JSON Patch");
    return t("threebox.app.stageFullJson", "完整 JSON");
  }

  function createAgentProgressUpdater(streaming) {
    const lines = [];
    let streamBuffer = "";
    return (progress) => {
      if (!progress) {
        return;
      }
      if (progress.kind === "stream" && progress.previewDelta) {
        streamBuffer += progress.previewDelta;
        streaming.update(streamBuffer);
        return;
      }
      const label = progress.message || progress.kind || "";
      if (!label) {
        return;
      }
      lines.push(`${lines.length + 1}. ${label}`);
      streaming.update(lines.slice(-12).join("\n"));
    };
  }

  function buildAgentProcessSummary(agentResult) {
    if (!agentResult?.agentUsed || !Array.isArray(agentResult.steps)) {
      return "";
    }
    const lines = agentResult.steps.slice(0, 10).map((step, index) => {
      const kind = step.kind || "step";
      const state = step.ok === false ? "failed" : "ok";
      const extra = step.error ? `: ${step.error}` : step.count != null ? ` (${step.count})` : "";
      return `${index + 1}. ${kind} - ${state}${extra}`;
    });
    const more = agentResult.steps.length > lines.length ? `\n... ${agentResult.steps.length - lines.length} more step(s)` : "";
    return [`**Agent process**`, ...lines, more].filter(Boolean).join("\n");
  }

  /** Resolves a turn's full scene JSON string, reconstructing it via command replay when the turn
   * was diff-cached (io.turnCacheMode "diff" — see threeBoxSettingsSchema.js and
   * threeBoxOrchestrator.js's resolveTurnSceneJsonString). Turns cached in "full" mode (the
   * default) always have sceneJson already, so this is a no-op fast path for them. */
  async function resolveSceneJsonStringForTurn(turn, conversationId) {
    if (turn.sceneJson) {
      return turn.sceneJson;
    }
    const orderedTurns = await getTurnsForConversation(conversationId);
    return resolveTurnSceneJsonString(orderedTurns, turn.id);
  }

  async function handleGenerateTurn(text, api, { conversationId, turnId }) {
    const settings = settingsModal.getSettings();
    const selectedProviderId = document.getElementById("composerModelSelect")?.value;
    const providerOptions = resolveProviderOptions(settings, selectedProviderId);

    const textEl = api.appendAssistantMessage("");
    const streaming = api.createStreamingBlock();
    api.appendToBody(textEl, streaming.el);
    let streamBuffer = "";
    const agentOptions = resolveThreeBoxAgentOptions(settings);
    const updateAgentProgress = createAgentProgressUpdater(streaming);

    try {
      const { sceneJson, sceneJsonString, agentResult } = await runThreeBoxGenerateTurn({
        userPrompt: text,
        providerOptions,
        globalPromptPrefix: settings.ai?.globalPromptPrefix,
        onDelta: (delta) => {
          streamBuffer += delta;
          streaming.update(streamBuffer);
        },
        agentOptions,
        onAgentProgress: updateAgentProgress
      });

      streaming.remove();
      const agentSummary = buildAgentProcessSummary(agentResult);
      if (agentSummary) {
        api.appendToBody(textEl, api.buildSummaryBlock(agentSummary));
      }
      api.appendToBody(textEl, api.buildJsonCollapse(sceneJsonString));
      const sceneCard = createThreeBoxSceneCard();
      api.appendToBody(textEl, sceneCard.el);
      await sceneCard.render(sceneJson, { label: text });
      sceneCardsByTurnId.set(turnId, sceneCard);

      let recap = "";
      if (settings.ai?.includeTurnSummary !== false) {
        const digest = buildResultDigest(sceneJson);
        recap =
          (await runThreeBoxSummary({
            userPrompt: text,
            mode: "generate",
            turnId,
            resultDigest: digest,
            providerOptions,
            responseLanguage: resolveSummaryResponseLanguage()
          }).catch(() => "")) || t("threebox.app.defaultGenerateRecap", "已根据您的描述生成场景。");
        api.appendToBody(textEl, api.buildSummaryBlock(recap));
      }

      // The first turn of a conversation is always the reconstruction anchor for any later
      // diff-cached ("commands"-only) turns, so it always keeps a full sceneJson regardless of
      // io.turnCacheMode.
      await putTurn({
        id: turnId,
        conversationId,
        seq: Date.now(),
        userPrompt: text,
        mode: "generate",
        targetTurnId: null,
        stage: "generate",
        sceneJson: sceneJsonString,
        commands: null,
        spatialSummary: "",
        recapSummary: recap,
        createdAt: Date.now()
      });
      sidebar.touchActiveConversation(text);
    } catch (error) {
      console.error("[threebox] generate turn failed:", error);
      streaming.remove();
      api.updateAssistantMessage(textEl, t("threebox.app.generateFailed", "生成失败：{error}", { error: error?.message || error }));
    }
  }

  async function handleAdjustTurn(text, api, { conversationId, turnId, targetTurnId }) {
    const settings = settingsModal.getSettings();
    const selectedProviderId = document.getElementById("composerModelSelect")?.value;
    const providerOptions = resolveProviderOptions(settings, selectedProviderId);

    const targetTurn = await getTurn(targetTurnId);
    if (!targetTurn) {
      // Safe fallback: target turn vanished from cache (e.g. cleared) — treat as a fresh generate.
      return handleGenerateTurn(text, api, { conversationId, turnId });
    }
    let targetSceneJsonString;
    try {
      targetSceneJsonString = await resolveSceneJsonStringForTurn(targetTurn, conversationId);
    } catch (error) {
      console.error("[threebox] failed to resolve target scene JSON:", error);
      return handleGenerateTurn(text, api, { conversationId, turnId });
    }
    const targetSceneJson = JSON.parse(targetSceneJsonString);

    const textEl = api.appendAssistantMessage("");
    const streaming = api.createStreamingBlock();
    api.appendToBody(textEl, streaming.el);
    let streamBuffer = "";
    const agentOptions = resolveThreeBoxAgentOptions(settings);
    const updateAgentProgress = createAgentProgressUpdater(streaming);

    try {
      const contextPayload = resolveAdjustContextPayload(targetSceneJson, settings.ai);
      const envelope = buildStructuredTurnEnvelope({
        userPrompt: text,
        intent: "adjust",
        targetTurnId,
        contextPayload,
        globalPromptPrefix: settings.ai?.globalPromptPrefix
      });

      const result = await runThreeBoxAdjustTurn({
        userPrompt: text,
        envelope,
        targetSceneJsonString,
        providerOptions,
        agentOptions,
        updateOutputMode: settings.ai?.updateOutputMode || "commands",
        resolveContextPayload: (sceneJson) => resolveAdjustContextPayload(sceneJson, settings.ai),
        onAgentProgress: updateAgentProgress,
        onDelta: (delta) => {
          streamBuffer += delta;
          streaming.update(streamBuffer);
        }
      });

      const sceneJson = result.sceneJson;
      const sceneJsonString = result.sceneJsonString;

      streaming.remove();
      const agentSummary = buildAgentProcessSummary(result.agentResult);
      if (agentSummary) {
        api.appendToBody(textEl, api.buildSummaryBlock(agentSummary));
      }
      // Show what the AI actually produced (commands / JSON Patch) above the merged final JSON,
      // so the user can see the diff the model generated instead of only the end result.
      if (result.stage === "commands" && result.commands?.length) {
        api.appendToBody(textEl, api.buildDiffCollapse("commands", JSON.stringify(result.commands, null, 2)));
      } else if (result.stage === "json-incremental" && result.patch) {
        api.appendToBody(textEl, api.buildDiffCollapse("patch", JSON.stringify(result.patch, null, 2)));
      }
      api.appendToBody(textEl, api.buildJsonCollapse(sceneJsonString));
      const sceneCard = createThreeBoxSceneCard();
      api.appendToBody(textEl, sceneCard.el);
      await sceneCard.render(sceneJson, { label: text });
      sceneCardsByTurnId.set(turnId, sceneCard);

      let recap = "";
      if (settings.ai?.includeTurnSummary !== false) {
        const digest = buildResultDigest(sceneJson);
        recap =
          (await runThreeBoxSummary({
            userPrompt: text,
            mode: "adjust",
            targetTurnId,
            turnId,
            resultDigest: digest,
            providerOptions,
            responseLanguage: resolveSummaryResponseLanguage()
          }).catch(() => "")) ||
          t("threebox.app.defaultAdjustRecap", "已通过{stage}调整了场景。", { stage: stageResultLabel(result.stage) });
        api.appendToBody(
          textEl,
          api.buildSummaryBlock(
            t("threebox.app.adjustRecapWithMethod", "{recap}（方式：{stage}）", { recap, stage: stageResultLabel(result.stage) })
          )
        );
      }

      // `commands`/`patch` are stored for display (item ④'s "查看调整命令/JSON Patch" collapse)
      // regardless of cache mode. Only whether sceneJson itself is also stored is gated by
      // io.turnCacheMode — diff mode drops it for "commands"-stage turns (the only stage with a
      // replayable delta; json-incremental/json-full always keep the full JSON since there's no
      // cheaper way to reconstruct them).
      const diffCacheEligible = result.stage === "commands" && result.commands?.length;
      const useDiffCache = settings.io?.turnCacheMode === "diff" && diffCacheEligible;
      await putTurn({
        id: turnId,
        conversationId,
        seq: Date.now(),
        userPrompt: text,
        mode: "adjust",
        targetTurnId,
        stage: result.stage,
        sceneJson: useDiffCache ? null : sceneJsonString,
        commands: result.stage === "commands" ? result.commands || null : null,
        patch: result.stage === "json-incremental" ? result.patch || null : null,
        spatialSummary: "",
        recapSummary: recap,
        createdAt: Date.now()
      });
      sidebar.touchActiveConversation(text);
    } catch (error) {
      console.error("[threebox] adjust turn failed:", error);
      streaming.remove();
      api.updateAssistantMessage(textEl, t("threebox.app.adjustFailed", "调整失败：{error}", { error: error?.message || error }));
    }
  }

  /** Consumes a sidebar-attached template (if any) as a "seed" turn: cached + rendered exactly
   * like a real turn, but with no AI call — it's the attached JSON verbatim. The user's actual
   * typed message is then handled as an adjust of this seed turn (see handleUserMessage), so it
   * flows through the same commands→patch→full fallback chain as any other adjustment. Returns
   * null if nothing was attached. */
  async function consumeAttachedContextAsSeedTurn(api) {
    const attached = attachedContext.get();
    if (!attached) {
      return null;
    }
    attachedContext.clear();

    const conversationId = sidebar.ensureActiveConversation().id;
    const seedTurnId = createTurnId();
    const sceneJsonString = JSON.stringify(attached.sceneJson, null, 2);

    const textEl = api.appendAssistantMessage(
      t("threebox.app.templateAppliedMessage", "已应用模板「{label}」作为上下文。", { label: attached.label })
    );
    const sceneCard = createThreeBoxSceneCard();
    api.appendToBody(textEl, sceneCard.el);
    await sceneCard.render(attached.sceneJson, { label: attached.label });
    sceneCardsByTurnId.set(seedTurnId, sceneCard);

    // A seed turn is a reconstruction anchor for anything adjusted from it, exactly like a
    // "generate" turn, so it always keeps a full sceneJson regardless of io.turnCacheMode.
    await putTurn({
      id: seedTurnId,
      conversationId,
      seq: Date.now(),
      userPrompt: t("threebox.app.templateUserPromptPrefix", "(模板) {label}", { label: attached.label }),
      mode: "template",
      targetTurnId: null,
      stage: "template",
      sceneJson: sceneJsonString,
      commands: null,
      spatialSummary: "",
      recapSummary: t("threebox.app.templateAppliedRecap", "已应用模板「{label}」。", { label: attached.label }),
      createdAt: Date.now()
    });
    sidebar.touchActiveConversation(t("threebox.app.templateTouchLabel", "模板：{label}", { label: attached.label }));
    return { conversationId, seedTurnId };
  }

  async function handleUserMessage(text, api) {
    try {
      await handleUserMessageUnsafe(text, api);
    } catch (error) {
      // Last-resort safety net: any uncaught error in the routing logic above (e.g. a malformed
      // attached template/upload throwing inside sceneCard.render()) must still surface to the
      // user instead of vanishing — an unhandled rejection here would otherwise leave the chat
      // looking like it did nothing at all after Send was clicked.
      console.error("[threebox] handleUserMessage failed:", error);
      api.appendAssistantMessage(t("threebox.app.processingFailed", "处理失败：{error}", { error: error?.message || error }));
    }
  }

  async function handleUserMessageUnsafe(text, api) {
    const settings = settingsModal.getSettings();
    const selectedProviderId = document.getElementById("composerModelSelect")?.value;
    const providerOptions = resolveProviderOptions(settings, selectedProviderId);
    if (!providerOptions || !providerOptions.apiKey) {
      api.appendAssistantMessage(
        t(
          "threebox.app.noProviderConfigured",
          "尚未配置可用的 AI 供应商。请点击左侧「AI 配置」，添加一个供应商并填写 API Key 后再试。"
        )
      );
      return;
    }

    let seed;
    try {
      seed = await consumeAttachedContextAsSeedTurn(api);
    } catch (error) {
      console.error("[threebox] consumeAttachedContextAsSeedTurn failed:", error);
      api.appendAssistantMessage(
        t("threebox.app.loadAttachedFailed", "加载已附加的场景失败：{error}", { error: error?.message || error })
      );
      return;
    }
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
      const textEl = chatPanel.appendMessage("assistant", "");
      let sceneJsonString;
      try {
        // Diff-cached ("commands"-only) turns have no sceneJson of their own — reconstruct it by
        // replaying commands from the nearest earlier full-JSON turn (see
        // threeBoxOrchestrator.js's resolveTurnSceneJsonString).
        sceneJsonString = await resolveSceneJsonStringForTurn(turn, conversationId);
      } catch (error) {
        console.error("[threebox] failed to reconstruct turn scene JSON:", turn.id, error);
        chatPanel.updateAssistantMessage(
          textEl,
          t("threebox.app.replayFailed", "该轮场景重放失败：{error}", { error: error?.message || error })
        );
        continue;
      }
      if (turn.commands?.length) {
        chatPanel.appendToBody(textEl, chatPanel.buildDiffCollapse("commands", JSON.stringify(turn.commands, null, 2)));
      } else if (turn.patch) {
        chatPanel.appendToBody(textEl, chatPanel.buildDiffCollapse("patch", JSON.stringify(turn.patch, null, 2)));
      }
      chatPanel.appendToBody(textEl, chatPanel.buildJsonCollapse(sceneJsonString));
      const sceneCard = createThreeBoxSceneCard();
      chatPanel.appendToBody(textEl, sceneCard.el);
      await sceneCard.render(JSON.parse(sceneJsonString), { label: turn.userPrompt });
      sceneCardsByTurnId.set(turn.id, sceneCard);
      if (turn.recapSummary) {
        chatPanel.appendToBody(textEl, chatPanel.buildSummaryBlock(turn.recapSummary));
      }
    }
  }

  sidebar = createThreeBoxSidebar({
    onTemplateSearch: (query) => templateGallery.filter(query),
    openAiConfig: () => {
      settingsModal.open("ai");
      viewChrome.closeLeftDock();
    },
    openSettings: () => {
      settingsModal.open("general");
      viewChrome.closeLeftDock();
    },
    closeLeftDock: () => viewChrome.closeLeftDock(),
    onNewChat: () => {
      disposeAllSceneCards();
      attachedContext.clear();
      chatPanel.clear();
    },
    onSelectConversation: (conversationId) => {
      void switchToConversation(conversationId);
    }
  });
  await sidebar.init();
  await templateGallery.init();

  wireThreeBoxComposerStub({
    getVisionCapable,
    attachedContext,
    onResourceAdded: () => resourceLibrary.refresh()
  });
}

main();

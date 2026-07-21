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
  runThreeBoxGenerateSceneTitle,
  classifyThreeBoxTurnIntent,
  resolveAdjustContextPayload,
  isProviderVisionCapable,
  resolveTurnSceneJsonString,
  resolveThreeBoxAgentOptions
} from "./threeBoxOrchestrator.js";
import { ensureBuiltinApiKey, getDisplayDeviceId } from "./threeBoxBuiltinProvider.js";
import { createThreeBoxAttachedContext } from "./threeBoxAttachedContext.js";
import { wireThreeBoxComposerStub } from "./threeBoxComposerStub.js";
import { createThreeBoxResourceLibrary } from "./threeBoxResourceLibrary.js";
import {
  createUnsuccessfulTurnRecord,
  isSceneContextTurn,
  isUnsuccessfulTurn,
  resolveThreeBoxNegotiatedRoute
} from "./threeBoxTurnState.js";
import { buildStructuredTurnEnvelope, createThreeBoxTurnContext, projectSceneJsonString } from "threejson";
import { initHostI18n, applyShellI18n, getHostLocale, normalizeLocale, t } from "../../shared/i18n/index.js";
import {
  BUILTIN_PRIVACY_ACCEPTED,
  createBuiltinProviderPrivacyController,
  isBuiltinPrivacyAccepted
} from "../../shared/js/builtinProviderPrivacy.js";
import { getAiErrorFeedback } from "../../shared/js/aiErrorFeedback.js";

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

/** Human-readable language name for the AI scene-title prompt (see core/ai/sceneChatSession.js's
 * `responseLanguage`). Driven by settings.ai.sceneTitleLanguage: "auto" (the "默认" option) follows
 * the current UI locale exactly like `resolveSummaryResponseLanguage` above; "zh-CN"/"en-US" pin
 * the title to a specific language regardless of UI locale or what language the user typed. */
function resolveSceneTitleLanguage(settings) {
  const pref = settings?.ai?.sceneTitleLanguage || "auto";
  if (pref === "zh-CN") {
    return "Simplified Chinese";
  }
  if (pref === "en-US") {
    return "English";
  }
  return resolveSummaryResponseLanguage();
}

function populateComposerModelSelect(settings) {
  const select = document.getElementById("composerModelSelect");
  if (!select) {
    return;
  }
  const providers = (Array.isArray(settings?.ai?.providers) ? settings.ai.providers : [])
    .filter((provider) => provider.provider !== "threebox-builtin" || isBuiltinPrivacyAccepted("threebox"));
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
  const currentAiUserIdPromise = getDisplayDeviceId();
  // `createThreeBoxSettingsModal` reads persisted settings synchronously (no `.init()` needed to
  // call `.getSettings()`), so it's constructed first purely to read `general.locale` for the
  // locale bootstrap below — nothing about it renders yet.
  let builtinPrivacyController = null;
  const settingsModal = createThreeBoxSettingsModal({
    onSave: (settings) => {
      populateComposerModelSelect(settings);
      void applyHostLocaleFromSettings(settings);
      syncPreviewAuxiliaryLightsFromSettings(settings);
    },
    // `templateGallery` is declared with `const` further down in `main()` — same forward-reference
    // pattern as `applyHostLocaleFromSettings` above, safe because these only run in response to a
    // later button click, well after `templateGallery` has been assigned.
    onRebuildTemplateThumbnails: () => templateGallery?.rebuildThumbnailCache(),
    onClearTemplateThumbnails: () => templateGallery?.clearThumbnailCache(),
    onOpenBuiltinPrivacy: () => builtinPrivacyController?.open()
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

  builtinPrivacyController = createBuiltinProviderPrivacyController({
    scope: "threebox",
    onDecision: async (decision) => {
      populateComposerModelSelect(settingsModal.getSettings());
      if (decision === BUILTIN_PRIVACY_ACCEPTED) {
        await ensureBuiltinApiKey(settingsModal);
        populateComposerModelSelect(settingsModal.getSettings());
      }
    }
  });
  const viewChrome = createThreeBoxViewChrome();
  viewChrome.init();

  const attachedContext = createThreeBoxAttachedContext({
    sceneCardOptions: {
      shouldUsePreviewAuxiliaryLights: () =>
        settingsModal.getSettings()?.general?.previewAuxiliaryLights !== false
    }
  });
  const templateGallery = createThreeBoxTemplateGallery({
    onSelectTemplate: (item, payload) => attachedContext.setTemplate(item, payload)
  });
  const resourceLibrary = createThreeBoxResourceLibrary({ attachedContext });
  resourceLibrary.init();
  settingsModal.init();
  populateComposerModelSelect(settingsModal.getSettings());
  const builtinPrivacyDecision = await builtinPrivacyController.promptIfNeeded();
  if (builtinPrivacyDecision === BUILTIN_PRIVACY_ACCEPTED) {
    void ensureBuiltinApiKey(settingsModal);
  }

  let sidebar;
  // Each rendered scene card stays live in the DOM for the lifetime of the conversation (turns
  // are never disposed until "新聊天"/clear). History is immutable: an adjust turn always builds
  // its own private offscreen runtime (see threeBoxOrchestrator.js) and renders the result into a
  // brand-new scene card for the NEW turn — an earlier turn's card is never touched.
  const sceneCardsByTurnId = new Map();

  const createConfiguredSceneCard = () => createThreeBoxSceneCard({
    shouldShowMeshExportWarnings: () =>
      settingsModal.getSettings()?.io?.showMeshExportWarnings !== false,
    shouldUsePreviewAuxiliaryLights: () =>
      settingsModal.getSettings()?.general?.previewAuxiliaryLights !== false
  });

  function syncPreviewAuxiliaryLightsFromSettings(settings = settingsModal.getSettings()) {
    const enabled = settings?.general?.previewAuxiliaryLights !== false;
    attachedContext?.setPreviewAuxiliaryLightsEnabled?.(enabled);
    for (const sceneCard of sceneCardsByTurnId.values()) {
      sceneCard?.setPreviewAuxiliaryLightsEnabled?.(enabled);
    }
  }

  // Set for the duration of whatever generate/adjust turn is currently in flight (there is only
  // ever one live turn at a time — the composer's send button doubles as a stop button and Enter
  // is ignored while busy, see threeBoxChatPanel.js's setBusy). Cleared in a finally block by
  // whichever of handleGenerateTurn/handleAdjustTurn created it, so it's always null once the
  // composer is usable again.
  let activeAbortController = null;

  function getVisionCapable() {
    const settings = settingsModal.getSettings();
    const selectedProviderId = document.getElementById("composerModelSelect")?.value;
    return isProviderVisionCapable(resolveProviderOptions(settings, selectedProviderId));
  }

  async function resolveProviderOptionsForRequest(settings, providerId) {
    const options = resolveProviderOptions(settings, providerId);
    if (options?.provider === "deepseek") {
      options.userId = await currentAiUserIdPromise;
    }
    return options;
  }

  function stageResultLabel(stage) {
    if (stage === "commands") return t("threebox.app.stageCommands", "操作命令");
    if (stage === "json-incremental") return t("threebox.app.stageJsonPatch", "JSON Patch");
    return t("threebox.app.stageFullJson", "完整 JSON");
  }

  /** `fetch`'s rejection when an AbortController fires — used to tell "user clicked stop" apart
   * from a genuine failure so the two get different (and differently-worded) chat messages. */
  function isAbortError(error) {
    return error?.name === "AbortError";
  }

  function projectSceneForUser(sceneJsonString, settings = settingsModal.getSettings()) {
    const outputFormat = settings?.io?.sceneJsonFormat === "friendly" ? "friendly" : "standard";
    return projectSceneJsonString(sceneJsonString, outputFormat);
  }

  function friendlyAiErrorMessage(error) {
    return getAiErrorFeedback(error).message;
  }

  async function persistUnsuccessfulTurn({
    conversationId,
    turnId,
    userPrompt,
    mode,
    targetTurnId = null,
    error
  }) {
    const stopped = isAbortError(error);
    try {
      await putTurn(
        createUnsuccessfulTurnRecord({
          id: turnId,
          conversationId,
          userPrompt,
          mode,
          targetTurnId,
          stopped,
          errorMessage: friendlyAiErrorMessage(error),
          errorCode: error?.code || null
        })
      );
      sidebar.touchActiveConversation(userPrompt);
    } catch (cacheError) {
      console.error("[threebox] failed to persist unsuccessful turn:", cacheError);
    }
  }

  const RETRY_ICON =
    '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" d="M13 3.6v3.6h-3.6M3 12.4v-3.6h3.6"/><path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" d="M3.6 6.6A5.2 5.2 0 0 1 13 5.3M12.4 9.4A5.2 5.2 0 0 1 3 10.7"/></svg>';

  /** Builds the "重试"/"Retry" button appended below a failed or stopped turn's error text —
   * disables itself on click (a fresh retry attempt renders into its own new message, so the
   * stale button never needs to re-enable) and hands off to `onRetry`. */
  function buildRetryButton(onRetry) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chatRetryBtn";
    btn.innerHTML = `${RETRY_ICON}<span>${t("threebox.chat.retry", "重试")}</span>`;
    btn.addEventListener("click", () => {
      btn.disabled = true;
      void onRetry();
    });
    return btn;
  }

  /** Appended next to the retry button when a turn fails because the built-in trial provider's
   * quota ran out (error.code === "BUILTIN_QUOTA_EXCEEDED") — a small-print user has no idea
   * where "the settings" are, so this jumps straight to the AI section instead of making them
   * find it themselves. */
  function buildConfigureProviderButton() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chatRetryBtn";
    btn.textContent = t("threebox.chat.configureProvider", "点此配置供应商");
    btn.addEventListener("click", () => {
      settingsModal.open("ai");
    });
    return btn;
  }

  function appendRetryControls(api, textEl, error, onRetry) {
    api.appendToBody(textEl, buildRetryButton(onRetry));
    if (error?.code === "BUILTIN_QUOTA_EXCEEDED") {
      api.appendToBody(textEl, buildConfigureProviderButton());
    }
  }

  function createAgentProgressUpdater(streaming, onScenePreview) {
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
      if (
        typeof onScenePreview === "function" &&
        typeof progress.sceneJsonString === "string" &&
        (progress.kind === "stage_preview" || progress.kind === "scene_ready")
      ) {
        onScenePreview(progress.sceneJsonString, progress);
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

  function waitForStatusPaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
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

  async function handleGenerateTurn(text, api, {
    conversationId,
    turnId,
    turnContext = createThreeBoxTurnContext(turnId, text),
    generationStrategy = "single",
    estimatedSegments = 1,
    selectedCapabilityIds = [],
    requiresAnimation = false
  }) {
    const settings = settingsModal.getSettings();
    const selectedProviderId = document.getElementById("composerModelSelect")?.value;
    const providerOptions = {
      ...await resolveProviderOptionsForRequest(settings, selectedProviderId),
      threeBoxTurnContext: turnContext
    };

    const initialActivity = api.takeInitialActivity?.();
    const textEl = initialActivity?.textEl || api.appendAssistantMessage("");
    const streaming = initialActivity?.streaming || api.createStreamingBlock();
    if (!initialActivity) {
      api.appendToBody(textEl, streaming.el);
    }
    streaming.processing(t("threebox.chat.generating", "正在生成…"));
    let streamBuffer = "";
    const agentOptions = resolveThreeBoxAgentOptions(settings);
    const progressiveSceneCard = agentOptions.enabled ? createConfiguredSceneCard() : null;
    const sceneCard = progressiveSceneCard || createConfiguredSceneCard();
    let draftPreviewStarted = false;
    let draftPreviewPromise = null;
    let previewRenderQueue = Promise.resolve();
    let previewQueueOpen = true;
    let lastQueuedPreviewJson = "";
    if (progressiveSceneCard) {
      api.appendToBody(textEl, progressiveSceneCard.el);
    } else {
      // Mount the card before the final AI post-processing finishes. A validated draft can begin
      // deploying while capability review / final projection continues in the background.
      api.appendToBody(textEl, sceneCard.el);
    }
    const queueScenePreview = (sceneJsonString) => {
      if (!progressiveSceneCard || !sceneJsonString || sceneJsonString === lastQueuedPreviewJson) {
        return;
      }
      lastQueuedPreviewJson = sceneJsonString;
      previewRenderQueue = previewRenderQueue
        .catch((error) => {
          console.warn("[threebox] previous agent preview render failed:", error);
        })
        .then(() => {
          if (!previewQueueOpen) {
            return null;
          }
          return progressiveSceneCard.render(JSON.parse(sceneJsonString), { label: text });
        });
    };
    const updateAgentProgress = createAgentProgressUpdater(streaming, queueScenePreview);

    // Stop button: composerSendBtn doubles as stop while busy (threeBoxChatPanel.js's setBusy),
    // wired to abort this controller via onStopRequested. Cleared as soon as the cancelable
    // network call settles (success or failure) rather than held for the whole function — title/
    // recap/render afterward are fast and not worth blocking a new message on.
    const abortController = new AbortController();
    activeAbortController = abortController;
    chatPanel.setBusy(true);
    const clearBusyIfCurrent = () => {
      if (activeAbortController === abortController) {
        activeAbortController = null;
      }
      chatPanel.setBusy(false);
    };

    try {
      const { sceneJson, sceneJsonString, agentResult } = await runThreeBoxGenerateTurn({
        userPrompt: text,
        providerOptions,
        globalPromptPrefix: settings.ai?.globalPromptPrefix,
        onDelta: (delta) => {
          streamBuffer += delta;
          streaming.update(streamBuffer);
        },
        onGenerationPhase: async (phase) => {
          if (phase?.phase === "compact-retry") {
            streamBuffer = "";
            streaming.update("");
            if (typeof streaming.processing === "function") {
              streaming.processing(t("threebox.app.compactRetry", "输出过长，正在简化场景并重新生成…"));
            }
            await waitForStatusPaint();
          } else if (phase?.phase === "processing") {
            streaming.processing();
            await waitForStatusPaint();
          }
        },
        onSceneDraft: !agentOptions.enabled
          ? (draftJsonString) => {
              if (draftPreviewStarted || !draftJsonString) {
                return;
              }
              draftPreviewStarted = true;
              draftPreviewPromise = Promise.resolve()
                .then(() => sceneCard.render(JSON.parse(draftJsonString), { label: text }))
                .catch((error) => {
                  console.warn("[threebox] draft preview render failed:", error);
                  return null;
                });
            }
          : undefined,
        agentOptions,
        onAgentProgress: updateAgentProgress,
        includeReferenceLinks: settings.ai?.attachReferenceLinks !== false,
        locale: getHostLocale(),
        capabilityLookup: settings.ai?.capabilityLookupEnabled !== false,
        onlineTextureHints: settings.ai?.onlineTextureHints !== false,
        generationStrategy,
        estimatedSegments,
        maxSceneSegments: settings.ai?.maxSceneSegments,
        selectedCapabilityIds,
        requiresAnimation,
        signal: abortController.signal
      });
      clearBusyIfCurrent();

      const outputSceneJsonString = projectSceneForUser(sceneJsonString, settings);
      const outputSceneJson = JSON.parse(outputSceneJsonString);

      streaming.remove();
      const agentSummary = buildAgentProcessSummary(agentResult);
      if (agentSummary) {
        api.appendToBody(textEl, api.buildSummaryBlock(agentSummary));
      }
      api.appendToBody(textEl, api.buildJsonCollapse(outputSceneJsonString));

      // Title and recap are independent AI calls that both only need `digest`. Start them in
      // parallel, but never make the visible scene card wait for either network round-trip: the
      // user should see the canvas and its rendering mask as soon as the JSON is ready. The title
      // updates the card's download/export label whenever it arrives.
      const digest = buildResultDigest(sceneJson);
      const titlePromise =
        settings.ai?.autoGenerateSceneTitle !== false
          ? runThreeBoxGenerateSceneTitle({
              userPrompt: text,
              resultDigest: digest,
              providerOptions,
              responseLanguage: resolveSceneTitleLanguage(settings)
            }).catch(() => "")
          : Promise.resolve("");
      const recapPromise =
        settings.ai?.includeTurnSummary !== false
          ? runThreeBoxSummary({
              userPrompt: text,
              mode: "generate",
              turnId,
              resultDigest: digest,
              providerOptions,
              responseLanguage: resolveSummaryResponseLanguage(),
              selfName: settings.ai?.selfName || "ThreeBox"
            }).catch(() => "")
          : Promise.resolve("");

      if (draftPreviewPromise) {
        await draftPreviewPromise;
      }
      const resolvedTitlePromise = titlePromise.then((title) => {
        sceneCard.setLabel(title || text);
        return title;
      });
      if (progressiveSceneCard) {
        // A finished JSON result must not sit behind obsolete draft renders. Closing the queue
        // prevents previews that have not started yet from touching the card; render()'s sequence
        // guard supersedes the one preview that may already be in flight.
        previewQueueOpen = false;
        void previewRenderQueue.catch((error) => {
          console.warn("[threebox] superseded agent preview render failed:", error);
        });
        await sceneCard.render(outputSceneJson, { label: text });
      } else {
        await sceneCard.render(outputSceneJson, { label: text });
      }
      sceneCardsByTurnId.set(turnId, sceneCard);

      const sceneTitle = await resolvedTitlePromise;

      let recap = "";
      if (settings.ai?.includeTurnSummary !== false) {
        recap = (await recapPromise) || t("threebox.app.defaultGenerateRecap", "已根据您的描述生成场景。");
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
        sceneTitle,
        createdAt: Date.now()
      });
      sidebar.touchActiveConversation(text);
      api.finishTurnScroll();
    } catch (error) {
      clearBusyIfCurrent();
      streaming.remove();
      sceneCard?.dispose?.();
      sceneCard?.el.remove();
      await persistUnsuccessfulTurn({
        conversationId,
        turnId,
        userPrompt: text,
        mode: "generate",
        error
      });
      if (isAbortError(error)) {
        api.updateAssistantMessage(textEl, t("threebox.app.generateStopped", "已停止生成。"));
      } else {
        console.error("[threebox] generate turn failed:", error);
        api.updateAssistantError(textEl, error);
      }
      if (streamBuffer.trim()) {
        api.appendToBody(textEl, api.buildJsonCollapse(streamBuffer, { failed: true }));
      }
      appendRetryControls(api, textEl, error, () => handleGenerateTurn(text, api, {
        conversationId,
        turnId,
        turnContext,
        generationStrategy,
        estimatedSegments,
        selectedCapabilityIds,
        requiresAnimation
      }));
      api.finishTurnScroll();
    }
  }

  async function handleAdjustTurn(text, api, {
    conversationId,
    turnId,
    targetTurnId,
    turnContext = createThreeBoxTurnContext(turnId, text),
    selectedCapabilityIds = [],
    requiresAnimation = false
  }) {
    const settings = settingsModal.getSettings();
    const selectedProviderId = document.getElementById("composerModelSelect")?.value;
    const providerOptions = {
      ...await resolveProviderOptionsForRequest(settings, selectedProviderId),
      threeBoxTurnContext: turnContext
    };

    const targetTurn = await getTurn(targetTurnId);
    if (!targetTurn) {
      // Safe fallback: target turn vanished from cache (e.g. cleared) — treat as a fresh generate.
      return handleGenerateTurn(text, api, { conversationId, turnId, turnContext });
    }
    let targetSceneJsonString;
    try {
      targetSceneJsonString = await resolveSceneJsonStringForTurn(targetTurn, conversationId);
    } catch (error) {
      console.error("[threebox] failed to resolve target scene JSON:", error);
      return handleGenerateTurn(text, api, { conversationId, turnId, turnContext });
    }
    const targetSceneJson = JSON.parse(targetSceneJsonString);

    const initialActivity = api.takeInitialActivity?.();
    const textEl = initialActivity?.textEl || api.appendAssistantMessage("");
    const streaming = initialActivity?.streaming || api.createStreamingBlock();
    if (!initialActivity) {
      api.appendToBody(textEl, streaming.el);
    }
    streaming.processing(t("threebox.chat.adjusting", "正在调整…"));
    let streamBuffer = "";
    const agentOptions = resolveThreeBoxAgentOptions(settings);
    const updateAgentProgress = createAgentProgressUpdater(streaming);

    // See handleGenerateTurn's matching comment.
    const abortController = new AbortController();
    activeAbortController = abortController;
    chatPanel.setBusy(true);
    const clearBusyIfCurrent = () => {
      if (activeAbortController === abortController) {
        activeAbortController = null;
      }
      chatPanel.setBusy(false);
    };

    try {
      const contextPayload = resolveAdjustContextPayload(targetSceneJson, settings.ai);
      const envelope = buildStructuredTurnEnvelope({
        userPrompt: text,
        intent: "adjust",
        targetTurnId,
        contextPayload,
        globalPromptPrefix: settings.ai?.globalPromptPrefix,
        includeReferenceLinks: settings.ai?.attachReferenceLinks !== false,
        selectedCapabilityIds,
        requiresAnimation
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
        },
        locale: getHostLocale(),
        capabilityLookup: settings.ai?.capabilityLookupEnabled !== false,
        onlineTextureHints: settings.ai?.onlineTextureHints !== false,
        selectedCapabilityIds,
        animationCapabilities: requiresAnimation === true,
        signal: abortController.signal
      });
      clearBusyIfCurrent();

      const sceneJson = result.sceneJson;
      const sceneJsonString = result.sceneJsonString;
      const outputSceneJsonString = projectSceneForUser(sceneJsonString, settings);
      const outputSceneJson = JSON.parse(outputSceneJsonString);

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
      api.appendToBody(textEl, api.buildJsonCollapse(outputSceneJsonString));

      // Match handleGenerateTurn: title + recap start together, while the scene card is inserted
      // and rendered immediately. A later title response only updates the card label/file name.
      const digest = buildResultDigest(sceneJson);
      const titlePromise =
        settings.ai?.autoGenerateSceneTitle !== false
          ? runThreeBoxGenerateSceneTitle({
              userPrompt: text,
              resultDigest: digest,
              providerOptions,
              responseLanguage: resolveSceneTitleLanguage(settings),
              // Keeps adjustment titles consistent with the scene being adjusted (e.g.
              // "SolarSystem" -> "SolarSystem_Rev1_ImprovedTextures") instead of generating an
              // unrelated name each round — see generateSceneTitle's previousTitle doc.
              previousTitle: targetTurn.sceneTitle || targetTurn.userPrompt
            }).catch(() => "")
          : Promise.resolve("");
      const recapPromise =
        settings.ai?.includeTurnSummary !== false
          ? runThreeBoxSummary({
              userPrompt: text,
              mode: "adjust",
              targetTurnId,
              turnId,
              resultDigest: digest,
              providerOptions,
              responseLanguage: resolveSummaryResponseLanguage(),
              selfName: settings.ai?.selfName || "ThreeBox"
            }).catch(() => "")
          : Promise.resolve("");

      const sceneCard = createConfiguredSceneCard();
      api.appendToBody(textEl, sceneCard.el);
      const resolvedTitlePromise = titlePromise.then((title) => {
        sceneCard.setLabel(title || text);
        return title;
      });
      await sceneCard.render(outputSceneJson, { label: text });
      sceneCardsByTurnId.set(turnId, sceneCard);

      const sceneTitle = await resolvedTitlePromise;

      let recap = "";
      if (settings.ai?.includeTurnSummary !== false) {
        recap =
          (await recapPromise) ||
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
        sceneTitle,
        createdAt: Date.now()
      });
      sidebar.touchActiveConversation(text);
      api.finishTurnScroll();
    } catch (error) {
      clearBusyIfCurrent();
      streaming.remove();
      await persistUnsuccessfulTurn({
        conversationId,
        turnId,
        userPrompt: text,
        mode: "adjust",
        targetTurnId,
        error
      });
      if (isAbortError(error)) {
        api.updateAssistantMessage(textEl, t("threebox.app.adjustStopped", "已停止调整。"));
      } else {
        console.error("[threebox] adjust turn failed:", error);
        api.updateAssistantError(textEl, error);
      }
      if (streamBuffer.trim()) {
        api.appendToBody(textEl, api.buildJsonCollapse(streamBuffer, { failed: true }));
      }
      appendRetryControls(api, textEl, error, () => handleAdjustTurn(text, api, {
        conversationId,
        turnId,
        targetTurnId,
        turnContext,
        selectedCapabilityIds,
        requiresAnimation
      }));
      api.finishTurnScroll();
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
    const sceneCard = createConfiguredSceneCard();
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
      sceneTitle: attached.label,
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
      if (!api.finishInitialActivityError?.(error)) {
        const textEl = api.appendAssistantMessage("");
        api.updateAssistantError(textEl, error);
      }
      api.finishTurnScroll();
    }
  }

  async function handleUserMessageUnsafe(text, api) {
    let settings = settingsModal.getSettings();
    const selectedProviderId = document.getElementById("composerModelSelect")?.value;
    let providerOptions = await resolveProviderOptionsForRequest(settings, selectedProviderId);
    if (providerOptions?.provider === "threebox-builtin" && !isBuiltinPrivacyAccepted("threebox")) {
      providerOptions = null;
    }
    if (!providerOptions || !providerOptions.apiKey) {
      // The built-in provider's trial key is issued asynchronously at boot (main() fires
      // ensureBuiltinApiKey without awaiting it, so first paint isn't blocked on a network round
      // trip) — a user who sends a message within that window would otherwise see "no provider
      // configured" even though the built-in provider is about to become available. Give the
      // (deduplicated, see threeBoxBuiltinProvider.js) issuance a chance to finish before giving
      // up; for any other provider this just resolves immediately as a no-op.
      await ensureBuiltinApiKey(settingsModal);
      settings = settingsModal.getSettings();
      providerOptions = await resolveProviderOptionsForRequest(settings, selectedProviderId);
      if (providerOptions?.provider === "threebox-builtin" && !isBuiltinPrivacyAccepted("threebox")) {
        providerOptions = null;
      }
    }
    if (!providerOptions || !providerOptions.apiKey) {
      const message = t(
        "threebox.app.noProviderConfigured",
        "尚未配置可用的 AI 供应商。请点击左侧「AI 配置」，添加一个供应商并填写 API Key 后再试。"
      );
      if (!api.finishInitialActivity?.(message)) {
        api.appendAssistantMessage(message);
      }
      api.finishTurnScroll();
      return;
    }

    let seed;
    try {
      seed = await consumeAttachedContextAsSeedTurn(api);
    } catch (error) {
      console.error("[threebox] consumeAttachedContextAsSeedTurn failed:", error);
      const message = t("threebox.app.loadAttachedFailed", "加载已附加的场景失败：{error}", { error: error?.message || error });
      if (!api.finishInitialActivity?.(message)) {
        api.appendAssistantMessage(message);
      }
      api.finishTurnScroll();
      return;
    }
    if (seed) {
      const turnId = createTurnId();
      const turnContext = createThreeBoxTurnContext(turnId, text);
      await handleAdjustTurn(text, api, {
        conversationId: seed.conversationId,
        turnId,
        targetTurnId: seed.seedTurnId,
        turnContext
      });
      return;
    }

    const conversationId = sidebar.ensureActiveConversation().id;
    const turnId = createTurnId();
    const turnContext = createThreeBoxTurnContext(turnId, text);
    const allPriorTurns = await getTurnsForConversation(conversationId).catch(() => []);
    const priorTurns = allPriorTurns.filter(isSceneContextTurn);

    // A conversation with no scene context can only be a new generation. Avoid spending a full
    // provider round-trip on intent negotiation in this unambiguous case; follow-up turns retain
    // the classifier so generate-vs-adjust routing remains conservative.
    if (priorTurns.length === 0) {
      await handleGenerateTurn(text, api, {
        conversationId,
        turnId,
        turnContext,
        generationStrategy: "single",
        estimatedSegments: 1,
        selectedCapabilityIds: [],
        requiresAnimation: settings.ai?.animationCapabilityMode === "on"
      });
      return;
    }

    const history = priorTurns.map((t) => ({
      turnId: t.id,
      summary: t.recapSummary || t.userPrompt,
      userPrompt: t.userPrompt,
      mode: t.mode,
      targetTurnId: t.targetTurnId,
      sceneTitle: t.sceneTitle
    }));
    const classified = await classifyThreeBoxTurnIntent(
      { userPrompt: text, history },
      {
        ...providerOptions,
        threeBoxTurnContext: turnContext,
        animationCapabilityMode: settings.ai?.animationCapabilityMode || "auto"
      }
    );
    const route = resolveThreeBoxNegotiatedRoute(classified, priorTurns);
    if (route.intent === "adjust") {
      await handleAdjustTurn(text, api, {
        conversationId,
        turnId,
        targetTurnId: route.targetTurnId,
        turnContext,
        selectedCapabilityIds: classified.selectedCapabilityIds,
        requiresAnimation: classified.requiresAnimation
      });
    } else {
      await handleGenerateTurn(text, api, {
        conversationId,
        turnId,
        turnContext,
        generationStrategy: classified.generationStrategy,
        estimatedSegments: classified.estimatedSegments,
        selectedCapabilityIds: classified.selectedCapabilityIds,
        requiresAnimation: classified.requiresAnimation
      });
    }
  }

  const chatPanel = createThreeBoxChatPanel({
    onUserMessage: handleUserMessage,
    onStopRequested: () => activeAbortController?.abort(),
    getJsonViewerOptions: () => {
      const io = settingsModal.getSettings()?.io || {};
      return {
        lineNumbers: io.jsonViewerLineNumbers !== false,
        highlight: io.jsonViewerHighlight !== false
      };
    }
  });
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
      if (isUnsuccessfulTurn(turn)) {
        if (turn.status === "stopped") {
          chatPanel.updateAssistantMessage(
            textEl,
            turn.mode === "adjust"
              ? t("threebox.app.adjustStopped", "已停止调整。")
              : t("threebox.app.generateStopped", "已停止生成。")
          );
        } else {
          const errorMessage = turn.errorMessage || t("threebox.app.unknownError", "未知错误");
          chatPanel.updateAssistantMessage(
            textEl,
            turn.mode === "adjust"
              ? t("threebox.app.adjustFailed", "调整失败：{error}", { error: errorMessage })
              : t("threebox.app.generateFailed", "生成失败：{error}", { error: errorMessage })
          );
        }
        appendRetryControls(chatPanel, textEl, { code: turn.errorCode || null }, () =>
          turn.mode === "adjust" && turn.targetTurnId
            ? handleAdjustTurn(turn.userPrompt, chatPanel, {
                conversationId,
                turnId: turn.id,
                targetTurnId: turn.targetTurnId
              })
            : handleGenerateTurn(turn.userPrompt, chatPanel, {
                conversationId,
                turnId: turn.id
              })
        );
        continue;
      }
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
      const outputSceneJsonString = projectSceneForUser(sceneJsonString);
      chatPanel.appendToBody(textEl, chatPanel.buildJsonCollapse(outputSceneJsonString));
      const sceneCard = createConfiguredSceneCard();
      chatPanel.appendToBody(textEl, sceneCard.el);
      await sceneCard.render(JSON.parse(outputSceneJsonString), { label: turn.sceneTitle || turn.userPrompt });
      sceneCardsByTurnId.set(turn.id, sceneCard);
      if (turn.recapSummary) {
        chatPanel.appendToBody(textEl, chatPanel.buildSummaryBlock(turn.recapSummary));
      }
    }
    // Replaying history re-triggers appendMessage("user", ...)'s "pin near top" scroll for every
    // historical turn in turn — without this, the view would end up pinned near the top of the
    // LAST historical turn (mostly blank below it) instead of landing on the true end of the
    // conversation, which is what opening a past conversation should do.
    chatPanel.finishTurnScroll();
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
    },
    onDeleteConversation: (_conversation, { wasActive }) => {
      if (!wasActive) {
        return;
      }
      activeAbortController?.abort();
      activeAbortController = null;
      chatPanel.setBusy(false);
      disposeAllSceneCards();
      attachedContext.clear();
      chatPanel.clear();
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

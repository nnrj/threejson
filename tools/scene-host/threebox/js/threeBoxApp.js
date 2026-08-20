import { createThreeBoxViewChrome } from "./threeBoxViewChrome.js";
import { createThreeBoxSidebar } from "./threeBoxSidebar.js";
import { createThreeBoxTemplateGallery } from "./threeBoxTemplateGallery.js";
import { createThreeBoxSettingsModal } from "./threeBoxSettingsModal.js";
import { createThreeBoxChatPanel } from "./threeBoxChatPanel.js";
import { createThreeBoxSceneCard } from "./threeBoxSceneCard.js";
import { putTurn as putTurnRaw, getTurn, getTurnsForConversation, getAllConversations, createTurnId } from "./threeBoxSessionStore.js";
import { createThreeBoxSelfHostedSync } from "./threeBoxSelfHostedSync.js";
import { createThreeBoxCloudMigration } from "./threeBoxCloudMigration.js";
import { createThreeBoxBuiltinNotifications } from "./threeBoxBuiltinNotifications.js";
import { requestBuiltinNotificationConsent } from "./threeBoxBuiltinNotificationConsentDialog.js";
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
  resolveThreeBoxAgentOptions,
  resolveThreeBoxSceneTokenOptions
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
import { buildStructuredTurnEnvelope, createThreeBoxTurnContext, projectSceneJsonString } from "threejson/ai";
import { initHostI18n, applyShellI18n, getHostLocale, normalizeLocale, t } from "../../shared/i18n/index.js";
import {
  BUILTIN_PRIVACY_ACCEPTED,
  createBuiltinProviderPrivacyController,
  isBuiltinPrivacyAccepted
} from "../../shared/js/builtinProviderPrivacy.js";
import { getAiErrorFeedback } from "../../shared/js/aiErrorFeedback.js";
import { probeEndpoint } from "../../shared/js/endpointProbe.js";
import { formatAgentProgressLabel } from "../../shared/js/aiAgentProgressLabels.js";
import {
  findChangedTextureObjectIds,
  runHostSceneTexturePipeline
} from "../../shared/js/sceneTextureOrchestrator.js";
import { createTextureProxyUrl } from "../../shared/js/textureProviderClient.js";
import { getCachedTextureBlob, putCachedTextureBlob } from "../../shared/js/browserTextureCache.js";

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
  let selfHostedSync = null;
  let builtinNotifications = null;
  const putTurn = async (turn) => {
    const stored = await putTurnRaw(turn);
    selfHostedSync?.scheduleSync();
    return stored;
  };
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
      builtinNotifications?.start();
    },
    // `templateGallery` is declared with `const` further down in `main()` — same forward-reference
    // pattern as `applyHostLocaleFromSettings` above, safe because these only run in response to a
    // later button click, well after `templateGallery` has been assigned.
    onRebuildTemplateThumbnails: () => templateGallery?.rebuildThumbnailCache(),
    onClearTemplateThumbnails: () => templateGallery?.clearThumbnailCache(),
    onOpenBuiltinPrivacy: () => builtinPrivacyController?.open(),
    onTestEndpoint: (kind, value) => kind === "selfHostedSync"
      ? selfHostedSync?.syncNow()
      : probeEndpoint(value, "/health")
  });
  selfHostedSync = createThreeBoxSelfHostedSync(() => settingsModal.getSettings());
  builtinNotifications = createThreeBoxBuiltinNotifications(() => settingsModal.getSettings());
  if (!settingsModal.getSettings()?.general?.assetGatewayUrl && settingsModal.getSettings()?.ai?.providers?.some((provider) => provider.provider === "threebox-builtin" && provider.enabled !== false)) {
    settingsModal.updateSettings((next) => {
      next.general = { ...(next.general || {}), assetGatewayUrl: next.ai?.builtinBackendUrl || "https://api.threebox.org" };
    }, { notify: false, toast: false, closeModal: false });
  }
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
        builtinNotifications?.refresh();
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
    void ensureBuiltinApiKey(settingsModal).then(() => builtinNotifications?.refresh());
  }
  if (builtinPrivacyDecision === BUILTIN_PRIVACY_ACCEPTED && !settingsModal.getSettings()?.general?.builtinNotificationsDecisionMade) {
    const enabled = await requestBuiltinNotificationConsent();
    settingsModal.updateSettings((next) => {
      next.general.builtinNotificationsEnabled = enabled;
      next.general.builtinNotificationsDecisionMade = true;
    }, { toast: false, closeModal: false });
  }
  builtinNotifications.start();

  let sidebar;
  // Each rendered scene card stays live in the DOM for the lifetime of the conversation (turns
  // are never disposed until "新聊天"/clear). History is immutable: an adjust turn owns the
  // brand-new scene card created for that turn and never mutates an earlier turn's card. The new
  // card's runtime is also the authoritative adjustment runtime, so preview and persisted JSON
  // stay in sync without a second hidden scene.
  const sceneCardsByTurnId = new Map();

  const createConfiguredSceneCard = () => createThreeBoxSceneCard({
    shouldShowMeshExportWarnings: () =>
      settingsModal.getSettings()?.io?.showMeshExportWarnings !== false,
    shouldUsePreviewAuxiliaryLights: () =>
      settingsModal.getSettings()?.general?.previewAuxiliaryLights !== false,
    assetGateway: () => {
      const settings = settingsModal.getSettings();
      const baseUrl = settings?.general?.assetGatewayUrl?.trim();
      if (!baseUrl) {
        return null;
      }
      // The gateway may be configured to require an API key (see threebox-server's asset-gateway
      // admin setting); proxied URLs are loaded as plain <img>/texture `src` GETs with no
      // Authorization header, so the key has to travel as a query param instead (see
      // core/util/assetGateway.js). Only attach it when the gateway is the same built-in backend
      // the key was issued for — never send our trial key to an arbitrary self-hosted gateway URL.
      const builtinBackendUrl = String(settings?.ai?.builtinBackendUrl || "").replace(/\/$/, "");
      const isBuiltinGateway = builtinBackendUrl && baseUrl.replace(/\/$/, "") === builtinBackendUrl;
      const apiKey = isBuiltinGateway
        ? settings?.ai?.providers?.find((provider) => provider.provider === "threebox-builtin")?.apiKey
        : "";
      return apiKey ? { baseUrl, apiKey } : { baseUrl };
    },
    archiveOptions: () => {
      const settings = settingsModal.getSettings();
      const assetPolicy = settings?.io?.tjzAssetPolicy === "tryPack" ? "tryPack" : "preserve";
      if (assetPolicy !== "tryPack") return { assetPolicy };
      const service = resolveTextureServiceSettings(settings);
      return {
        assetPolicy,
        fetchExternalUrls: false,
        resolveAsset: async (sourceUrl) => {
          const cached = await getCachedTextureBlob(sourceUrl);
          if (cached) return cached;
          if (!/^https?:\/\//i.test(String(sourceUrl || ""))) return null;
          const runtimeUrl = createTextureProxyUrl(service.baseUrl, service.apiKey, sourceUrl);
          try {
            const response = await fetch(runtimeUrl);
            if (!response.ok) return null;
            const blob = await response.blob();
            if (!blob.size) return null;
            await putCachedTextureBlob(sourceUrl, blob, { source: "tjz-export" });
            return blob;
          } catch {
            return null;
          }
        }
      };
    }
  });

  function resolveTextureServiceSettings(settings = settingsModal.getSettings()) {
    const customUrl = String(settings?.ai?.textureServiceUrl || "").trim();
    const customKey = String(settings?.ai?.textureServiceApiKey || "").trim();
    const builtin = settings?.ai?.providers?.find((provider) => provider.provider === "threebox-builtin");
    const mayUseBuiltin = isBuiltinPrivacyAccepted("threebox");
    return {
      baseUrl: customUrl || (mayUseBuiltin ? String(settings?.ai?.builtinBackendUrl || "").trim() : ""),
      apiKey: customKey || (mayUseBuiltin ? String(builtin?.apiKey || "").trim() : "")
    };
  }

  const textureJobsByTurnId = new Map();
  const turnMutationQueues = new Map();

  function updateStoredTurn(turnId, updater) {
    const previous = turnMutationQueues.get(turnId) || Promise.resolve();
    const mutation = previous.catch(() => {}).then(async () => {
      const current = await getTurn(turnId);
      if (!current) return null;
      const updated = updater(current);
      if (!updated) return current;
      return putTurn(updated);
    });
    const tracked = mutation.finally(() => {
      if (turnMutationQueues.get(turnId) === tracked) turnMutationQueues.delete(turnId);
    });
    turnMutationQueues.set(turnId, tracked);
    return tracked;
  }

  function abortTextureJob(turnId) {
    const job = textureJobsByTurnId.get(turnId);
    job?.abort();
    textureJobsByTurnId.delete(turnId);
  }

  function startTurnTexturePipeline({
    turnId,
    prompt,
    scene,
    sceneCard,
    providerOptions,
    changedObjectIds,
    onSceneUpdated
  }) {
    const settings = settingsModal.getSettings();
    if (settings?.ai?.texturePipelineEnabled === false || !sceneCard?.getRuntime?.()) return;
    abortTextureJob(turnId);
    const controller = new AbortController();
    textureJobsByTurnId.set(turnId, controller);
    const revision = Symbol(turnId);
    void runHostSceneTexturePipeline({
      scene,
      runtime: sceneCard.getRuntime(),
      prompt,
      aiProviderOptions: providerOptions,
      textureService: resolveTextureServiceSettings(settings),
      enabled: true,
      strategy: settings.ai?.textureStrategy || "semantic-hybrid",
      pbr: settings.ai?.texturePbr !== false,
      allowUnknownLicense: settings.ai?.textureAllowUnknownLicense === true,
      persistenceMode: settings.ai?.texturePersistenceMode || "remote",
      cache: settings.ai?.textureLocalCache !== false,
      changedObjectIds,
      signal: controller.signal,
      revision,
      isCurrent: (candidate) => candidate === revision && textureJobsByTurnId.get(turnId) === controller,
      onProgress: (event) => sceneCard.setTextureProgress(event),
      onAssignment: async (_assignment, updatedScene) => {
        if (textureJobsByTurnId.get(turnId) !== controller) return;
        const sceneJson = JSON.stringify(updatedScene, null, 2);
        sceneCard.updateSceneJson(updatedScene);
        onSceneUpdated?.(updatedScene);
        await updateStoredTurn(turnId, (turn) => {
          if (textureJobsByTurnId.get(turnId) !== controller) return null;
          return { ...turn, sceneJson };
        });
      }
    }).catch((error) => {
      if (!isAbortError(error)) console.warn("[threebox] texture pipeline failed:", error);
    }).finally(() => {
      if (textureJobsByTurnId.get(turnId) === controller) textureJobsByTurnId.delete(turnId);
    });
  }

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
      // core/ai/sceneAgent.js's progress messages are plain English (core/ai has no i18n
      // dependency of its own) — always run `kind` through the shared localized-label mapping
      // rather than showing progress.message directly, or a Chinese-locale host shows raw English
      // status lines (see aiAgentProgressLabels.js).
      const label = formatAgentProgressLabel(progress, t);
      if (!label) {
        return;
      }
      // Keep the original compact spinning activity UI. update() clears its processing class, so
      // using it for a growing numbered debug log unnecessarily removed the polished wait state.
      streaming.processing(label);
    };
  }

  /** Keeps raw model output readable when one turn changes authoring stages. SceneAgent attaches a
   * stable streamId to every JSON/command/Patch request; a new id replaces the previous stage
   * instead of concatenating unrelated response formats into one invalid blob. */
  function createOutputStreamController(streaming) {
    let text = "";
    let activeStreamId = "";
    return {
      onDelta(delta, metadata = {}) {
        const streamId = String(metadata?.streamId || "");
        if (metadata?.reset === true || (streamId && streamId !== activeStreamId)) {
          text = "";
        }
        if (streamId) {
          activeStreamId = streamId;
        }
        text += String(delta || "");
        streaming.update(text);
      },
      reset() {
        text = "";
        activeStreamId = "";
      },
      getText() {
        return text;
      }
    };
  }

  function buildAgentProcessSummary(agentResult) {
    if (!agentResult?.agentUsed || !Array.isArray(agentResult.steps)) {
      return "";
    }
    const noteworthy =
      agentResult.completed === false ||
      agentResult.steps.some((step) =>
        step.ok === false ||
        /(?:repair|fallback|budget)/i.test(String(step.kind || "")) ||
        (step.kind === "capability_review" && step.attempt)
      );
    // Routine successful execution is product behavior, not a user-facing debug transcript.
    if (!noteworthy) {
      return "";
    }
    const lines = agentResult.steps.slice(0, 10).map((step, index) => {
      const kind = step.kind || "step";
      const state = step.ok === false ? "failed" : "ok";
      const extra = step.error ? `: ${step.error}` : step.count != null ? ` (${step.count})` : "";
      return `${index + 1}. ${kind} - ${state}${extra}`;
    });
    if (agentResult.completed === false && agentResult.stopReason === "budget_exhausted") {
      lines.unshift(t(
        "threebox.agent.refineBudgetExhausted",
        "已达到自动细化轮数上限；当前场景可用，但 AI 未明确确认已经完善完成。"
      ));
    }
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
    executionMode = "direct",
    refinementGoals = [],
    turnDeadlineAt = Date.now() + 180000,
    abortController: providedAbortController,
    estimatedSegments = 1,
    estimatedOutputTokens,
    selectedCapabilityIds,
    requiresAnimation
  }) {
    const settings = settingsModal.getSettings();
    const selectedProviderId = document.getElementById("composerModelSelect")?.value;
    const providerOptions = {
      ...await resolveProviderOptionsForRequest(settings, selectedProviderId),
      threeBoxTurnContext: turnContext,
      turnDeadlineAt
    };

    const initialActivity = api.takeInitialActivity?.();
    const textEl = initialActivity?.textEl || api.appendAssistantMessage("");
    const streaming = initialActivity?.streaming || api.createStreamingBlock();
    if (!initialActivity) {
      api.appendToBody(textEl, streaming.el);
    }
    streaming.processing(t("threebox.chat.generating", "正在生成…"));
    const outputStream = createOutputStreamController(streaming);
    const agentOptions = resolveThreeBoxAgentOptions(settings);
    // One card serves both policies: direct generation paints one usable preview; genuinely
    // complex generation keeps that runtime and applies command refinements in place.
    const sceneCard = createConfiguredSceneCard();
    let draftPreviewStarted = false;
    let draftPreviewPromise = null;
    let previewRenderQueue = Promise.resolve();
    let previewQueueOpen = true;
    let lastQueuedPreviewJson = "";
    api.appendToBody(textEl, sceneCard.el);
    const queueScenePreview = (sceneJsonString, progress = {}) => {
      if (!sceneJsonString || sceneJsonString === lastQueuedPreviewJson) {
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
          const sceneJson = JSON.parse(sceneJsonString);
          if (
            progress.outputMode === "commands" &&
            Array.isArray(progress.commands) &&
            progress.commands.length > 0 &&
            sceneCard.getRuntime()
          ) {
            return sceneCard.applyCommands(progress.commands, {
              sceneJson,
              label: text,
              draft: true
            });
          }
          return sceneCard.render(sceneJson, {
            label: text,
            draft: progress.stage !== "direct_scene"
          });
        });
    };
    const updateAgentProgress = createAgentProgressUpdater(streaming, queueScenePreview);

    // Stop button: composerSendBtn doubles as stop while busy (threeBoxChatPanel.js's setBusy),
    // wired to abort this controller via onStopRequested. Cleared as soon as the cancelable
    // network call settles (success or failure) rather than held for the whole function — title/
    // recap/render afterward are fast and not worth blocking a new message on.
    const abortController = providedAbortController || new AbortController();
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
        onDelta: outputStream.onDelta,
        onGenerationPhase: async (phase) => {
          if (phase?.phase === "compact-retry" || phase?.phase === "segmented-recovery") {
            outputStream.reset();
            streaming.update("");
            if (typeof streaming.processing === "function") {
              streaming.processing(phase?.phase === "segmented-recovery"
                ? t("threebox.app.segmentedRecovery", "本段输出已满，正在继续生成完整场景…")
                : t("threebox.app.compactRetry", "输出过长，正在简化场景并重新生成…"));
            }
            await waitForStatusPaint();
          } else if (phase?.phase === "processing") {
            streaming.processing();
            await waitForStatusPaint();
          } else if (phase?.phase === "capability-review") {
            // Fires after the draft (onSceneDraft below) is already on the canvas — a second,
            // un-streamed round trip that can take as long as the original generation. Without
            // this the composer just sits on a stale "正在生成…" with no visible activity; see
            // core/ai/sceneAiService.js's maybeApplyCapabilityReview.
            if (typeof streaming.processing === "function") {
              streaming.processing(t("threebox.app.capabilityReview", "正在校验场景是否充分使用相关能力…"));
            }
            await waitForStatusPaint();
          }
        },
        onSceneDraft: (draftJsonString) => {
          if (draftPreviewStarted || !draftJsonString) {
            return;
          }
          draftPreviewStarted = true;
          draftPreviewPromise = Promise.resolve()
            .then(() => sceneCard.render(JSON.parse(draftJsonString), { label: text, draft: true }))
            .catch((error) => {
              console.warn("[threebox] draft preview render failed:", error);
              return null;
            });
        },
        agentOptions,
        onAgentProgress: updateAgentProgress,
        includeReferenceLinks: settings.ai?.attachReferenceLinks !== false,
        locale: getHostLocale(),
        capabilityLookup: settings.ai?.capabilityLookupEnabled !== false,
        generationStrategy,
        executionMode,
        refinementGoals,
        estimatedSegments,
        estimatedOutputTokens,
        maxSceneSegments: settings.ai?.maxSceneSegments,
        ...resolveThreeBoxSceneTokenOptions(settings),
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
      const jsonCollapse = api.buildJsonCollapse(outputSceneJsonString);
      api.insertBeforeBody(textEl, jsonCollapse, sceneCard.el);

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
      // A finished result must not sit behind obsolete draft renders. Closing the queue prevents
      // previews that have not started yet from touching the card; render()'s sequence guard
      // supersedes the one preview that may already be in flight. `draft` unset (not true) clears
      // the "still refining" badge — the turn is genuinely done now.
      previewQueueOpen = false;
      void previewRenderQueue.catch((error) => {
        console.warn("[threebox] superseded agent preview render failed:", error);
      });
      await sceneCard.finalize(outputSceneJson, { label: text });
      sceneCardsByTurnId.set(turnId, sceneCard);

      // Texture assignments must target the same descriptor shape that the card rendered and
      // later exports. In friendly-output mode this intentionally differs from the Agent's
      // canonical standard scene object.
      const textureScene = outputSceneJson;

      // Persist and expose the usable scene before waiting on optional title/recap calls. Texture
      // enrichment can now start immediately; all later snapshot writes share one mutation queue
      // so metadata and texture assignments cannot overwrite one another.
      await putTurn({
        id: turnId,
        conversationId,
        seq: Date.now(),
        userPrompt: text,
        mode: "generate",
        targetTurnId: null,
        stage: "generate",
        sceneJson: outputSceneJsonString,
        commands: null,
        spatialSummary: "",
        recapSummary: "",
        sceneTitle: "",
        createdAt: Date.now()
      });
      startTurnTexturePipeline({
        turnId,
        prompt: text,
        scene: textureScene,
        sceneCard,
        providerOptions,
        onSceneUpdated: (updatedScene) => {
          jsonCollapse.updateJson?.(JSON.stringify(updatedScene, null, 2));
        }
      });

      const sceneTitle = await resolvedTitlePromise;

      let recap = "";
      if (settings.ai?.includeTurnSummary !== false) {
        recap = (await recapPromise) || t("threebox.app.defaultGenerateRecap", "已根据您的描述生成场景。");
        api.appendToBody(textEl, api.buildSummaryBlock(recap));
      }

      await updateStoredTurn(turnId, (turn) => ({
        ...turn,
        recapSummary: recap,
        sceneTitle
      }));
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
      const failedOutput = outputStream.getText();
      if (failedOutput.trim()) {
        api.appendToBody(textEl, api.buildJsonCollapse(failedOutput, { failed: true }));
      }
      appendRetryControls(api, textEl, error, () => handleGenerateTurn(text, api, {
        conversationId,
        turnId,
        turnContext,
        generationStrategy,
        executionMode,
        refinementGoals,
        estimatedSegments,
        estimatedOutputTokens,
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
    turnDeadlineAt = Date.now() + 180000,
    abortController: providedAbortController,
    selectedCapabilityIds,
    requiresAnimation,
    generationStrategy = "single",
    estimatedSegments = 1
  }) {
    const settings = settingsModal.getSettings();
    const selectedProviderId = document.getElementById("composerModelSelect")?.value;
    const providerOptions = {
      ...await resolveProviderOptionsForRequest(settings, selectedProviderId),
      threeBoxTurnContext: turnContext,
      turnDeadlineAt
    };

    const targetTurn = await getTurn(targetTurnId);
    if (!targetTurn) {
      // Safe fallback: target turn vanished from cache (e.g. cleared) — treat as a fresh generate.
      return handleGenerateTurn(text, api, {
        conversationId,
        turnId,
        turnContext,
        turnDeadlineAt,
        abortController: providedAbortController
      });
    }
    let targetSceneJsonString;
    try {
      targetSceneJsonString = await resolveSceneJsonStringForTurn(targetTurn, conversationId);
    } catch (error) {
      console.error("[threebox] failed to resolve target scene JSON:", error);
      return handleGenerateTurn(text, api, {
        conversationId,
        turnId,
        turnContext,
        turnDeadlineAt,
        abortController: providedAbortController
      });
    }
    const targetSceneJson = JSON.parse(targetSceneJsonString);
    abortTextureJob(targetTurnId);

    const initialActivity = api.takeInitialActivity?.();
    const textEl = initialActivity?.textEl || api.appendAssistantMessage("");
    const streaming = initialActivity?.streaming || api.createStreamingBlock();
    if (!initialActivity) {
      api.appendToBody(textEl, streaming.el);
    }
    streaming.processing(t("threebox.chat.adjusting", "正在调整…"));
    const outputStream = createOutputStreamController(streaming);
    const agentOptions = resolveThreeBoxAgentOptions(settings);
    const sceneCard = createConfiguredSceneCard();
    let previewRenderQueue = Promise.resolve();
    let previewQueueOpen = true;
    let lastQueuedPreviewJson = "";
    const adjustmentUsesSceneCardRuntime = true;
    api.appendToBody(textEl, sceneCard.el);
    const queueScenePreview = (sceneJsonString, progress = {}) => {
      if (!sceneJsonString || sceneJsonString === lastQueuedPreviewJson) {
        return;
      }
      lastQueuedPreviewJson = sceneJsonString;
      previewRenderQueue = previewRenderQueue
        .catch((error) => {
          console.warn("[threebox] previous adjustment preview render failed:", error);
        })
        .then(() => {
          if (!previewQueueOpen) {
            return null;
          }
          const sceneJson = JSON.parse(sceneJsonString);
          if (
            progress.outputMode === "commands" &&
            Array.isArray(progress.commands) &&
            progress.commands.length > 0 &&
            sceneCard.getRuntime()
          ) {
            // The shared adjuster already applied this batch through the live scene-card callback
            // below. Replaying the progress event would execute every mutation twice.
            if (adjustmentUsesSceneCardRuntime) {
              return null;
            }
            return sceneCard.applyCommands(progress.commands, {
              sceneJson,
              label: text,
              draft: true
            });
          }
          return sceneCard.render(sceneJson, {
            label: text,
            draft: true,
            authoritative: adjustmentUsesSceneCardRuntime
          });
        });
      return previewRenderQueue;
    };
    const initialScenePreviewPromise = queueScenePreview(targetSceneJsonString);
    const updateAgentProgress = createAgentProgressUpdater(streaming, queueScenePreview);

    // See handleGenerateTurn's matching comment.
    const abortController = providedAbortController || new AbortController();
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
        onDelta: outputStream.onDelta,
        locale: getHostLocale(),
        capabilityLookup: settings.ai?.capabilityLookupEnabled !== false,
        selectedCapabilityIds,
        animationCapabilities: requiresAnimation === true,
        // Transport metadata remains useful for full-JSON fallbacks, but ordinary adjustment is
        // always iterative and stops as soon as the model returns # done.
        generationStrategy,
        estimatedSegments,
        ...resolveThreeBoxSceneTokenOptions(settings),
        // The visible card is already loading this exact scene while the provider thinks. Reuse
        // it as the authoritative command runtime instead of constructing a second hidden scene.
        applyCommands: async (commands, meta = {}) => {
          await initialScenePreviewPromise;
          return sceneCard.applyCommandsWithResult(commands, {
            label: text,
            draft: true,
            readOnly: meta.readOnly === true
          });
        },
        refreshContext: async () => {
          await initialScenePreviewPromise;
          const currentSceneJsonString = await sceneCard.exportSceneJsonString({
            label: text,
            draft: true
          });
          if (!currentSceneJsonString) {
            throw new Error("ThreeBox adjustment scene runtime is not ready.");
          }
          const currentSceneJson = JSON.parse(currentSceneJsonString);
          return {
            ...resolveAdjustContextPayload(currentSceneJson, settings.ai),
            currentSceneJsonString
          };
        },
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
        api.insertBeforeBody(textEl, api.buildSummaryBlock(agentSummary), sceneCard.el);
      }
      // Show what the AI actually produced (commands / JSON Patch) above the merged final JSON,
      // so the user can see the diff the model generated instead of only the end result.
      if (result.stage === "commands" && result.commands?.length) {
        api.insertBeforeBody(textEl, api.buildDiffCollapse("commands", JSON.stringify(result.commands, null, 2)), sceneCard.el);
      } else if (result.stage === "json-incremental" && result.patch) {
        api.insertBeforeBody(textEl, api.buildDiffCollapse("patch", JSON.stringify(result.patch, null, 2)), sceneCard.el);
      }
      const jsonCollapse = api.buildJsonCollapse(outputSceneJsonString);
      api.insertBeforeBody(textEl, jsonCollapse, sceneCard.el);

      // Preserve the target title. An adjustment must not spend two extra model calls inventing a
      // title and a prose recap from an object-count digest; that recap could claim a property
      // changed even when the runtime exported an unchanged scene.
      const sceneTitle = targetTurn.sceneTitle || targetTurn.userPrompt || text;
      sceneCard.setLabel(sceneTitle);
      previewQueueOpen = false;
      void previewRenderQueue.catch((error) => {
        console.warn("[threebox] superseded adjustment preview render failed:", error);
      });
      await sceneCard.finalize(outputSceneJson, { label: text });
      sceneCardsByTurnId.set(turnId, sceneCard);

      // Keep the texture document aligned with the scene-card descriptor shape. This matters
      // when the user selected friendly JSON output instead of canonical standard JSON.
      const textureScene = outputSceneJson;

      let recap = "";
      if (settings.ai?.includeTurnSummary !== false) {
        recap = t("threebox.app.defaultAdjustRecap", "已通过{stage}调整了场景。", {
          stage: stageResultLabel(result.stage)
        });
        api.appendToBody(
          textEl,
          api.buildSummaryBlock(recap)
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
        sceneJson: useDiffCache ? null : outputSceneJsonString,
        commands: result.stage === "commands" ? result.commands || null : null,
        patch: result.stage === "json-incremental" ? result.patch || null : null,
        spatialSummary: "",
        recapSummary: recap,
        sceneTitle,
        createdAt: Date.now()
      });
      startTurnTexturePipeline({
        turnId,
        prompt: text,
        scene: textureScene,
        sceneCard,
        providerOptions,
        changedObjectIds: findChangedTextureObjectIds(
          JSON.parse(projectSceneForUser(JSON.stringify(targetSceneJson), settings)),
          textureScene
        ),
        onSceneUpdated: (updatedScene) => {
          jsonCollapse.updateJson?.(JSON.stringify(updatedScene, null, 2));
        }
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
      const failedOutput = outputStream.getText();
      if (failedOutput.trim()) {
        api.appendToBody(textEl, api.buildJsonCollapse(failedOutput, { failed: true }));
      }
      appendRetryControls(api, textEl, error, () => handleAdjustTurn(text, api, {
        conversationId,
        turnId,
        targetTurnId,
        turnContext,
        selectedCapabilityIds,
        requiresAnimation,
        generationStrategy,
        estimatedSegments
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
      activeAbortController?.abort();
      activeAbortController = null;
      chatPanel.setBusy(false);
      if (isAbortError(error)) {
        if (!api.finishInitialActivity?.(t("threebox.app.generateStopped", "已停止生成。"))) {
          api.appendAssistantMessage(t("threebox.app.generateStopped", "已停止生成。"));
        }
      } else if (!api.finishInitialActivityError?.(error)) {
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
    const turnDeadlineAt = Date.now() + 180000;
    const turnAbortController = new AbortController();
    activeAbortController = turnAbortController;
    chatPanel.setBusy(true);
    const allPriorTurns = await getTurnsForConversation(conversationId).catch(() => []);
    const priorTurns = allPriorTurns.filter(isSceneContextTurn);

    // A first scene is always routed as generation by core/ai; its negotiation call decides only
    // transport/construction/capabilities. With prior scene turns, that same call also resolves
    // whether the user is starting over or adjusting existing context.
    const history = priorTurns.map((t) => ({
      turnId: t.id,
      summary: t.recapSummary || t.userPrompt,
      userPrompt: t.userPrompt,
      mode: t.mode,
      targetTurnId: t.targetTurnId,
      sceneTitle: t.sceneTitle
    }));
    const animationCapabilityMode = settings.ai?.animationCapabilityMode || "auto";
    const sceneGenerationMode = settings.ai?.sceneGenerationMode || "auto";
    const classified = await classifyThreeBoxTurnIntent(
      { userPrompt: text, history },
      {
        ...providerOptions,
        threeBoxTurnContext: turnContext,
        turnDeadlineAt,
        signal: turnAbortController.signal,
        animationCapabilityMode,
        sceneGenerationMode
      }
    );
    const route = resolveThreeBoxNegotiatedRoute(classified, priorTurns);
    if (route.intent === "adjust") {
      await handleAdjustTurn(text, api, {
        conversationId,
        turnId,
        targetTurnId: route.targetTurnId,
        turnContext,
        turnDeadlineAt,
        abortController: turnAbortController,
        selectedCapabilityIds: classified.selectedCapabilityIds,
        requiresAnimation: classified.requiresAnimation,
        generationStrategy: classified.generationStrategy,
        executionMode: classified.executionMode,
        refinementGoals: classified.refinementGoals,
        estimatedSegments: classified.estimatedSegments
      });
    } else {
      await handleGenerateTurn(text, api, {
        conversationId,
        turnId,
        turnContext,
        turnDeadlineAt,
        abortController: turnAbortController,
        generationStrategy: classified.generationStrategy,
        executionMode: classified.executionMode,
        refinementGoals: classified.refinementGoals,
        estimatedSegments: classified.estimatedSegments,
        estimatedOutputTokens: classified.estimatedOutputTokens,
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
    for (const controller of textureJobsByTurnId.values()) controller.abort();
    textureJobsByTurnId.clear();
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
    openCloud: async () => {
      // Cloud migration is an account-service operation, deliberately independent from the
      // configurable built-in-provider endpoint.
      const cloud = createThreeBoxCloudMigration({
        apiBaseUrl: "https://api.threebox.org",
        cloudUrl: "https://cloud.threebox.org",
        settingsProvider: () => settingsModal.getSettings()
      });
      await cloud.open();
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
  if (selfHostedSync.isConfigured()) void selfHostedSync.syncNow().catch((error) => console.warn("[threebox sync]", error));
  await templateGallery.init();

  wireThreeBoxComposerStub({
    getVisionCapable,
    attachedContext,
    onResourceAdded: () => resourceLibrary.refresh()
  });
}

main();

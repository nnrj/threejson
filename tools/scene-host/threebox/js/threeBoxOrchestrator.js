import {
  generateSceneJsonString,
  parseSceneJsonString,
  runSceneAgent,
  classifyTurnIntent,
  summarizeSceneTurn,
  generateSceneTitle,
  buildStructuredTurnEnvelope,
  buildObjectSpatialCardsFromSceneJson,
  buildSceneScaleProfile,
  requestUpdatedSceneEditCommands,
  updateSceneJsonString as requestUpdatedSceneJsonString,
  executeCommands,
  createCommandContext,
  sceneToStandardJsonSimple,
  createJsonScene
} from "threejson";
import { sceneHostAssetUrl, resolveSceneHostUrl } from "../../shared/js/sceneHostPaths.js";
import { enqueueThreeBoxSceneLoad } from "./threeBoxSceneLoadQueue.js";

/** Resolves a repo-relative path (docs/zh/event-mechanism.md, assets/json/demo-show/...) to a
 * fetchable URL for core/ai/sceneReferenceCatalog.js's local doc/example retrieval — passed as
 * `resolveReferenceUrl` into runSceneAgent's options so the (environment-agnostic) agent loop
 * never needs to know how ThreeBox itself is served. */
function resolveThreeBoxReferenceUrl(repoRelativePath) {
  return resolveSceneHostUrl(repoRelativePath);
}

/**
 * Resolves a saved provider config (tools/scene-host/threebox/js/threeBoxSettingsSchema.js's
 * `ai.providers[]`) into the transport options `requestChatCompletion` (core/ai/sceneAiService.js)
 * expects: { provider, apiKey, model, baseUrl }.
 * @param {object} settings ThreeBox settings bundle
 * @param {string} [providerId] explicit provider id (e.g. composer model-select value); falls back to ai.defaultProviderId, then the first saved provider
 * @returns {{provider:string, apiKey:string, model?:string, baseUrl?:string}|null}
 */
export function resolveProviderOptions(settings, providerId) {
  const providers = Array.isArray(settings?.ai?.providers) ? settings.ai.providers : [];
  const provider =
    providers.find((p) => p.id === providerId) ||
    providers.find((p) => p.id === settings?.ai?.defaultProviderId) ||
    providers[0];
  if (!provider) {
    return null;
  }
  return {
    provider: provider.provider || "chatgpt",
    apiKey: provider.apiKey || "",
    model: provider.model || undefined,
    baseUrl: provider.provider === "custom" ? provider.baseUrl || undefined : undefined
  };
}

/**
 * Heuristic vision-capability gate for image/file attachments: DeepSeek's mainline chat models
 * don't accept image inputs; a "custom" OpenAI-compatible gateway's capability is unknowable
 * client-side, so it's allowed through (server-side will reject if unsupported). This is
 * deliberately conservative (only hard-blocks the one provider known NOT to support vision)
 * rather than trying to enumerate which specific model names do.
 * @param {{provider?: string, model?: string}|null} provider a resolved provider config (from resolveProviderOptions) or a raw saved provider entry
 * @returns {boolean}
 */
export function isProviderVisionCapable(provider) {
  if (!provider) {
    return false;
  }
  return provider.provider !== "deepseek";
}

export function resolveThreeBoxAgentOptions(settings = {}) {
  const agent = settings?.agent || {};
  return {
    enabled: agent.enabled === true,
    depth: agent.depth || settings?.ai?.agentDepth || "medium",
    iterativeApply: agent.iterativeAdjust !== false
  };
}

/** Compact, token-cheap description of a generated scene (object-type counts), for the summary call. */
export function buildResultDigest(sceneJson) {
  try {
    const counts = {};
    const worldInfo = sceneJson?.worldInfo;
    if (worldInfo && typeof worldInfo === "object") {
      for (const key of Object.keys(worldInfo)) {
        if (Array.isArray(worldInfo[key]) && worldInfo[key].length) {
          counts[key] = worldInfo[key].length;
        }
      }
    }
    if (Array.isArray(sceneJson?.objectList)) {
      counts.objectList = sceneJson.objectList.length;
    }
    return JSON.stringify(counts);
  } catch (_error) {
    return "";
  }
}

/**
 * First-turn (no prior context) generation: builds the structured JSON envelope and calls
 * core/ai's generateSceneJsonString with streaming enabled.
 * @param {{ userPrompt: string, providerOptions: object, onDelta?: (delta:string)=>void, signal?: AbortSignal, globalPromptPrefix?: string, agentOptions?: object, onAgentProgress?: (p: object)=>void, includeReferenceLinks?: boolean, locale?: string }} input
 *   `includeReferenceLinks`/`locale` are threebox-shell settings (general.locale / ai.attachReferenceLinks)
 *   forwarded into the envelope's referenceLinks block and (for agent mode) into the Agent's
 *   local docs/example retrieval — see core/ai/sceneChatSession.js and sceneReferenceCatalog.js.
 */
export async function runThreeBoxGenerateTurn({
  userPrompt,
  providerOptions,
  onDelta,
  signal,
  globalPromptPrefix,
  agentOptions,
  onAgentProgress,
  includeReferenceLinks,
  locale
}) {
  const envelope = buildStructuredTurnEnvelope({ userPrompt, intent: "generate", globalPromptPrefix, includeReferenceLinks });
  if (agentOptions?.enabled) {
    const result = await runSceneAgent(
      { mode: "generate", prompt: envelope },
      {
        ...providerOptions,
        signal,
        agent: {
          enabled: true,
          depth: agentOptions.depth || "medium"
        },
        resolveReferenceUrl: resolveThreeBoxReferenceUrl,
        locale,
        onProgress: onAgentProgress
      }
    );
    const sceneJson = parseSceneJsonString(result.sceneJsonString);
    return { sceneJson, sceneJsonString: result.sceneJsonString, agentResult: result };
  }
  const sceneJsonString = await generateSceneJsonString(envelope, {
    ...providerOptions,
    stream: true,
    onDelta,
    signal
  });
  const sceneJson = parseSceneJsonString(sceneJsonString);
  return { sceneJson, sceneJsonString };
}

/**
 * Classifies whether a follow-up message is a new generation or an adjustment of a prior turn.
 * @param {{ userPrompt: string, history: Array<{turnId:string, summary:string}> }} input
 * @param {object} providerOptions
 */
export async function classifyThreeBoxTurnIntent({ userPrompt, history }, providerOptions) {
  return classifyTurnIntent({ userPrompt, history }, providerOptions);
}

/**
 * Best-effort post-turn recap for the session cache; never throws (returns "" on failure) so a
 * failed summary call never blocks the turn from being cached/displayed. `responseLanguage`
 * (e.g. "Simplified Chinese"/"English") keeps the recap's language following the host's current
 * UI locale setting rather than whatever language the user happened to type their prompt in.
 */
export async function runThreeBoxSummary({ userPrompt, mode, targetTurnId, turnId, resultDigest, providerOptions, responseLanguage }) {
  return summarizeSceneTurn({ userPrompt, mode, targetTurnId, turnId, resultDigest, responseLanguage }, providerOptions);
}

/**
 * Best-effort scene title for the scene card's display label / download-export file name; never
 * throws (returns "" on failure) so a failed title call never blocks the turn from rendering —
 * callers should fall back to the raw user prompt. `responseLanguage` (e.g. "Simplified
 * Chinese"/"English") keeps the title's language following the host's configured scene-title
 * language setting rather than whatever language the user happened to type their prompt in.
 */
export async function runThreeBoxGenerateSceneTitle({ userPrompt, resultDigest, providerOptions, responseLanguage }) {
  return generateSceneTitle({ userPrompt, resultDigest, responseLanguage }, providerOptions);
}

/**
 * Resolves the context payload attached to an adjust turn's structured envelope, per the user's
 * settings: a compact spatial summary by default (cheap), or the full target scene JSON when the
 * user has explicitly opted into that (expensive, but sometimes necessary for the model to "see"
 * the whole scene). Mirrors the editor AI-adjust panel's includeSpatialSummary/includeFullJson
 * settings (tools/scene-host/editor/js/aiSidebar.js).
 * @param {object} targetSceneJson parsed scene JSON of the turn being adjusted
 * @param {{ includeFullJson?: boolean, includeSpatialSummary?: boolean }} settings
 */
export function resolveAdjustContextPayload(targetSceneJson, settings = {}) {
  if (settings.includeFullJson) {
    return { fullSceneJson: targetSceneJson };
  }
  if (settings.includeSpatialSummary !== false) {
    const { cards, truncated, totalCount } = buildObjectSpatialCardsFromSceneJson(targetSceneJson);
    const scaleProfile = buildSceneScaleProfile(cards, { truncated, totalCount });
    return { objectSpatialCards: cards, sceneScaleProfile: scaleProfile };
  }
  return {};
}

/** Serializes a runtime's current scene state back to a standard JSON string. `runtimeTarget:
 * runtime` is required — without it, sceneToStandardJsonSimple has no camera/renderer/controls to
 * read, so the exported sceneConfig silently drops the camera entirely (objects export fine, but
 * the resulting scene renders as a tiny speck from whatever default camera the next viewer falls
 * back to). */
function exportRuntimeSceneJsonString(runtime) {
  return JSON.stringify(
    sceneToStandardJsonSimple(runtime.scene, { merge: false, runtimeTarget: runtime }),
    null,
    2
  );
}

/**
 * Builds a throwaway, never-displayed runtime from a cached turn's JSON purely so the commands
 * stage has a real `core/command` scene context to mutate. This is deliberately NOT the live,
 * on-screen runtime for that turn's scene card: history must stay immutable (like a ChatGPT
 * image — an earlier turn's rendered result never changes when a later turn adjusts it), so
 * command execution always happens on a private clone, and the *result* is what gets rendered
 * into the NEW turn's own scene card.
 */
async function createOffscreenRuntimeFromSceneJsonString(sceneJsonString) {
  const sceneJson = parseSceneJsonString(sceneJsonString);
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  return enqueueThreeBoxSceneLoad(() =>
    createJsonScene(sceneJson, {
      canvas,
      resetScene: true,
      assetsBase: sceneHostAssetUrl("assets/")
    })
  );
}

function mapThreeBoxUpdateModeToAgentInput(updateOutputMode) {
  if (updateOutputMode === "json-full") {
    return { outputMode: "json", updateMode: "full", stage: "json-full" };
  }
  if (updateOutputMode === "json-incremental") {
    return { outputMode: "json", updateMode: "incremental", stage: "json-incremental" };
  }
  return { outputMode: "commands", updateMode: undefined, stage: "commands" };
}

function createCommandContextForRuntime(runtime) {
  return createCommandContext({
    scene: runtime.scene,
    camera: runtime.camera,
    renderer: runtime.renderer,
    controls: runtime.controls
  });
}

async function runThreeBoxAgentAdjustTurn({
  userPrompt,
  envelope,
  targetSceneJsonString,
  providerOptions,
  agentOptions,
  updateOutputMode,
  resolveContextPayload,
  onAgentProgress,
  locale,
  signal
}) {
  const mode = mapThreeBoxUpdateModeToAgentInput(updateOutputMode);
  const baseSceneJson = parseSceneJsonString(targetSceneJsonString);
  const baseContextPayload = resolveContextPayload?.(baseSceneJson) || {};
  const updateContext = {
    ...baseContextPayload,
    userMessage: envelope,
    currentSceneJsonString: targetSceneJsonString,
    fullSceneJson: targetSceneJsonString
  };

  if (mode.outputMode !== "commands") {
    const result = await runSceneAgent(
      {
        mode: "update",
        prompt: envelope,
        currentSceneJsonString: targetSceneJsonString,
        outputMode: mode.outputMode
      },
      {
        ...providerOptions,
        updateMode: mode.updateMode,
        agent: { enabled: true, depth: agentOptions.depth || "medium" },
        resolveReferenceUrl: resolveThreeBoxReferenceUrl,
        locale,
        signal,
        onProgress: onAgentProgress
      }
    );
    return {
      stage: mode.stage,
      patch: null,
      sceneJson: parseSceneJsonString(result.sceneJsonString),
      sceneJsonString: result.sceneJsonString,
      agentResult: result
    };
  }

  const offscreenRuntime = await createOffscreenRuntimeFromSceneJsonString(targetSceneJsonString);
  try {
    let latestSceneJsonString = targetSceneJsonString;
    const refreshContext = async () => {
      latestSceneJsonString = exportRuntimeSceneJsonString(offscreenRuntime);
      const latestSceneJson = parseSceneJsonString(latestSceneJsonString);
      const contextPayload = resolveContextPayload?.(latestSceneJson) || {};
      return {
        ...contextPayload,
        currentSceneJsonString: latestSceneJsonString,
        fullSceneJson: latestSceneJsonString
      };
    };
    const applyCommands = async (commands) => {
      const ctx = createCommandContextForRuntime(offscreenRuntime);
      const execResult = await executeCommands(ctx, commands);
      const results = Array.isArray(execResult.results) ? execResult.results : [];
      const ok = results.length ? results.every((r) => r.ok !== false) : execResult.ok !== false;
      const sceneMutated = results.some((r) => r.ok);
      return { ok, sceneMutated, execResult, error: results.find((r) => !r.ok)?.error };
    };
    const result = await runSceneAgent(
      {
        mode: "update",
        prompt: envelope,
        currentSceneJsonString: targetSceneJsonString,
        outputMode: "commands",
        updateContext
      },
      {
        ...providerOptions,
        agent: {
          enabled: true,
          depth: agentOptions.depth || "medium",
          iterativeApply: agentOptions.iterativeApply !== false
        },
        resolveReferenceUrl: resolveThreeBoxReferenceUrl,
        locale,
        signal,
        applyCommands,
        refreshContext,
        onProgress: onAgentProgress
      }
    );
    if (result.outputMode === "json") {
      return {
        stage: "json-full",
        sceneJson: parseSceneJsonString(result.sceneJsonString),
        sceneJsonString: result.sceneJsonString,
        agentResult: result
      };
    }
    if (!result.skipFinalExec && Array.isArray(result.commands) && result.commands.length) {
      const applied = await applyCommands(result.commands);
      if (!applied.ok) {
        throw new Error(applied.error || "Agent command apply failed.");
      }
    }
    const sceneJsonString = exportRuntimeSceneJsonString(offscreenRuntime);
    return {
      stage: "commands",
      commands: result.commands || [],
      execResult: { ok: result.execOk !== false },
      sceneJson: parseSceneJsonString(sceneJsonString),
      sceneJsonString,
      agentResult: result
    };
  } finally {
    offscreenRuntime.dispose?.();
  }
}

/**
 * Three-stage adjust fallback chain, mirroring the editor's AI-adjust panel
 * (tools/scene-host/editor/lib/ai/runEditorAiUpdate.js): try operation commands against a
 * private offscreen clone of the target turn's scene first (undoable-shaped, no full JSON
 * regeneration needed); if that produces no usable mutation, fall back to an RFC 6902 JSON-Patch
 * regeneration; if that also fails, fall back to a full scene JSON regeneration (always succeeds
 * or throws). The target turn's own on-screen scene card is never touched by any stage — every
 * path here returns a fresh `sceneJson`/`sceneJsonString` for the CALLER to render into a new card.
 *
 * @param {{
 *   userPrompt: string,
 *   envelope: string,
 *   targetSceneJsonString: string,
 *   providerOptions: object,
 *   onDelta?: (delta: string) => void,
 *   agentOptions?: object,
 *   updateOutputMode?: string,
 *   resolveContextPayload?: (sceneJson: object) => object,
 *   onAgentProgress?: (p: object) => void,
 *   locale?: string,
 *   signal?: AbortSignal
 * }} input
 * @returns {Promise<
 *   | { stage: "commands", commands: object[], execResult: object, sceneJson: object, sceneJsonString: string }
 *   | { stage: "json-incremental", patch: object[]|null, sceneJson: object, sceneJsonString: string }
 *   | { stage: "json-full", sceneJson: object, sceneJsonString: string }
 * >}
 */
export async function runThreeBoxAdjustTurn({
  userPrompt,
  envelope,
  targetSceneJsonString,
  providerOptions,
  onDelta,
  agentOptions,
  updateOutputMode = "commands",
  resolveContextPayload,
  onAgentProgress,
  locale,
  signal
}) {
  if (agentOptions?.enabled) {
    return runThreeBoxAgentAdjustTurn({
      userPrompt,
      envelope,
      targetSceneJsonString,
      providerOptions,
      agentOptions,
      updateOutputMode,
      resolveContextPayload,
      onAgentProgress,
      locale,
      signal
    });
  }

  try {
    const cmdResult = await requestUpdatedSceneEditCommands(
      userPrompt,
      { userMessage: envelope, currentSceneJsonString: targetSceneJsonString, fullSceneJson: targetSceneJsonString },
      { ...providerOptions, outputMode: "commands", fallbackToJson: false, stream: true, onDelta, signal }
    );
    if (cmdResult.outputMode === "commands" && cmdResult.commands?.length) {
      const offscreenRuntime = await createOffscreenRuntimeFromSceneJsonString(targetSceneJsonString);
      try {
        const ctx = createCommandContext({
          scene: offscreenRuntime.scene,
          camera: offscreenRuntime.camera,
          renderer: offscreenRuntime.renderer,
          controls: offscreenRuntime.controls
        });
        const execResult = await executeCommands(ctx, cmdResult.commands);
        if (execResult.results.some((r) => r.ok)) {
          const sceneJsonString = exportRuntimeSceneJsonString(offscreenRuntime);
          return {
            stage: "commands",
            commands: cmdResult.commands,
            execResult,
            sceneJson: parseSceneJsonString(sceneJsonString),
            sceneJsonString
          };
        }
      } finally {
        offscreenRuntime.dispose?.();
      }
    }
  } catch (_error) {
    /* fall through to json-incremental */
  }

  try {
    const { sceneJsonString: patchedJsonString, patch } = await requestUpdatedSceneJsonString(userPrompt, targetSceneJsonString, {
      ...providerOptions,
      updateMode: "incremental",
      includePatch: true,
      stream: true,
      onDelta,
      signal
    });
    return {
      stage: "json-incremental",
      patch,
      sceneJson: parseSceneJsonString(patchedJsonString),
      sceneJsonString: patchedJsonString
    };
  } catch (_error) {
    /* fall through to json-full */
  }

  const fullJsonString = await requestUpdatedSceneJsonString(userPrompt, targetSceneJsonString, {
    ...providerOptions,
    updateMode: "full",
    stream: true,
    onDelta,
    signal
  });
  return { stage: "json-full", sceneJson: parseSceneJsonString(fullJsonString), sceneJsonString: fullJsonString };
}

/**
 * Reconstructs a turn's full scene JSON string when it wasn't cached directly — i.e. when
 * `io.turnCacheMode` is "diff" and this turn's result came from the "commands" stage, so only its
 * `commands` array was persisted (see threeBoxSessionStore.js's turn record shape). Walks
 * backward from the target turn to the nearest earlier turn in the same conversation that still
 * has a full `sceneJson`, then replays every intermediate commands-only turn's commands in order
 * against one offscreen runtime to rebuild the target's state.
 *
 * `orderedTurns` must be every turn for the conversation, sorted oldest-first (as returned by
 * threeBoxSessionStore.js's getTurnsForConversation). Turns are never diff-cached across a
 * "template"/"generate"/"json-incremental"/"json-full" stage — those always carry a full
 * `sceneJson` — so a diff chain only ever needs to replay "commands"-stage turns.
 *
 * @param {Array<object>} orderedTurns
 * @param {string} targetTurnId
 * @returns {Promise<string>} the reconstructed (or directly cached) full scene JSON string
 */
export async function resolveTurnSceneJsonString(orderedTurns, targetTurnId) {
  const targetIndex = orderedTurns.findIndex((t) => t.id === targetTurnId);
  if (targetIndex === -1) {
    throw new Error(`resolveTurnSceneJsonString: turn ${targetTurnId} not found in orderedTurns`);
  }
  if (orderedTurns[targetIndex].sceneJson) {
    return orderedTurns[targetIndex].sceneJson;
  }
  let baseIndex = targetIndex - 1;
  while (baseIndex >= 0 && !orderedTurns[baseIndex].sceneJson) {
    baseIndex -= 1;
  }
  if (baseIndex < 0) {
    throw new Error(`resolveTurnSceneJsonString: no earlier full-JSON turn found to reconstruct ${targetTurnId} from`);
  }

  const offscreenRuntime = await createOffscreenRuntimeFromSceneJsonString(orderedTurns[baseIndex].sceneJson);
  try {
    const ctx = createCommandContext({
      scene: offscreenRuntime.scene,
      camera: offscreenRuntime.camera,
      renderer: offscreenRuntime.renderer,
      controls: offscreenRuntime.controls
    });
    for (let i = baseIndex + 1; i <= targetIndex; i += 1) {
      const commands = orderedTurns[i].commands;
      if (commands?.length) {
        await executeCommands(ctx, commands);
      }
    }
    return exportRuntimeSceneJsonString(offscreenRuntime);
  } finally {
    offscreenRuntime.dispose?.();
  }
}

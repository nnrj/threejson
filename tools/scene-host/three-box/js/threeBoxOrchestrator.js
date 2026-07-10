import {
  generateSceneJsonString,
  parseSceneJsonString,
  classifyTurnIntent,
  summarizeSceneTurn,
  buildStructuredTurnEnvelope,
  buildObjectSpatialCardsFromSceneJson,
  buildSceneScaleProfile,
  requestUpdatedSceneEditCommands,
  updateSceneJsonString as requestUpdatedSceneJsonString,
  executeCommands,
  createCommandContext,
  sceneToStandardJsonSimple
} from "threejson/core";

/**
 * Resolves a saved provider config (tools/scene-host/three-box/js/threeBoxSettingsSchema.js's
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
 * @param {{ userPrompt: string, providerOptions: object, onDelta?: (delta:string)=>void, signal?: AbortSignal }} input
 */
export async function runThreeBoxGenerateTurn({ userPrompt, providerOptions, onDelta, signal }) {
  const envelope = buildStructuredTurnEnvelope({ userPrompt, intent: "generate" });
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
 * failed summary call never blocks the turn from being cached/displayed.
 */
export async function runThreeBoxSummary({ userPrompt, mode, targetTurnId, turnId, resultDigest, providerOptions }) {
  return summarizeSceneTurn({ userPrompt, mode, targetTurnId, turnId, resultDigest }, providerOptions);
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

/**
 * Three-stage adjust fallback chain, mirroring the editor's AI-adjust panel
 * (tools/scene-host/editor/lib/ai/runEditorAiUpdate.js): try operation commands against the
 * live runtime first (undoable, no full reload); if that produces no usable mutation, fall back
 * to an RFC 6902 JSON-Patch regeneration; if that also fails, fall back to a full scene JSON
 * regeneration (always succeeds or throws).
 *
 * @param {{
 *   userPrompt: string,
 *   envelope: string,
 *   targetSceneJsonString: string,
 *   runtime: { scene: object, camera: object, renderer?: object, controls?: object },
 *   providerOptions: object,
 *   onDelta?: (delta: string) => void
 * }} input
 * @returns {Promise<
 *   | { stage: "commands", commands: object[], execResult: object }
 *   | { stage: "json-incremental" | "json-full", sceneJson: object, sceneJsonString: string }
 * >}
 */
export async function runThreeBoxAdjustTurn({ userPrompt, envelope, targetSceneJsonString, runtime, providerOptions, onDelta }) {
  try {
    const cmdResult = await requestUpdatedSceneEditCommands(
      userPrompt,
      { userMessage: envelope, currentSceneJsonString: targetSceneJsonString, fullSceneJson: targetSceneJsonString },
      { ...providerOptions, outputMode: "commands", fallbackToJson: false, stream: true, onDelta }
    );
    if (cmdResult.outputMode === "commands" && cmdResult.commands?.length && runtime?.scene) {
      const ctx = createCommandContext({
        scene: runtime.scene,
        camera: runtime.camera,
        renderer: runtime.renderer,
        controls: runtime.controls
      });
      const execResult = await executeCommands(ctx, cmdResult.commands);
      if (execResult.results.some((r) => r.ok)) {
        return { stage: "commands", commands: cmdResult.commands, execResult };
      }
    }
  } catch (_error) {
    /* fall through to json-incremental */
  }

  try {
    const patchedJsonString = await requestUpdatedSceneJsonString(userPrompt, targetSceneJsonString, {
      ...providerOptions,
      updateMode: "incremental",
      stream: true,
      onDelta
    });
    return { stage: "json-incremental", sceneJson: parseSceneJsonString(patchedJsonString), sceneJsonString: patchedJsonString };
  } catch (_error) {
    /* fall through to json-full */
  }

  const fullJsonString = await requestUpdatedSceneJsonString(userPrompt, targetSceneJsonString, {
    ...providerOptions,
    updateMode: "full",
    stream: true,
    onDelta
  });
  return { stage: "json-full", sceneJson: parseSceneJsonString(fullJsonString), sceneJsonString: fullJsonString };
}

/** Serializes a live runtime's current scene state back to a standard JSON string — used after a
 * successful command-stage mutation to capture the post-mutation state for caching/re-rendering. */
export function exportRuntimeSceneJsonString(runtime) {
  return JSON.stringify(sceneToStandardJsonSimple(runtime.scene, { merge: false }), null, 2);
}

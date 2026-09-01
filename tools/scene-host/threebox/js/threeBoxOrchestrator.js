import { executeCommands, createCommandContext } from "threejson";
import {
  buildResultDigest as buildAiResultDigest,
  classifyAiTurnIntent,
  createOffscreenRuntimeFromSceneJsonString,
  exportRuntimeSceneJsonString,
  isProviderVisionCapable as isProviderVisionCapableShared,
  resolveAiAdjustContextPayload,
  runAiAdjustTurn,
  runAiGenerateTurn,
  runAiSceneTitle,
  runAiTurnSummary
} from "../../shared/js/aiTurnOrchestrator.js";
import {
  BUILTIN_PROVIDER_TYPE,
  withBuiltinAiProviderAdapter
} from "../../shared/js/builtinAiProvider.js";

/**
 * ThreeBox-specific glue over the shared AI turn orchestration core
 * (tools/scene-host/shared/js/aiTurnOrchestrator.js, also used by editor/'s AI-edit tab). This
 * file only keeps what's genuinely ThreeBox-shaped: resolving `ai.providers[]` (an array of saved
 * provider configs) and `agent.*` settings into the transport-options shape the shared core
 * expects, plus the chat-turn-store diff-reconstruction helper — everything else below is a thin
 * re-export so `threeBoxApp.js` and friends don't need to change at all.
 */

/**
 * Resolves a saved provider config (tools/scene-host/threebox/js/threeBoxSettingsSchema.js's
 * `ai.providers[]`) into the transport options `requestChatCompletion` (core/ai/sceneAiService.js)
 * expects: { provider, apiKey, model, baseUrl, thinkingPreference }.
 * @param {object} settings ThreeBox settings bundle
 * @param {string} [providerId] explicit provider id (e.g. composer model-select value); falls back to ai.defaultProviderId, then the first saved provider
 * @returns {{provider:string, apiKey:string, model?:string, baseUrl?:string, thinkingPreference:string}|null}
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
  const options = {
    provider: provider.provider || "chatgpt",
    apiKey: provider.apiKey || "",
    model: provider.model || undefined,
    thinkingPreference: settings?.ai?.thinkingPreference || "disabled",
    baseUrl:
      provider.provider === "custom"
        ? provider.baseUrl || undefined
        : provider.provider === BUILTIN_PROVIDER_TYPE
          ? settings?.ai?.builtinBackendUrl || undefined
          : undefined
  };
  return provider.provider === BUILTIN_PROVIDER_TYPE
    ? withBuiltinAiProviderAdapter(options)
    : options;
}

export function isProviderVisionCapable(provider) {
  return isProviderVisionCapableShared(provider);
}

/** Resolve only explicit user budgets; zero/blank leaves the model-driven loop unlimited. */
export function resolveThreeBoxAgentOptions(settings = {}) {
  const configured = Number(settings?.ai?.maxAutoRefineRounds);
  const modelBudget = settings?.ai?.modelBudget || {};
  return {
    ...(Number.isFinite(configured) && configured > 0
      ? { maxRefineRounds: Math.round(configured) }
      : {}),
    complexModelStrategy: settings?.ai?.complexModelStrategy || "auto",
    modelQuality: settings?.ai?.modelQuality || "balanced",
    modelBudget: {
      maxTokens: Number(modelBudget.maxTokens) > 0 ? Number(modelBudget.maxTokens) : undefined,
      maxCost: Number(modelBudget.maxCost) > 0 ? Number(modelBudget.maxCost) : undefined,
      maxTimeMs: Number(modelBudget.maxTimeMs) > 0 ? Number(modelBudget.maxTimeMs) : undefined
    }
  };
}

/** Optional user ceiling for scene-authoring responses. Zero/blank means no client-side limit:
 * direct providers use their own default and the built-in provider remains governed by the
 * administrator's threebox-server policy. */
export function resolveThreeBoxSceneTokenOptions(settings = {}) {
  const configured = Number(settings?.ai?.sceneMaxOutputTokens);
  return Number.isFinite(configured) && configured > 0
    ? { maxTokens: Math.round(configured) }
    : {};
}

export function buildResultDigest(sceneJson) {
  return buildAiResultDigest(sceneJson);
}

export function runThreeBoxGenerateTurn(input) {
  return runAiGenerateTurn(input);
}

export function classifyThreeBoxTurnIntent(input, providerOptions) {
  return classifyAiTurnIntent(input, providerOptions);
}

export function runThreeBoxSummary(input) {
  return runAiTurnSummary(input);
}

export function runThreeBoxGenerateSceneTitle(input) {
  return runAiSceneTitle(input);
}

export function resolveAdjustContextPayload(targetSceneJson, settings = {}) {
  return resolveAiAdjustContextPayload(targetSceneJson, settings);
}

export function runThreeBoxAdjustTurn(input) {
  return runAiAdjustTurn(input);
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

  let baseSceneJson = JSON.parse(orderedTurns[baseIndex].sceneJson);
  const offscreenRuntime = await createOffscreenRuntimeFromSceneJsonString(orderedTurns[baseIndex].sceneJson);
  try {
    const ctx = createCommandContext({
      scene: offscreenRuntime.scene,
      camera: offscreenRuntime.camera,
      renderer: offscreenRuntime.renderer,
      controls: offscreenRuntime.controls,
      runtime: offscreenRuntime,
      document: baseSceneJson
    });
    for (let i = baseIndex + 1; i <= targetIndex; i += 1) {
      const commands = orderedTurns[i].commands;
      if (commands?.length) {
        const replayResult = await executeCommands(ctx, commands);
        if (replayResult?.ok === false) {
          const failed = replayResult.results?.find((entry) => entry?.ok === false);
          throw new Error(
            `resolveTurnSceneJsonString: failed to replay turn ${orderedTurns[i].id}: ${failed?.error || "command execution failed"}`
          );
        }
        baseSceneJson = JSON.parse(exportRuntimeSceneJsonString(offscreenRuntime, baseSceneJson));
        ctx.document = baseSceneJson;
      }
    }
    return JSON.stringify(baseSceneJson, null, 2);
  } finally {
    offscreenRuntime.dispose?.();
  }
}

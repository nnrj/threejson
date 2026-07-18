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
    baseUrl:
      provider.provider === "custom"
        ? provider.baseUrl || undefined
        : provider.provider === "threebox-builtin"
          ? settings?.ai?.builtinBackendUrl || undefined
          : undefined
  };
}

export function isProviderVisionCapable(provider) {
  return isProviderVisionCapableShared(provider);
}

export function resolveThreeBoxAgentOptions(settings = {}) {
  const agent = settings?.agent || {};
  return {
    enabled: agent.enabled === true,
    depth: agent.depth || settings?.ai?.agentDepth || "medium",
    iterativeApply: agent.iterativeAdjust !== false,
    progressiveGenerate: agent.progressiveGenerate !== false
  };
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

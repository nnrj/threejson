import {
  buildResultDigest,
  classifyAiTurnIntent,
  createOffscreenRuntimeFromSceneJsonString,
  exportRuntimeSceneJsonString,
  isProviderVisionCapable,
  resolveAiAdjustContextPayload,
  runAiAdjustTurn,
  runAiGenerateTurn,
  runAiSceneTitle,
  runAiTurnSummary
} from "@threejson/host-kit/js/aiTurnOrchestrator.js";
import { createCommandContext, executeCommands } from "threejson/commands";
import {
  buildStructuredTurnEnvelope,
  createSceneAiTurnContext,
  projectSceneJsonString
} from "threejson/ai";
import { resolveSceneAgentRoute } from "./turnState.js";

export {
  buildResultDigest as buildSceneAgentResultDigest,
  isProviderVisionCapable,
  resolveAiAdjustContextPayload as resolveSceneAgentAdjustContext,
  runAiSceneTitle as runSceneAgentTitle,
  runAiTurnSummary as runSceneAgentSummary
};

export const runSceneAgentGenerateTurn = (input) => runAiGenerateTurn(input);
export const runSceneAgentAdjustTurn = (input) => runAiAdjustTurn(input);
export const buildSceneAgentTurnEnvelope = (input) => buildStructuredTurnEnvelope(input);
export const createSceneAgentTurnContext = (turnId, userPrompt) =>
  createSceneAiTurnContext(turnId, userPrompt);
export const projectSceneAgentJsonString = (sceneJsonString, outputFormat = "standard", options = {}) =>
  projectSceneJsonString(sceneJsonString, outputFormat, options);

/** Empty history is always generation; the model negotiates only construction and capabilities. */
export async function negotiateSceneAgentTurn(input, providerOptions) {
  const history = Array.isArray(input?.history) ? input.history : [];
  const classified = await classifyAiTurnIntent({ ...input, history }, providerOptions);
  const routeTurns = Array.isArray(input?.priorTurns)
    ? input.priorTurns
    : history.map((turn) => ({
        ...turn,
        id: turn.id || turn.turnId,
        // Negotiation history intentionally carries summaries instead of large snapshots. Mark a
        // summarized turn as scene context for routing without sending its full JSON to the model.
        sceneJson: turn.sceneJson || (turn.turnId || turn.id ? "summarized-scene-context" : null)
      }));
  return { ...classified, route: resolveSceneAgentRoute(classified, routeTurns) };
}

export async function reconstructSceneAgentTurn(orderedTurns, targetTurnId) {
  const targetIndex = orderedTurns.findIndex((turn) => turn.id === targetTurnId);
  if (targetIndex < 0) throw new Error(`Turn ${targetTurnId} was not found.`);
  if (orderedTurns[targetIndex].sceneJson) return orderedTurns[targetIndex].sceneJson;
  let baseIndex = targetIndex - 1;
  while (baseIndex >= 0 && !orderedTurns[baseIndex].sceneJson) baseIndex -= 1;
  if (baseIndex < 0) throw new Error(`No full scene snapshot precedes turn ${targetTurnId}.`);

  let document = JSON.parse(orderedTurns[baseIndex].sceneJson);
  const runtime = await createOffscreenRuntimeFromSceneJsonString(orderedTurns[baseIndex].sceneJson);
  try {
    const context = createCommandContext({
      scene: runtime.scene,
      camera: runtime.camera,
      renderer: runtime.renderer,
      controls: runtime.controls,
      runtime,
      document
    });
    for (let index = baseIndex + 1; index <= targetIndex; index += 1) {
      const commands = orderedTurns[index].commands;
      if (!commands?.length) continue;
      const result = await executeCommands(context, commands);
      if (result?.ok === false) throw new Error(`Failed to replay turn ${orderedTurns[index].id}.`);
      document = JSON.parse(exportRuntimeSceneJsonString(runtime, document));
      context.document = document;
    }
    return JSON.stringify(document, null, 2);
  } finally {
    runtime.dispose?.();
  }
}

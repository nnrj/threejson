import {
  createCommandRegistry,
  executeCommand
} from "../../../../core/command/index.js";
import { buildCommandIntentHints } from "../../../../core/ai/sceneCapability.js";
import { buildSceneCommandUpdateUserMessage } from "../../../../core/ai/sceneCommandSkill.js";
import {
  buildObjectSpatialCardsFromScene,
  buildPlacementHints,
  buildSceneScaleProfile,
  pickReferenceObjects
} from "./sceneSpatialContext.js";

/**
 * Collect compact scene context from a live editor runtime.
 * @param {import("../command/types.js").EditorApi} editorApi
 * @param {{ includeFullJson?: boolean, includeSpatialSummary?: boolean, fullSceneJson?: string, prompt?: string }} [options]
 * @returns {Promise<object>}
 */
export async function collectEditorSceneContext(editorApi, options = {}) {
  const ctx = editorApi.getCommandContext();
  const prompt = String(options.prompt || "").trim();
  const registry = createCommandRegistry();

  let objectList = [];
  const listResult = await executeCommand(ctx, { op: "scene.list", args: {} }, { registry });
  if (listResult.ok && Array.isArray(listResult.data?.items)) {
    objectList = listResult.data.items;
  }

  const selectionId = editorApi.getSelection();
  let selectionDescriptor = null;
  if (selectionId) {
    const getResult = await executeCommand(
      ctx,
      { op: "object.get", args: { id: selectionId } },
      { registry, skipRuntimeGuard: true }
    );
    if (getResult.ok) {
      selectionDescriptor = getResult.data?.descriptor ?? getResult.data ?? null;
    }
  }

  const fullSceneJson = String(options.fullSceneJson || "").trim();
  const context = {
    objectList,
    selectionId,
    selectionDescriptor,
    currentSceneJsonString: fullSceneJson || undefined,
    fullSceneJson: options.includeFullJson === true && fullSceneJson ? fullSceneJson : undefined
  };

  if (options.includeSpatialSummary === true) {
    const spatial = buildObjectSpatialCardsFromScene(ctx);
    const cards = spatial.cards;
    context.sceneScaleProfile = buildSceneScaleProfile(cards, {
      truncated: spatial.truncated === true,
      totalCount: spatial.totalCount ?? cards.length
    });
    context.objectSpatialCards = cards;
    context.referenceObjects = pickReferenceObjects(prompt, cards, spatial.descriptorById, {
      selectionId: context.selectionId,
      selectionDescriptor: context.selectionDescriptor
    });
    context.placementHints = buildPlacementHints(
      prompt,
      context.referenceObjects,
      context.sceneScaleProfile
    );
    context.objectListForMessage = [];
  }

  context.assemblyIntentHints = buildCommandIntentHints(prompt);

  return context;
}

/**
 * Build the user message for core/ai command-mode scene update.
 * @param {object} params
 * @param {string} params.prompt
 * @param {import("../command/types.js").EditorApi} params.editorApi
 * @param {boolean} [params.includeFullJson]
 * @param {boolean} [params.includeSpatialSummary]
 * @param {string} [params.fullSceneJson]
 * @returns {Promise<string>}
 */
export async function buildEditorUpdatePrompt({
  prompt,
  editorApi,
  includeFullJson = false,
  includeSpatialSummary = false,
  fullSceneJson = ""
}) {
  const context = await collectEditorSceneContext(editorApi, {
    includeFullJson,
    includeSpatialSummary,
    fullSceneJson,
    prompt
  });
  return buildSceneCommandUpdateUserMessage({
    modificationRequest: prompt,
    objectList: context.objectListForMessage ?? context.objectList,
    selectionId: context.selectionId,
    selectionDescriptor: context.selectionDescriptor,
    fullSceneJson: context.fullSceneJson,
    objectSpatialCards: context.objectSpatialCards,
    sceneScaleProfile: context.sceneScaleProfile,
    referenceObjects: context.referenceObjects,
    placementHints: context.placementHints,
    assemblyIntentHints: context.assemblyIntentHints
  });
}

/**
 * @param {object} params
 * @param {string} params.prompt
 * @param {import("../command/types.js").EditorApi} params.editorApi
 * @param {boolean} [params.includeFullJson]
 * @param {boolean} [params.includeSpatialSummary]
 * @param {string} [params.fullSceneJson]
 * @returns {Promise<object>}
 */
export async function buildEditorUpdateContext({
  prompt,
  editorApi,
  includeFullJson = false,
  includeSpatialSummary = false,
  fullSceneJson = ""
}) {
  const trimmedPrompt = String(prompt || "").trim();
  const context = await collectEditorSceneContext(editorApi, {
    includeFullJson,
    includeSpatialSummary,
    fullSceneJson,
    prompt: trimmedPrompt
  });
  return {
    ...context,
    prompt: trimmedPrompt
  };
}

/**
 * Scene AI client entry: generate / update scene JSON (mounts `window.ThreeJsonAI` in the browser).
 */
import {
  generateSceneJsonString,
  generateSceneJsonFromImage,
  updateSceneJsonString,
  requestUpdatedSceneEditCommands,
  requestSceneRefinementStep,
  extractJsonText,
  parseSceneJsonString,
  projectSceneJsonString,
  resolveVisionImageUrl
} from "./sceneAiService.js";
import {
  buildSceneCommandSkillFragment,
  buildSceneCommandAutoUpdateSystemPrompt,
  buildSceneCommandUpdateSystemPrompt,
  buildSceneCommandUpdateUserMessage,
  batchResultsHaveSceneMutation,
  batchResultsHaveSuccessfulAdjustment,
  formatObjectGetFeedbackFromBatch,
  extractVisualFeedbackFromBatch,
  extractCommandScriptText,
  isLikelyCommandScriptText,
  resolveOutputKind
} from "./sceneCommandSkill.js";
import { createSceneTexturePlanner, requestSceneTexturePlan } from "./sceneTexturePlanner.js";
import { runSceneAgent } from "./sceneAgent.js";
import {
  validateSceneJson,
  summarizeSchema,
  evaluateSceneCapabilityFit,
  buildCapabilityFixPrompt
} from "./agentTools.js";
import {
  buildIntentHints,
  buildCommandIntentHints,
  analyzeSceneUsage,
  evaluateCapabilityFit,
  matchIntentSignals,
  mergeRequiredCapabilityIds
} from "./sceneCapability.js";
import {
  THREE_JSON_AGENT_CAPABILITY_INDEX,
  THREE_JSON_AGENT_EXAMPLE_INDEX,
  buildAgentCapabilityIndex
} from "./sceneCapabilityIndex.js";
import {
  buildObjectSpatialCardsFromScene,
  buildObjectSpatialCardsFromSceneJson,
  buildSceneScaleProfile,
  pickReferenceObjects,
  buildPlacementHints
} from "./sceneSpatialContext.js";
import {
  classifyTurnIntent,
  summarizeSceneTurn,
  generateSceneTitle,
  buildStructuredTurnEnvelope
} from "./sceneChatSession.js";

/**
 * Build an AI call wrapper with default options so pages can override baseUrl, model, etc.
 * @param {object} [defaultOptions={}] Merged into each request's options
 * @returns {object}
 */
function createSceneAiClient(defaultOptions = {}) {
  return {
    async generateSceneJsonString(prompt, options = {}) {
      return generateSceneJsonString(prompt, { ...defaultOptions, ...options });
    },
    async generateSceneJsonFromImage(input, options = {}) {
      return generateSceneJsonFromImage(input, { ...defaultOptions, ...options });
    },
    async updateSceneJsonString(prompt, currentSceneJsonString, options = {}) {
      return updateSceneJsonString(prompt, currentSceneJsonString, { ...defaultOptions, ...options });
    },
    async requestUpdatedSceneEditCommands(prompt, context = {}, options = {}) {
      return requestUpdatedSceneEditCommands(prompt, context, { ...defaultOptions, ...options });
    },
    async requestSceneRefinementStep(prompt, currentSceneJsonString, options = {}) {
      return requestSceneRefinementStep(prompt, currentSceneJsonString, { ...defaultOptions, ...options });
    },
    createTexturePlanner(options = {}) {
      return createSceneTexturePlanner({ ...defaultOptions, ...options });
    },
    async runSceneAgent(input, options = {}) {
      return runSceneAgent(input, { ...defaultOptions, ...options });
    }
  };
}

if (typeof window !== "undefined") {
  window.ThreeJsonAI = {
    createSceneAiClient,
    generateSceneJsonString,
    generateSceneJsonFromImage,
    updateSceneJsonString,
    requestUpdatedSceneEditCommands,
    requestSceneRefinementStep,
    projectSceneJsonString,
    createSceneTexturePlanner,
    requestSceneTexturePlan,
    resolveVisionImageUrl,
    runSceneAgent,
    validateSceneJson,
    summarizeSchema,
    evaluateSceneCapabilityFit,
    buildIntentHints,
    THREE_JSON_AGENT_CAPABILITY_INDEX,
    THREE_JSON_AGENT_EXAMPLE_INDEX,
    buildAgentCapabilityIndex,
    analyzeSceneUsage,
    evaluateCapabilityFit,
    matchIntentSignals,
    mergeRequiredCapabilityIds,
    buildCapabilityFixPrompt,
    buildObjectSpatialCardsFromScene,
    buildObjectSpatialCardsFromSceneJson,
    buildSceneScaleProfile,
    pickReferenceObjects,
    buildPlacementHints,
    classifyTurnIntent,
    summarizeSceneTurn,
    generateSceneTitle,
    buildStructuredTurnEnvelope
  };
}

export {
  createSceneAiClient,
  generateSceneJsonString,
  generateSceneJsonFromImage,
  updateSceneJsonString,
  requestUpdatedSceneEditCommands,
  requestSceneRefinementStep,
  buildSceneCommandSkillFragment,
  buildSceneCommandAutoUpdateSystemPrompt,
  buildSceneCommandUpdateSystemPrompt,
  buildSceneCommandUpdateUserMessage,
  batchResultsHaveSceneMutation,
  batchResultsHaveSuccessfulAdjustment,
  formatObjectGetFeedbackFromBatch,
  extractVisualFeedbackFromBatch,
  extractCommandScriptText,
  isLikelyCommandScriptText,
  resolveOutputKind,
  extractJsonText,
  parseSceneJsonString,
  projectSceneJsonString,
  createSceneTexturePlanner,
  requestSceneTexturePlan,
  resolveVisionImageUrl,
  runSceneAgent,
  validateSceneJson,
  summarizeSchema,
  evaluateSceneCapabilityFit,
  buildIntentHints,
  buildCommandIntentHints,
  THREE_JSON_AGENT_CAPABILITY_INDEX,
  THREE_JSON_AGENT_EXAMPLE_INDEX,
  buildAgentCapabilityIndex,
  analyzeSceneUsage,
  evaluateCapabilityFit,
  matchIntentSignals,
  mergeRequiredCapabilityIds,
  buildCapabilityFixPrompt,
  buildObjectSpatialCardsFromScene,
  buildObjectSpatialCardsFromSceneJson,
  buildSceneScaleProfile,
  pickReferenceObjects,
  buildPlacementHints,
  classifyTurnIntent,
  summarizeSceneTurn,
  generateSceneTitle,
  buildStructuredTurnEnvelope
};

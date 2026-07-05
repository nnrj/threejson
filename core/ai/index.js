/**
 * Scene AI client entry: generate / update scene JSON (mounts `window.ThreeJsonAI` in the browser).
 */
import {
  generateSceneJsonString,
  generateSceneJsonFromImage,
  updateSceneJsonString,
  requestUpdatedSceneEditCommands,
  extractJsonText,
  parseSceneJsonString,
  resolveVisionImageUrl
} from "./sceneAiService.js";
import {
  buildSceneCommandSkillFragment,
  buildSceneCommandAutoUpdateSystemPrompt,
  buildSceneCommandUpdateSystemPrompt,
  buildSceneCommandUpdateUserMessage,
  extractCommandScriptText,
  isLikelyCommandScriptText,
  resolveOutputKind
} from "./sceneCommandSkill.js";
import {
  planTextures,
  fillTextureUrls,
  createOpenAiImageProvider,
  normalizeImageRawToBlob,
  listTextureUrlPointers,
  toSiteRelativeTexturePath
} from "./textureAiService.js";
import {
  createDirectorySink,
  createUploadSink,
  createZipDownloadSink
} from "./browserTextureSink.js";
import { runSceneAgent } from "./sceneAgent.js";
import { resolveAgentDepth } from "./agentDepth.js";
import {
  validateSceneJson,
  listTexturePointersSummary,
  summarizeSchema,
  planTexturesDry,
  evaluateSceneCapabilityFit,
  buildCapabilityFixPrompt
} from "./agentTools.js";
import {
  buildIntentHints,
  analyzeSceneUsage,
  evaluateCapabilityFit,
  matchIntentSignals
} from "./sceneCapability.js";

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
    async planTextures(sceneJsonStringOrObject, userHint, options = {}) {
      return planTextures(sceneJsonStringOrObject, userHint, { ...defaultOptions, ...options });
    },
    async fillTextureUrls(sceneJsonStringOrObject, options = {}) {
      return fillTextureUrls(sceneJsonStringOrObject, { ...defaultOptions, ...options });
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
    planTextures,
    fillTextureUrls,
    createOpenAiImageProvider,
    normalizeImageRawToBlob,
    listTextureUrlPointers,
    resolveVisionImageUrl,
    runSceneAgent,
    resolveAgentDepth,
    validateSceneJson,
    listTexturePointersSummary,
    summarizeSchema,
    planTexturesDry,
    evaluateSceneCapabilityFit,
    buildIntentHints,
    analyzeSceneUsage,
    evaluateCapabilityFit,
    matchIntentSignals,
    buildCapabilityFixPrompt,
    createDirectorySink,
    createUploadSink,
    createZipDownloadSink,
    toSiteRelativeTexturePath
  };
}

export {
  createSceneAiClient,
  generateSceneJsonString,
  generateSceneJsonFromImage,
  updateSceneJsonString,
  requestUpdatedSceneEditCommands,
  buildSceneCommandSkillFragment,
  buildSceneCommandAutoUpdateSystemPrompt,
  buildSceneCommandUpdateSystemPrompt,
  buildSceneCommandUpdateUserMessage,
  extractCommandScriptText,
  isLikelyCommandScriptText,
  resolveOutputKind,
  extractJsonText,
  parseSceneJsonString,
  planTextures,
  fillTextureUrls,
  createOpenAiImageProvider,
  normalizeImageRawToBlob,
  listTextureUrlPointers,
  resolveVisionImageUrl,
  runSceneAgent,
  resolveAgentDepth,
  validateSceneJson,
  listTexturePointersSummary,
  summarizeSchema,
  planTexturesDry,
  evaluateSceneCapabilityFit,
  buildIntentHints,
  analyzeSceneUsage,
  evaluateCapabilityFit,
  matchIntentSignals,
  buildCapabilityFixPrompt,
  createDirectorySink,
  createUploadSink,
  createZipDownloadSink,
  toSiteRelativeTexturePath
};

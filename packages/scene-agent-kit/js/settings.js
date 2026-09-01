export const SCENE_AGENT_SETTINGS_DEFAULTS = Object.freeze({
  ai: {
    thinkingPreference: "disabled",
    sceneGenerationMode: "auto",
    sceneMaxOutputTokens: 0,
    updateOutputMode: "commands",
    includeSpatialSummary: true,
    includeFullJson: false,
    globalPromptPrefix: "",
    includeTurnSummary: true,
    autoGenerateSceneTitle: true,
    sceneTitleLanguage: "auto",
    attachReferenceLinks: true,
    capabilityLookupEnabled: true,
    animationCapabilityMode: "auto",
    texturePipelineEnabled: true,
    textureStrategy: "semantic-hybrid",
    textureServiceUrl: "",
    textureServiceApiKey: "",
    textureLocalCache: true,
    textureAllowUnknownLicense: false,
    texturePersistenceMode: "remote",
    texturePbr: true,
    complexModelStrategy: "auto",
    modelQuality: "balanced",
    modelBudget: { maxTokens: 0, maxCost: 0, maxTimeMs: 0 },
    maxSceneSegments: 0,
    maxAutoRefineRounds: 0,
    agentPolicyVersion: 3
  },
  io: {
    exportJsonIndent: 2,
    sceneJsonFormat: "standard",
    tjzAssetPolicy: "preserve",
    showMeshExportWarnings: true,
    turnCacheMode: "full",
    turnDiffCheckpointInterval: 12,
    jsonViewerLineNumbers: true,
    jsonViewerHighlight: true
  }
});

const ENUMS = {
  "ai.thinkingPreference": new Set(["disabled", "high", "max", "inherit"]),
  "ai.sceneGenerationMode": new Set(["auto", "direct", "draft_refine"]),
  "ai.complexModelStrategy": new Set(["auto", "full-coordinates", "progressive"]),
  "ai.modelQuality": new Set(["draft", "balanced", "high", "custom"]),
  "ai.updateOutputMode": new Set(["commands", "json-incremental", "json-full"]),
  "ai.animationCapabilityMode": new Set(["auto", "on", "off"]),
  "ai.textureStrategy": new Set(["semantic-hybrid", "manifest", "search", "generate"]),
  "ai.texturePersistenceMode": new Set(["remote", "archive-selected", "archive-all"]),
  "io.sceneJsonFormat": new Set(["standard", "friendly"]),
  "io.tjzAssetPolicy": new Set(["preserve", "tryPack"]),
  "io.turnCacheMode": new Set(["full", "diff"])
};

function clone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function finiteInt(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

export function normalizeSceneAgentSettings(input = {}) {
  const defaults = clone(SCENE_AGENT_SETTINGS_DEFAULTS);
  const selectKnown = (section, source) => Object.fromEntries(
    Object.keys(section).map((key) => [
      key,
      source && Object.prototype.hasOwnProperty.call(source, key) ? source[key] : section[key]
    ])
  );
  const result = {
    ai: selectKnown(defaults.ai, input.ai),
    io: selectKnown(defaults.io, input.io)
  };
  for (const [path, allowed] of Object.entries(ENUMS)) {
    const [section, key] = path.split(".");
    if (!allowed.has(result[section][key])) result[section][key] = defaults[section][key];
  }
  result.ai.sceneMaxOutputTokens = finiteInt(result.ai.sceneMaxOutputTokens, 0, 0, Number.MAX_SAFE_INTEGER);
  result.ai.maxSceneSegments = finiteInt(result.ai.maxSceneSegments, 0, 0, Number.MAX_SAFE_INTEGER);
  result.ai.maxAutoRefineRounds = finiteInt(result.ai.maxAutoRefineRounds, 0, 0, Number.MAX_SAFE_INTEGER);
  const modelBudget = result.ai.modelBudget && typeof result.ai.modelBudget === "object"
    ? result.ai.modelBudget
    : {};
  result.ai.modelBudget = {
    maxTokens: finiteInt(modelBudget.maxTokens, 0, 0, Number.MAX_SAFE_INTEGER),
    maxCost: Number.isFinite(Number(modelBudget.maxCost)) && Number(modelBudget.maxCost) > 0
      ? Number(modelBudget.maxCost)
      : 0,
    maxTimeMs: finiteInt(modelBudget.maxTimeMs, 0, 0, Number.MAX_SAFE_INTEGER)
  };
  result.ai.agentPolicyVersion = 3;
  result.io.turnDiffCheckpointInterval = finiteInt(
    result.io.turnDiffCheckpointInterval,
    12,
    0,
    Number.MAX_SAFE_INTEGER
  );
  return result;
}

export function resolveSceneAgentOptions(settings = {}) {
  const normalized = normalizeSceneAgentSettings(settings);
  return {
    ...(normalized.ai.maxAutoRefineRounds > 0
      ? { maxRefineRounds: normalized.ai.maxAutoRefineRounds }
      : {}),
    complexModelStrategy: normalized.ai.complexModelStrategy,
    modelQuality: normalized.ai.modelQuality,
    modelBudget: {
      maxTokens: normalized.ai.modelBudget.maxTokens || undefined,
      maxCost: normalized.ai.modelBudget.maxCost || undefined,
      maxTimeMs: normalized.ai.modelBudget.maxTimeMs || undefined
    }
  };
}

export function resolveSceneAgentTokenOptions(settings = {}) {
  const normalized = normalizeSceneAgentSettings(settings);
  return normalized.ai.sceneMaxOutputTokens > 0 ? { maxTokens: normalized.ai.sceneMaxOutputTokens } : {};
}

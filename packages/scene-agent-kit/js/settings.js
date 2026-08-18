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
    maxSceneSegments: 16,
    maxAutoRefineRounds: 6,
    agentPolicyVersion: 2
  },
  io: {
    exportJsonIndent: 2,
    sceneJsonFormat: "standard",
    tjzAssetPolicy: "preserve",
    showMeshExportWarnings: true,
    turnCacheMode: "full",
    jsonViewerLineNumbers: true,
    jsonViewerHighlight: true
  }
});

const ENUMS = {
  "ai.thinkingPreference": new Set(["disabled", "high", "max", "inherit"]),
  "ai.sceneGenerationMode": new Set(["auto", "direct", "draft_refine"]),
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
  result.ai.maxSceneSegments = finiteInt(result.ai.maxSceneSegments, 16, 1, 64);
  result.ai.maxAutoRefineRounds = finiteInt(result.ai.maxAutoRefineRounds, 6, 1, 20);
  result.ai.agentPolicyVersion = 2;
  return result;
}

export function resolveSceneAgentOptions(settings = {}) {
  const normalized = normalizeSceneAgentSettings(settings);
  return { maxRefineRounds: normalized.ai.maxAutoRefineRounds };
}

export function resolveSceneAgentTokenOptions(settings = {}) {
  const normalized = normalizeSceneAgentSettings(settings);
  return normalized.ai.sceneMaxOutputTokens > 0 ? { maxTokens: normalized.ai.sceneMaxOutputTokens } : {};
}

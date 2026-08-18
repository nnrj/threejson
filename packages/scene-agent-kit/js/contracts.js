export const SCENE_AGENT_CONTRACT_VERSION = 1;

export const SCENE_AGENT_CAPABILITIES = Object.freeze([
  "turn.first-generation",
  "turn.negotiated-follow-up",
  "generation.direct",
  "generation.incremental",
  "generation.stream",
  "adjust.commands",
  "adjust.json-patch",
  "adjust.full-json",
  "adjust.live-runtime",
  "scene.progressive-preview",
  "scene.texture-follow-up",
  "history.full-snapshot",
  "history.command-diff",
  "turn.cancel-retry"
]);

export function createSceneAgentEvent(type, detail = {}) {
  return { type, at: Date.now(), ...detail };
}

export function isSceneAgentEvent(value) {
  return Boolean(value && typeof value === "object" && typeof value.type === "string");
}

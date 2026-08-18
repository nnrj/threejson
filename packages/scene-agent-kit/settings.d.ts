import type { SceneAgentSettings } from "./types.js";

export const SCENE_AGENT_SETTINGS_DEFAULTS: SceneAgentSettings;
export function normalizeSceneAgentSettings(input?: Record<string, unknown>): SceneAgentSettings;
export function resolveSceneAgentOptions(settings?: Record<string, unknown>): { maxRefineRounds: number };
export function resolveSceneAgentTokenOptions(settings?: Record<string, unknown>): { maxTokens?: number };

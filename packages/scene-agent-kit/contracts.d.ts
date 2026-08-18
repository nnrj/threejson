import type { SceneAgentEvent } from "./types.js";

export const SCENE_AGENT_CONTRACT_VERSION: number;
export const SCENE_AGENT_CAPABILITIES: readonly string[];
export function createSceneAgentEvent(type: string, detail?: Record<string, unknown>): SceneAgentEvent;
export function isSceneAgentEvent(value: unknown): value is SceneAgentEvent;

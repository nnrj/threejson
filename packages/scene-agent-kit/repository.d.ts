import type { SceneAgentIndexedDbFactory, SceneAgentRepository } from "./types.js";

export function createSceneAgentRepository(options: { dbName: string; indexedDb?: SceneAgentIndexedDbFactory | null }): SceneAgentRepository;
export function createTurnId(): string;
export function createResourceId(): string;
export function createConversationId(): string;
export function createProjectId(): string;

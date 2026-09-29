import type { ModelStorage } from "./models.js";
export function defaultAudioModelCache(): string;
export function createNodeAudioModelStorage(directory?: string): Promise<ModelStorage>;

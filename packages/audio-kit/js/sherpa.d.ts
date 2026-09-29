import type { AudioProducer } from "./index.js";
import type { AudioModelIdentity, AudioModelManager } from "./models.js";
export function createSherpaOnnxAudioProducer(options: { loadRuntime: () => Promise<unknown>; modelManager: AudioModelManager; model: AudioModelIdentity; config: Record<string, unknown>; capabilities?: Record<string, unknown> }): AudioProducer;

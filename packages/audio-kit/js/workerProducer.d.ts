import type { AudioProducer } from "./index.js";
export function createWorkerAudioProducer(options: { moduleUrl: string | URL; init?: unknown; capabilities?: Record<string, unknown>; createWorker?: () => Worker }): AudioProducer;

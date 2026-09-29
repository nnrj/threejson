import type { AudioProducer } from "./index.js";
export function createSoundFontAudioProducer(options: { soundFont: Blob | ArrayBuffer; loadCore: () => Promise<unknown>; capabilities?: Record<string, unknown> }): AudioProducer;

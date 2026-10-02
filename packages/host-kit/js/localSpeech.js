const preferenceKey = "threejson.localSpeechModel";
export function getLocalSpeechPreference() { try { return localStorage.getItem(preferenceKey); } catch { return null; } }
export function setLocalSpeechPreference(id) { if (id) localStorage.setItem(preferenceKey, id); else localStorage.removeItem(preferenceKey); }

/** Host policy: only a locally selected AND installed model is advertised.
 * Checking availability never downloads or initializes WASM.
 */
export async function createLocalNarrationHost() {
  const selected = getLocalSpeechPreference();
  if (!selected) return { available: false, dispose() {} };
  const sdk = await import("@threejson/audio-kit/models"), catalog = sdk.getBuiltinAudioModels();
  const model = catalog.find(m => m.id === selected);
  if (!model) return { available: false, dispose() {} };
  const manager = sdk.createAudioModelManager(await sdk.createBrowserAudioModelStorage());
  if ((await manager.status(model)).status !== "ready") { manager.close(); return { available: false, dispose() {} }; }
  let producer, disposed = false; const cache = new Map();
  return {
    available: true, model: model.id,
    async narrate(args, context) {
      if (disposed) throw new Error("Narration host disposed.");
      producer ??= await sdk.createLocalSpeechProducer({ modelManager: manager });
      const { synthesizeNarration } = await import("@threejson/media-kit");
      return synthesizeNarration(args.text, producer, { ...context, speed: args.speed, captionSentences: args.captions, cache });
    },
    dispose() { disposed = true; producer?.dispose(); cache.clear(); manager.close(); }
  };
}

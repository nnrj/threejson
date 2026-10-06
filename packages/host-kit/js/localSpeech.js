const preferenceKey = "threejson.localSpeechModel";
export function getLocalSpeechPreference() { try { return localStorage.getItem(preferenceKey); } catch { return null; } }
export function setLocalSpeechPreference(id) { if (id) localStorage.setItem(preferenceKey, id); else localStorage.removeItem(preferenceKey); }

const loadModels = () => import("@threejson/audio-kit/models");
const unavailable = () => ({ available: false, dispose() {} });

function narrationHost(sdk, manager, model, options = {}) {
  let producer, disposed = false; const cache = new Map();
  return {
    available: true, model: model.id,
    async narrate(args, context) {
      if (disposed) throw new Error("Narration host disposed.");
      producer ??= await sdk.createLocalSpeechProducer({ modelManager: manager, model });
      const synthesize = options.synthesizeNarration || (await import("@threejson/media-kit")).synthesizeNarration;
      return synthesize(args.text, producer, { ...context, speed: args.speed, captionSentences: args.captions, cache });
    },
    dispose() { if (disposed) return; disposed = true; producer?.dispose(); cache.clear(); manager.close(); }
  };
}

/** Explicit preview/export action only. A missing default voice is downloaded
 * and verified automatically. Merely opening the dialog/Agent never calls this.
 * Export preparation does not change the Agent's opt-in voice preference.
 */
export async function prepareDefaultLocalNarrationHost(options = {}) {
  options.signal?.throwIfAborted();
  const sdk = await (options.loadModels || loadModels)();
  const catalog = sdk.getBuiltinAudioModels();
  const selected = (options.getPreference || getLocalSpeechPreference)();
  const model = catalog.find(item => item.id === selected) || catalog[0];
  if (!model) throw Object.assign(new Error("No export speech engine is available."), { code: "LOCAL_NARRATION_UNAVAILABLE" });
  const manager = await (options.createManager ? options.createManager(sdk) : sdk.createBrowserAudioModelStorage().then(storage => sdk.createAudioModelManager(storage)));
  try {
    options.signal?.throwIfAborted();
    if ((await manager.status(model)).status !== "ready") {
      const total = model.files.reduce((sum, file) => sum + file.bytes, 0), loaded = new Map();
      const progress = value => {
        if (value) loaded.set(value.role, value.loaded);
        const bytes = [...loaded.values()].reduce((sum, size) => sum + size, 0);
        options.onProgress?.({ stage: "model-download", loaded: bytes, total, progress: total ? bytes / total : 0 });
      };
      progress();
      try { await manager.download(model, { signal: options.signal, onProgress: progress }); }
      catch (cause) {
        if (cause.name === "AbortError" || options.signal?.aborted) throw cause;
        throw Object.assign(new Error("The speech resource download failed. Retry or import the resources in advanced settings.", { cause }), { code: "LOCAL_NARRATION_DOWNLOAD_FAILED" });
      }
    }
    options.signal?.throwIfAborted();
    return narrationHost(sdk, manager, model, options);
  } catch (error) { manager.close(); throw error; }
}

/** Host policy: only a locally selected AND installed model is advertised.
 * Checking availability never downloads or initializes WASM.
 */
export async function createLocalNarrationHost(options = {}) {
  const selected = (options.getPreference || getLocalSpeechPreference)();
  if (!selected) return unavailable();
  const sdk = await (options.loadModels || loadModels)(), catalog = sdk.getBuiltinAudioModels();
  const model = catalog.find(m => m.id === selected);
  if (!model) return unavailable();
  const manager = await (options.createManager ? options.createManager(sdk) : sdk.createBrowserAudioModelStorage().then(storage => sdk.createAudioModelManager(storage)));
  try {
    if ((await manager.status(model)).status !== "ready") { manager.close(); return unavailable(); }
    return narrationHost(sdk, manager, model, options);
  } catch (error) { manager.close(); throw error; }
}

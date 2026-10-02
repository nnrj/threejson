import { getBuiltinAudioModels } from "./modelCatalog.js";
import { createWorkerAudioProducer } from "./workerProducer.js";

/** Host-selected pinned runtime. No downloads: explicitly install the model first. */
export function createMeloTtsProducer({ modelManager, createWorker } = {}) {
  if (!modelManager?.acquire) throw new TypeError("A local model manager is required.");
  const model = getBuiltinAudioModels()[0]; let worker, lease, busy = false, disposed = false;
  const release = () => { worker?.dispose(); worker = null; lease?.release(); lease = null; };
  return {
    capabilities: { kind: "tts", local: true, output: "pcm", languages: ["zh-CN", "en"], model: model.id, modelVersion: model.version },
    async synthesize(recipe, context = {}) {
      if (busy || disposed) throw new Error(disposed ? "Local speech disposed." : "Local speech is busy.");
      busy = true;
      try {
        context.signal?.throwIfAborted();
        if (!worker) {
          lease = await modelManager.acquire(model);
          context.signal?.throwIfAborted();
          if (disposed) throw new DOMException("Local speech disposed.", "AbortError");
          for (const expected of model.files) {
            const saved = lease.manifest.files.find(f => f.role === expected.role);
            if (saved?.sha256 !== expected.sha256 || saved?.bytes !== expected.bytes) throw new Error("Installed model does not match the pinned local speech runtime.");
          }
          worker = createWorkerAudioProducer({ moduleUrl: "builtin:melo", init: { files: lease.files },
            createWorker: createWorker || (() => new Worker(new URL("./meloWorker.js", import.meta.url), { type: "module" })) });
        }
        return await worker.synthesize(recipe, context);
      } catch (error) { release(); throw error; }
      finally { busy = false; if (disposed) release(); }
    },
    dispose() { disposed = true; release(); }
  };
}

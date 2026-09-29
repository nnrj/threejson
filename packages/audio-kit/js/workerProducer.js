/** Host-owned module URL, never read from scene JSON. Each job is cancellable. */
export function createWorkerAudioProducer({ moduleUrl, init, capabilities = {}, createWorker } = {}) {
  if (!moduleUrl) throw new TypeError("A host audio producer module URL is required.");
  let worker, pending, ready, disposed = false, serial = 0;
  function stop(error = new DOMException("Audio worker disposed", "AbortError")) {
    worker?.terminate(); worker = null; ready = null;
    if (pending) { const task = pending; pending = null; task.reject(error); }
  }
  function call(message) {
    return new Promise((resolve, reject) => { const id = ++serial; pending = { id, resolve, reject }; worker.postMessage({ ...message, id }); });
  }
  async function prepare() {
    worker = createWorker?.() || new Worker(new URL("./audioProducerWorker.js", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }) => {
      if (data.id !== pending?.id) return;
      if (data.progress !== undefined) { pending.onProgress?.(data.progress); return; }
      const task = pending; pending = null;
      data.error ? task.reject(Object.assign(new Error(data.error.message), { code: data.error.code })) : task.resolve(data.value);
    };
    worker.onerror = (event) => { event.preventDefault?.(); stop(new Error(event.message || "Audio worker failed.")); };
    await call({ op: "init", moduleUrl: String(moduleUrl), init });
  }
  let active = false;
  return {
    capabilities: { local: true, output: "pcm", ...capabilities },
    async synthesize(recipe, context = {}) {
      if (disposed) throw new Error("Audio producer is disposed.");
      if (active) throw Object.assign(new Error("Audio producer is busy."), { code: "AUDIO_PRODUCER_BUSY" });
      active = true; const abort = () => stop(context.signal.reason);
      try {
        context.signal?.throwIfAborted(); context.signal?.addEventListener("abort", abort, { once: true });
        ready ??= prepare(); await ready; context.signal?.throwIfAborted();
        const result = call({ op: "synthesize", recipe }); pending.onProgress = context.onProgress;
        return await result;
      } catch(error) { stop(error); throw error; }
      finally { active = false; context.signal?.removeEventListener("abort", abort); }
    },
    dispose() { disposed = true; stop(); }
  };
}

import { modelingError } from "./registry.js";

/** One serial worker queue. Abort terminates real computation; other queued jobs survive. */
export function createWorkerModelingCompiler({ workerFactory, startupTimeoutMs = 10000 } = {}) {
  let worker, ready = false, timer, active, disposed = false, sequence = 0;
  const queue = [];
  const stop = () => { clearTimeout(timer); worker?.terminate(); worker = null; ready = false; };
  const finish = (job, error, value) => {
    job.signal?.removeEventListener("abort", job.abort);
    if (active === job) active = null;
    if (error) job.reject(error); else job.resolve(value);
    pump();
  };
  const fail = (error) => {
    stop();
    if (active) finish(active, error);
    else for (const job of queue.splice(0)) finish(job, error);
  };
  function pump() {
    if (disposed || active || !queue.length) return;
    if (!worker) {
      try {
        worker = workerFactory ? workerFactory() : new Worker(new URL("./modeling.worker.bundle.js", import.meta.url), { type: "module", name: "ThreeJSON modeling" });
        const current = worker;
        worker.addEventListener("message", ({ data }) => {
          if (worker !== current) return;
          if (data.type === "ready") { clearTimeout(timer); ready = true; pump(); return; }
          if (!active || data.id !== active.id) return;
          if (data.type === "progress") { try { active.onProgress?.(data.event); } catch { /* observer */ } }
          else if (data.type === "result") finish(active, null, data.result);
          else if (data.type === "error") finish(active, modelingError(data.error.code || "MODEL_WORKER_FAILED", data.error.message, { nodeId: data.error.nodeId }));
        });
        worker.addEventListener("error", (event) => { if (worker === current) fail(modelingError("MODEL_WORKER_FAILED", event.message || "Modeling worker failed.")); });
        worker.addEventListener("messageerror", () => { if (worker === current) fail(modelingError("MODEL_WORKER_PROTOCOL", "Unreadable modeling worker response.")); });
        timer = setTimeout(() => { if (worker === current) fail(modelingError("MODEL_WORKER_STARTUP", "Modeling worker did not initialize; check worker-src and asset deployment.")); }, startupTimeoutMs);
      } catch (error) { fail(error); }
      return;
    }
    if (!ready) return;
    active = queue.shift();
    try { worker.postMessage({ type: "compile", id: active.id, graph: active.graph, options: active.options }); }
    catch (error) { finish(active, error); }
  }
  return {
    compile(graph, options = {}) {
      if (disposed) return Promise.reject(modelingError("MODEL_COMPILER_DISPOSED", "Modeling worker compiler is disposed."));
      if (options.signal?.aborted) return Promise.reject(options.signal.reason);
      return new Promise((resolve, reject) => {
        const job = { id: ++sequence, graph: structuredClone(graph), options: { modelId: options.modelId || "default", quality: options.quality || "balanced", backend: options.backend || "cpu", ...(options.parameters ? { parameters: structuredClone(options.parameters) } : {}) },
          signal: options.signal, onProgress: options.onProgress, resolve, reject };
        job.abort = () => {
          if (active === job) { stop(); finish(job, job.signal.reason); }
          else { const i = queue.indexOf(job); if (i >= 0) queue.splice(i, 1); finish(job, job.signal.reason); }
        };
        job.signal?.addEventListener("abort", job.abort, { once: true }); queue.push(job); pump();
      });
    },
    dispose() { if (disposed) return; disposed = true; stop(); const pending = active ? [active, ...queue.splice(0)] : queue.splice(0); active = null; for (const job of pending) finish(job, new DOMException("Modeling worker disposed.", "AbortError")); }
  };
}

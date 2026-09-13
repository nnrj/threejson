import { COMPILED_GEOMETRY_TYPES, geometryInputRecord } from "./geometryInput.js";
import { deserializeGeometryResult } from "./geometryTransfer.js";

const aborted = () => new DOMException("Geometry compilation cancelled.", "AbortError");
const compilerError = (code, message) => Object.assign(new Error(message), { code });

/** Optional, lazy single-worker queue. Cancelling a running job terminates its computation;
 * queued jobs are retained and execute in a replacement worker. No model-size or quality limits. */
export function createWorkerGeometryCompiler(options = {}) {
  let worker = null, ready = false, active = null, disposed = false, nextId = 0, bootstrapTimer = null;
  const queue = [];
  const report = (diagnostic) => { try { options.onDiagnostic?.(diagnostic); } catch { /* observer only */ } };
  function stopWorker() {
    clearTimeout(bootstrapTimer); bootstrapTimer = null;
    worker?.terminate(); worker = null; ready = false;
  }
  function finish(job, error, value) {
    job.signal?.removeEventListener("abort", job.abort);
    if (active === job) active = null;
    if (error) job.reject(error); else job.resolve(value);
    pump();
  }
  function fail(error) {
    stopWorker();
    if (active) finish(active, error);
    else {
      const pending = queue.splice(0);
      for (const job of pending) { job.signal?.removeEventListener("abort", job.abort); job.reject(error); }
    }
    report({ code: error.code || "GEOMETRY_WORKER_FAILED", message: error.message });
  }
  function startWorker() {
    try {
      worker = options.workerFactory ? options.workerFactory()
        : new Worker(new URL("./geometry.worker.bundle.js", import.meta.url), { type: "module", name: "ThreeJSON geometry" });
      const instance = worker;
      worker.addEventListener("error", (event) => { if (worker === instance) fail(compilerError(ready ? "GEOMETRY_WORKER_FAILED" : "GEOMETRY_WORKER_UNAVAILABLE", event.message || "Geometry worker failed.")); });
      worker.addEventListener("messageerror", () => { if (worker === instance) fail(compilerError("GEOMETRY_WORKER_PROTOCOL", "Geometry worker returned an unreadable message.")); });
      worker.addEventListener("message", ({ data }) => {
        if (worker !== instance) return;
        if (data?.type === "ready") { clearTimeout(bootstrapTimer); ready = true; pump(); return; }
        const job = active;
        if (!job || data?.id !== job.id) return;
        try {
          if (data.type === "error") finish(job, compilerError(data.error.code || "GEOMETRY_BUILD_FAILED", data.error.message));
          else if (data.type === "result") {
            const result = deserializeGeometryResult(data.result);
            if (!result.geometry) finish(job, compilerError(result.code || "GEOMETRY_BUILD_FAILED", result.error));
            else finish(job, null, result);
          }
        } catch (error) { finish(job, error); }
      });
      // This bounds a broken worker bootstrap, not mesh computation. Compilation has no default timeout.
      bootstrapTimer = setTimeout(() => fail(compilerError("GEOMETRY_WORKER_STARTUP", "Geometry worker did not start. Check its URL and the host's worker-src policy.")), options.startupTimeoutMs ?? 10000);
    } catch (error) { fail(compilerError("GEOMETRY_WORKER_UNAVAILABLE", String(error?.message || error))); }
  }
  function pump() {
    if (disposed || active || !queue.length) return;
    if (!worker) { startWorker(); return; }
    if (!ready) return;
    active = queue.shift();
    try { worker.postMessage({ type: "compile", id: active.id, record: active.record, options: { meshBudget: active.meshBudget } }); }
    catch (error) { finish(active, error); }
  }
  return {
    supports(record) { return COMPILED_GEOMETRY_TYPES.has(String(record?.objType || "").toLowerCase()); },
    compile(record, settings = {}) {
      if (disposed) return Promise.reject(compilerError("GEOMETRY_COMPILER_DISPOSED", "Geometry compiler is disposed."));
      if (!this.supports(record)) return Promise.reject(compilerError("GEOMETRY_COMPILER_UNSUPPORTED", "This descriptor is not supported by the geometry worker."));
      if (settings.signal?.aborted) return Promise.reject(settings.signal.reason || aborted());
      return new Promise((resolve, reject) => {
        // Clone at submission, not after a queued user edit has mutated its source.
        const job = { id: ++nextId, record: structuredClone(geometryInputRecord(record)), meshBudget: structuredClone(settings.meshBudget), signal: settings.signal, resolve, reject };
        job.abort = () => {
          if (active === job) { stopWorker(); finish(job, job.signal.reason || aborted()); }
          else { const index = queue.indexOf(job); if (index >= 0) queue.splice(index, 1); job.signal.removeEventListener("abort", job.abort); reject(job.signal.reason || aborted()); }
          if (!active && !queue.length) stopWorker();
        };
        job.signal?.addEventListener("abort", job.abort, { once: true });
        queue.push(job); pump();
      });
    },
    dispose() {
      if (disposed) return; disposed = true; stopWorker();
      const jobs = active ? [active, ...queue.splice(0)] : queue.splice(0); active = null;
      for (const job of jobs) { job.signal?.removeEventListener("abort", job.abort); job.reject(aborted()); }
    }
  };
}

/** Explicit fallback for environments whose CSP/Worker API cannot load the optional bundle.
 * This uses the same evaluators but runs on the calling thread; it never simplifies the mesh. */
export function createDirectGeometryCompiler() {
  return {
    supports(record) { return COMPILED_GEOMETRY_TYPES.has(String(record?.objType || "").toLowerCase()); },
    async compile(record, options = {}) {
      options.signal?.throwIfAborted();
      const editable = String(record.objType).toLowerCase() === "editablemesh";
      const evaluate = editable
        ? (await import("./editableMeshGeometry.js")).evaluateEditableMeshGeometry
        : (await import("./proceduralMeshGeometry.js")).evaluateProceduralMeshGeometry;
      options.signal?.throwIfAborted();
      const built = evaluate(record, options);
      if (!built.geometry) throw compilerError(built.code || "GEOMETRY_BUILD_FAILED", built.error);
      return built;
    },
    dispose() {}
  };
}

import { compileAuthoring } from "threejson/document";
import { createRuntimeSceneSession, captureSceneSession, executeSceneSessionCommands, diffSceneDocuments, applySceneSessionTextureAssignment } from "threejson/session";
import { captureSceneCardPreview } from "./sceneViewportPool.js";
import { sceneHostGeometryCompiler } from "./sceneGeometryCompiler.js";

/** Framework-independent document ownership and serialized, cancellable card operations. */
export function createSceneCardSession(options = {}) {
  let session = null, queue = Promise.resolve(), active = null, disposed = false;
  let renderOptions = {}, loadController = null, preview = null, playback = null;
  let unsubscribeDiagnostics = null;
  const pool = options.viewportPool, poolKey = {};
  const assertOpen = () => { if (disposed) throw new DOMException("Scene card disposed.", "AbortError"); };
  const notifyDocument = () => options.onDocumentChanged?.(captureSceneSession(session));
  const enqueue = (callback) => {
    const task = queue.then(() => { assertOpen(); return callback(); });
    queue = task.catch(() => {}); return task;
  };
  const publishState = () => options.onViewportStateChanged?.({ dormant: !session?.runtime, preview });
  const suspend = () => enqueue(() => {
    if (session?.runtime) {
      playback = session.capturePlayback();
      preview = (options.capturePreview || captureSceneCardPreview)(session.runtime, session.runtime.renderer?.domElement) || preview;
      session.suspendRuntime();
    }
    publishState();
  });
  const unregister = pool?.register(poolKey, suspend);
  const runLive = (callback) => pool
    ? pool.run(poolKey, () => enqueue(callback), options.getViewportLimit?.() ?? options.maxActiveViewports)
    : enqueue(callback);
  const activate = async (settings = {}) => {
    if (session && !session.runtime) { await options.beforePrepare?.(settings); await session.prepare({ signal: settings.signal }); }
    publishState(); return session?.runtime || null;
  };
  const driverOptions = {
    geometryCompiler: sceneHostGeometryCompiler,
    ...options,
    createRuntime: async (document, runtimeOptions) => {
      const configuration = options.getRuntimeOptions?.(renderOptions) || {};
      await options.ensureCapabilities?.(document);
      runtimeOptions.signal?.throwIfAborted();
      const create = options.createRuntime || (await import("threejson")).createJsonScene;
      return create(document, { ...runtimeOptions, ...configuration, canvas: runtimeOptions.canvas, signal: runtimeOptions.signal });
    },
    onRuntimeChanged: (next, previous) => {
      unsubscribeDiagnostics?.(); unsubscribeDiagnostics = null;
      if (next) {
        const store = next.runtimeContext?.diagnostics;
        if (store) unsubscribeDiagnostics = store.subscribe((items) => options.onDiagnosticsChanged?.(items));
        else options.onDiagnosticsChanged?.([]);
      }
      if (next && playback?.camera) {
        next.camera?.position.fromArray(playback.camera.position);
        next.camera?.quaternion.fromArray(playback.camera.quaternion);
        if (next.camera) { next.camera.zoom = playback.camera.zoom; next.camera.updateProjectionMatrix(); }
        if (playback.target) next.controls?.target?.fromArray(playback.target);
        next.controls?.update?.(); playback = null;
      }
      options.onRuntimeChanged?.(next, previous);
      // During initial creation session is not assigned yet; use the committed runtime.
      options.onViewportStateChanged?.({ dormant: !next, preview });
    }
  };
  return {
    get runtime() { return session?.runtime || null; },
    get session() { return session; },
    get document() { return session?.document || null; },
    render(input, settings = {}) {
      const document = compileAuthoring(input); // capture now; caller mutation cannot change queued work
      loadController?.abort(new DOMException("Replaced by a newer card render.", "AbortError"));
      const controller = new AbortController(); loadController = controller;
      return (settings.defer === true ? enqueue : runLive)(async () => {
        controller.signal.throwIfAborted(); active = controller; renderOptions = { ...settings };
        const abort = () => controller.abort(settings.signal.reason);
        if (settings.signal?.aborted) abort(); else settings.signal?.addEventListener("abort", abort, { once: true });
        try {
          if (settings.defer !== true) await options.beforePrepare?.(settings);
          controller.signal.throwIfAborted(); assertOpen();
          if (!session) {
            session = await createRuntimeSceneSession(document, { ...driverOptions, signal: controller.signal, deferInitial: settings.defer === true });
            session.subscribe(notifyDocument); notifyDocument();
          } else {
            const operations = diffSceneDocuments(session.document, document);
            if (operations.length) await session.dispatch({ operations, baseRevision: session.revision, signal: controller.signal, label: settings.label });
            if (settings.defer !== true && (!session.runtime || settings.force === true)) await session.prepare({ signal: controller.signal });
          }
          publishState();
          return session.runtime;
        } finally {
          settings.signal?.removeEventListener("abort", abort);
          if (active === controller) active = null;
          if (loadController === controller) loadController = null;
        }
      });
    },
    execute(commands, settings = {}) {
      const captured = structuredClone(commands);
      return runLive(async () => {
        await activate(settings);
        if (!session?.runtime) return { ok: false, sceneMutated: false, results: [], error: "Scene preview runtime is not ready." };
        return executeSceneSessionCommands(session, captured, settings);
      });
    },
    update(input, settings = {}) {
      const document = compileAuthoring(input);
      return enqueue(async () => {
        if (!session) throw new Error("Scene preview runtime is not ready.");
        await session.dispatch({ operations: diffSceneDocuments(session.document, document), baseRevision: settings.baseRevision ?? session.revision, signal: settings.signal, label: settings.label || "Update scene document" });
        return captureSceneSession(session);
      });
    },
    applyTextureAssignment(assignment, settings = {}) {
      return runLive(async () => {
        await activate(settings);
        if (!session?.runtime) throw new Error("Scene preview runtime is not ready.");
        return applySceneSessionTextureAssignment(session, assignment, settings);
      });
    },
    export() { return session ? captureSceneSession(session) : null; },
    suspend() { return pool ? pool.suspend(poolKey) : suspend(); },
    resume(settings = {}) { return runLive(() => activate(settings)); },
    withRuntime(callback, settings = {}) { return runLive(async () => { const runtime = await activate(settings); if (!runtime) throw new Error("Scene preview runtime is not ready."); return callback(runtime); }); },
    setViewportLimit(value) { return pool?.setLimit(value); },
    get preview() { return preview; },
    dispose() {
      if (disposed) return; disposed = true;
      active?.abort(new DOMException("Scene card disposed.", "AbortError"));
      loadController?.abort(new DOMException("Scene card disposed.", "AbortError"));
      unregister?.();
      unsubscribeDiagnostics?.(); unsubscribeDiagnostics = null;
      session?.dispose(); session = null;
    }
  };
}

/** Native and React hosts share the same staging-canvas lifecycle. */
export function createSceneCardViewport(mount, options = {}) {
  if (!mount) throw new Error("Scene card viewport mount is not available.");
  const canvas = document.createElement("canvas");
  canvas.className = "sceneCardCanvas";
  const rect = mount.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width || 320)), height = Math.max(1, Math.round(rect.height || 180));
  Object.assign(canvas.style, { position: "absolute", inset: "0", width: `${width}px`, height: `${height}px`, visibility: "hidden", pointerEvents: "none" });
  canvas.width = width; canvas.height = height; mount.appendChild(canvas);
  return {
    canvas,
    options: { viewportSize: { width, height } },
    commit(runtime) {
      canvas.style.visibility = "visible"; canvas.style.pointerEvents = "auto";
      options.onCanvasChanged?.(canvas); runtime.resize?.({ width, height }); runtime.renderOnce?.();
    },
    rollback(previous) { options.onCanvasChanged?.(previous?.renderer?.domElement || null); },
    dispose() { canvas.remove(); }
  };
}

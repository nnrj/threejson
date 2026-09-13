import { documentError } from "../document/sceneDocument.js";
import { formatAuthoring } from "../document/authoringAdapters.js";
import { prepareIncrementalSceneChanges } from "./sceneIncrementalPreparation.js";

/** Runtime adapter for SceneSession. Heavy compilation is prepared separately from the visible runtime. */
export function createSceneSessionRuntimeDriver(options = {}) {
  let runtime = options.initialRuntime || null;
  let activeViewport = options.initialViewport || null;
  let disposed = false;
  let deferred = options.deferInitial === true;
  return {
    get runtime() { return runtime; },
    async prepare(document, context = {}) {
      if (disposed) throw documentError("SESSION_DISPOSED", "Runtime driver is disposed.");
      if (deferred && !runtime && context.mode) return {};
      if (context.previousDocument && runtime) {
        const operations = context.operations.filter((operation) => !/^\/(?:schemaVersion|name|label|metadata)(?:\/|$)/.test(operation.path || ""));
        if (!operations.length) return {};
        context = { ...context, operations };
      }
      if (context.previousDocument && runtime && options.incremental !== false) {
        const changes = await prepareIncrementalSceneChanges(runtime, document, context, { ...options, ...context.prepareOptions });
        if (changes) return changes;
      }
      const previous = runtime;
      const previousViewport = activeViewport;
      // Reusing the visible canvas during asynchronous preparation would clear the
      // last good frame. A graphical host supplies a fresh staging canvas instead.
      if (previous && options.canvas && typeof options.createViewport !== "function") {
        throw documentError("TRANSACTION_VIEWPORT_REQUIRED", "Scene replacement requires createViewport() to prepare a separate canvas; transform-only edits reuse the current viewport.");
      }
      const viewport = await options.createViewport?.({ document, previousRuntime: previous, signal: context.signal });
      const create = options.createRuntime || (await import("../handler/sceneLoadHandler.js")).createJsonScene;
      let next;
      try {
        context.signal?.throwIfAborted();
        next = await create(formatAuthoring(document, { format: "standard" }), {
          ...options, ...context.prepareOptions, ...viewport?.options, canvas: viewport?.canvas || options.canvas, signal: context.signal
        });
        context.signal?.throwIfAborted();
      } catch (error) { next?.dispose?.(); viewport?.dispose?.(); throw error; }
      let committed = false, cleaned = false;
      const discard = () => {
        if (cleaned) return;
        cleaned = true;
        next.dispose?.(); viewport?.dispose?.();
      };
      return {
        commit() {
          if (disposed) throw documentError("SESSION_DISPOSED", "Runtime driver is disposed.");
          runtime = next;
          deferred = false;
          activeViewport = viewport || null;
          committed = true;
          viewport?.commit?.(next, previous);
          options.onRuntimeChanged?.(next, previous);
        },
        rollback() {
          if (committed) {
            runtime = previous; activeViewport = previousViewport; committed = false;
            viewport?.rollback?.(previous, next);
            options.onRuntimeChanged?.(previous, next);
          }
          discard();
        },
        dispose: discard,
        finalize() { if (committed) { previous?.dispose?.(); previousViewport?.dispose?.(); } }
      };
    },
    capturePlayback() {
      if (!runtime) return null;
      return { camera: runtime.camera ? { position: runtime.camera.position.toArray(), quaternion: runtime.camera.quaternion.toArray(), zoom: runtime.camera.zoom } : null,
        target: runtime.controls?.target?.toArray?.() || null };
    },
    suspend() {
      const previous = runtime; runtime = null; deferred = true;
      previous?.dispose?.(); activeViewport?.dispose?.(); activeViewport = null;
      options.onRuntimeChanged?.(null, previous);
    },
    dispose() { if (disposed) return; disposed = true; runtime?.dispose?.(); activeViewport?.dispose?.(); activeViewport = null; runtime = null; }
  };
}

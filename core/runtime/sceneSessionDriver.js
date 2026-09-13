import { indexSceneDocument, cloneDocumentData, documentError } from "../document/sceneDocument.js";
import { formatAuthoring } from "../document/authoringAdapters.js";
import { getObjectByThreeJsonId } from "../handler/objectRegistry.js";
import { applyObjectTransform } from "../builder/heatmap/heatmapTexture.js";

const TRANSFORM_FIELDS = new Set(["position", "rotation", "scale", "visible", "name"]);

function capturePose(object) {
  return { position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone(),
    visible: object.visible, name: object.name, descriptor: object.userData?.objJson };
}

function restorePose(object, state) {
  object.position.copy(state.position); object.quaternion.copy(state.quaternion); object.scale.copy(state.scale);
  object.visible = state.visible; object.name = state.name; object.userData.objJson = state.descriptor;
  object.updateMatrix(); object.updateMatrixWorld(true);
}

function prepareTransformChanges(runtime, document, operations) {
  if (!runtime?.scene || !operations.length) return null;
  const index = indexSceneDocument(document);
  const byPath = [...index.values()].sort((a, b) => b.path.length - a.path.length);
  const changed = new Map();
  for (const operation of operations) {
    if (!["add", "replace", "remove"].includes(operation.op)) return null;
    const entry = byPath.find((item) => operation.path.startsWith(`${item.path}/`));
    if (!entry || !TRANSFORM_FIELDS.has(operation.path.slice(entry.path.length + 1).split("/")[0])) return null;
    changed.set(entry.id, entry);
  }
  const staged = [];
  for (const entry of changed.values()) {
    const object = getObjectByThreeJsonId(entry.id, runtime.scene);
    if (!object) return null;
    const before = capturePose(object);
    // A lightweight pose container lets the same transform conversion run during
    // preparation without touching geometry, materials, descendants or animation state.
    const probe = { position: before.position.clone(), quaternion: before.quaternion.clone(),
      scale: before.scale.clone(), rotation: object.rotation.clone() };
    probe.rotation._onChange(() => probe.quaternion.setFromEuler(probe.rotation));
    applyObjectTransform(probe, entry.record);
    const values = [...probe.position.toArray(), ...probe.quaternion.toArray(), ...probe.scale.toArray()];
    if (values.some((value) => !Number.isFinite(value))) throw documentError("INVALID_TRANSFORM", `Non-finite transform for ${entry.id}.`);
    staged.push({ object, before, after: { ...probe, visible: entry.record.visible !== false,
      name: typeof entry.record.name === "string" ? entry.record.name : object.name, descriptor: cloneDocumentData(entry.record) } });
  }
  return {
    commit() {
      for (const { object, after } of staged) restorePose(object, after);
      runtime.invalidate?.();
    },
    rollback() { for (const { object, before } of staged) restorePose(object, before); runtime.invalidate?.(); }
  };
}

/** Runtime adapter for SceneSession. Heavy compilation is prepared separately from the visible runtime. */
export function createSceneSessionRuntimeDriver(options = {}) {
  let runtime = null;
  let activeViewport = null;
  let disposed = false;
  return {
    get runtime() { return runtime; },
    async prepare(document, context = {}) {
      if (disposed) throw documentError("SESSION_DISPOSED", "Runtime driver is disposed.");
      if (context.previousDocument && runtime && options.incrementalTransforms !== false) {
        const changes = prepareTransformChanges(runtime, document, context.operations);
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
          ...options, ...viewport?.options, canvas: viewport?.canvas || options.canvas, signal: context.signal
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
    dispose() { if (disposed) return; disposed = true; runtime?.dispose?.(); activeViewport?.dispose?.(); activeViewport = null; runtime = null; }
  };
}

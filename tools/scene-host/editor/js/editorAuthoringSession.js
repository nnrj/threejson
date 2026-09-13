import { compileAuthoring, formatAuthoring, indexSceneDocument } from "threejson/document";
import { SceneSession, diffSceneDocuments, executeSceneSessionCommands, applySceneSessionTextureAssignment } from "threejson/session";
import { createSceneSessionRuntimeDriver } from "../../../../core/runtime/sceneSessionDriver.js";
import { sceneToStandardJsonSimple, getObjectByThreeJsonId } from "threejson";
import { assertSceneExportableOrThrow } from "../../../../core/handler/domainDeployDescriptor.js";

/** Editor-owned authoring state. Drag previews may mutate live objects, but are
 * reconciled from their linked descriptors, never from unrelated playback poses. */
export function createEditorAuthoringSession(host) {
  let session = null, pending = Promise.resolve(), failure = null;
  const notify = () => {
    if (!session) return;
    host.getSysConfig().jsonData = formatAuthoring(session.document, { format: "standard" });
    host.getRightSidebarCache?.()?.invalidateRightSidebarSceneJsonTextCache?.();
    host.getEditorHistory?.()?.syncMenuState?.();
  };
  const enqueue = (callback) => {
    const owner = session;
    const task = pending.then(() => {
      if (!owner || owner !== session || owner.disposed) throw new DOMException("Scene changed.", "AbortError");
      return callback(owner);
    });
    pending = task.then(() => { failure = null; }, (error) => {
      if (owner !== session) return;
      failure = error;
      if (error?.name !== "AbortError") host.showMessage?.(`编辑未能提交：${error.message}`, "error");
    });
    // Many pointer event callers intentionally do not await a commit.
    task.catch(() => {});
    return task;
  };
  function attach(payload, runtime) {
    session?.dispose();
    const options = host.buildAuthoringRuntimeOptions?.() || {};
    const driver = createSceneSessionRuntimeDriver({ ...options, initialRuntime: runtime });
    session = new SceneSession(compileAuthoring(payload), {
      historyLimit: host.getEditorSettings()?.editing?.historyMaxDepth || 50,
      driver: {
        prepare(document, context) {
          // A completed direct manipulation already has its live preview. Only
          // that explicit host path adopts it; commands and undo always prepare.
          if (context.prepareOptions?.adoptRuntimeChanges) return {};
          return driver.prepare(document, context);
        },
        capturePlayback: () => driver.capturePlayback(),
        // The Editor owns current runtime teardown, not a discarded document handle.
        dispose() {}
      }
    });
    Object.defineProperty(session, "runtime", { get: () => driver.runtime });
    session.subscribe(() => { notify(); host.markSceneDirty?.(); });
    pending = Promise.resolve(); failure = null;
    notify();
    return session;
  }
  function recordRuntimeEdit(label = "编辑", options = {}) {
    if (!session) return Promise.resolve({ changed: false });
    let next;
    try {
      const payload = sceneToStandardJsonSimple(host.getScene(), {
        ...host.buildSceneToJsonOptions?.(), basePayload: host.getSysConfig()?.jsonData || session.document.root,
        runtimeTarget: host.getSceneRuntime?.(), merge: false, state: "authoring", assertExportable: false
      });
      next = compileAuthoring(payload);
    } catch (error) { return enqueue(() => { throw error; }); }
    return enqueue((owner) => owner.dispatch({ label, operations: diffSceneDocuments(owner.document, next),
      baseRevision: owner.revision, historyGroup: options.historyGroup,
      prepareOptions: { adoptRuntimeChanges: true }, recordHistory: options.recordHistory }));
  }
  async function execute(commands, options = {}) {
    return enqueue(async (owner) => {
      const selectedId = host.getSelectedObject?.()?.userData?.objJson?.threeJsonId;
      const result = await executeSceneSessionCommands(owner, commands, options);
      if (result.ok && result.sceneMutated) {
        const selected = selectedId ? getObjectByThreeJsonId(selectedId, owner.runtime.scene) : null;
        host.setSelectedObject?.(selected);
        host.getSceneTree?.()?.syncPropInputs?.(selected);
        host.getEditorInteraction?.()?.refreshMeshList?.();
        host.getSceneTree?.()?.render?.();
      }
      return result;
    });
  }
  return {
    get session() { return session; },
    attach, recordRuntimeEdit, execute,
    importRecord(record, options = {}) {
      return enqueue(async (owner) => {
        const payload = formatAuthoring(owner.document, { format: "standard" });
        payload.objectList = options.replace ? [record] : [...payload.objectList, record];
        return owner.dispatch({ operations: diffSceneDocuments(owner.document, compileAuthoring(payload)), baseRevision: owner.revision,
          label: options.label || "导入对象", prepareOptions: options.runtimeFlags });
      });
    },
    canEditObject(id) { return Boolean(session && indexSceneDocument(session.document).has(id)); },
    mutateObject(id, mutate, options = {}) {
      return enqueue(async (owner) => {
        const entry = indexSceneDocument(owner.document).get(id);
        if (!entry) throw new Error(`Object not found: ${id}`);
        const descriptor = structuredClone(entry.record);
        await mutate(descriptor);
        const operations = diffSceneDocuments({ root: entry.record }, { root: descriptor }).map((operation) => ({ ...operation, path: entry.path + operation.path }));
        return owner.dispatch({ operations, baseRevision: owner.revision, label: options.label || "对象属性",
          recordHistory: options.recordHistory, historyGroup: options.historyGroup });
      });
    },
    replaceObject(id, descriptor, options = {}) {
      return enqueue(async (owner) => {
        const entry = indexSceneDocument(owner.document).get(id);
        if (!entry) throw new Error(`Object not found: ${id}`);
        const operations = diffSceneDocuments({ root: entry.record }, { root: descriptor }).map((operation) => ({ ...operation, path: entry.path + operation.path }));
        if (!operations.length && options.discardPreview) return owner.refreshRuntime();
        return owner.dispatch({ operations, baseRevision: owner.revision,
          label: options.label || "对象属性", recordHistory: options.recordHistory });
      });
    },
    applyTextureAssignment(assignment, options) { return enqueue((owner) => applySceneSessionTextureAssignment(owner, assignment, options)); },
    async flush() { await pending; if (failure) throw failure; },
    export(options = {}) {
      if (!session) return null;
      if (options.assertExportable !== false) assertSceneExportableOrThrow(host.getScene(), host.buildSceneToJsonOptions?.());
      return formatAuthoring(session.document, { format: options.format || "standard", ...options });
    },
    async undo(options) { return enqueue((owner) => owner.undo(options)); },
    async redo(options) { return enqueue((owner) => owner.redo(options)); },
    dispose() { session?.dispose(); session = null; pending = Promise.resolve(); failure = null; }
  };
}

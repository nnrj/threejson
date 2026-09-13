import {
  addObjectFromDescriptor,
  addObjectFromDescriptorAsync,
  applyObjectPartial,
  applyObjectSnapshotAsync,
  getObjectByThreeJsonId,
  redeployObject,
  removeObjectById,
  sceneToStandardJsonSimple
} from "threejson";
import { boxUsesIntentionalMaterialsArray } from "./sceneTreeMaterialHelpers.js";
import { syncEditorMeshVisualFromObjJson } from "./editorMeshVisualSync.js";
import { t } from "../../shared/i18n/index.js";

function cloneJsonDeep(value) {
  if (value == null) {
    return value;
  }
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

function buildTransformPartialFromSnapshot(snapshot) {
  if (!snapshot) {
    return null;
  }
  return {
    position: cloneJsonDeep(snapshot.position || {}),
    rotation: cloneJsonDeep(snapshot.rotation || {}),
    scale: cloneJsonDeep(snapshot.scale || {})
  };
}

export function createEditorHistory(host) {
  const state = {
    past: [],
    future: [],
    bootstrap: null,
    capturing: false,
    maxDepth: 50
  };

  const menuUndo = () => document.getElementById("menuUndo");
  const menuRedo = () => document.getElementById("menuRedo");
  const menuReset = () => document.getElementById("menuReset");

  function syncMenuState() {
    if (menuUndo()) {
      menuUndo().disabled = travelling || state.past.length === 0;
    }
    if (menuRedo()) {
      menuRedo().disabled = travelling || state.future.length === 0;
    }
    if (menuReset()) {
      menuReset().disabled = !state.bootstrap;
    }
  }

  function trimDepth() {
    while (state.past.length > state.maxDepth) {
      state.past.shift();
    }
  }

  function pushEntry(entry) {
    if (!entry || state.capturing || travelling) {
      return;
    }
    state.past.push(entry);
    trimDepth();
    state.future = [];
    syncMenuState();
  }

  function captureSceneSnapshot() {
    const scene = host.getScene();
    if (!scene?.isScene) {
      return null;
    }
    try {
      const captureOpts = host.buildSceneToJsonOptions?.() ?? {};
      return cloneJsonDeep(sceneToStandardJsonSimple(scene, captureOpts));
    } catch (error) {
      console.warn("[scene-editor] captureSceneSnapshot", error);
      return null;
    }
  }

  async function captureSceneSnapshotAsync() {
    if (!host.getScene()?.isScene && !host.getSceneRuntime?.()) {
      return null;
    }
    try {
      return captureSceneSnapshot();
    } catch (error) {
      console.warn("[scene-editor] captureSceneSnapshotAsync", error);
      return null;
    }
  }

  async function fallbackHistoryObjectReplay(direction) {
    throw new Error(`${direction === "undo" ? "撤销" : "重做"}时对象重建失败。`);
  }

  function resetForFullSceneLoad(bootstrapSnapshot) {
    state.past = [];
    state.future = [];
    if (bootstrapSnapshot) {
      state.bootstrap = cloneJsonDeep(bootstrapSnapshot);
    }
    syncMenuState();
  }

  function shouldPushEditorHistory(hintLabel, ingestOptions = {}) {
    if (ingestOptions.historyReplay === true) {
      return false;
    }
    if (ingestOptions.skipHistoryPush === true) {
      return false;
    }
    return true;
  }

  function shouldResetEditorHistoryBootstrap(hintLabel, ingestOptions = {}) {
    if (ingestOptions.historyReplay === true) {
      return false;
    }
    return true;
  }

  function pushSceneSnapshot(label, ingestOptions = {}) {
    if (!shouldPushEditorHistory(label, ingestOptions)) {
      return;
    }
    const snapshot = captureSceneSnapshot();
    if (!snapshot) {
      return;
    }
    pushCapturedSceneSnapshot(snapshot, label);
  }

  function pushCapturedSceneSnapshot(snapshot, label) {
    if (!snapshot) {
      return;
    }
    pushEntry({
      kind: "sceneSnapshot",
      snapshot: cloneJsonDeep(snapshot),
      label: String(label || "编辑"),
      capturedAt: Date.now()
    });
  }

  function pushTransformDelta(threeJsonId, before, after, label) {
    if (!threeJsonId || !before || !after) {
      return;
    }
    pushEntry({
      kind: "objectDelta",
      deltaType: "transform",
      threeJsonId,
      before: cloneJsonDeep(before),
      after: cloneJsonDeep(after),
      label: String(label || "变换物体"),
      capturedAt: Date.now()
    });
  }

  function pushObjectRemoveEntry(removeResult, label) {
    if (!removeResult?.ok || !removeResult.removedDescriptor) {
      return;
    }
    const entry = {
      kind: "objectRemove",
      threeJsonId: removeResult.threeJsonId,
      removedDescriptor: cloneJsonDeep(removeResult.removedDescriptor),
      parent: removeResult.removedParentThreeJsonId || "",
      label: String(label || "删除物体"),
      capturedAt: Date.now()
    };
    if (Array.isArray(removeResult.removedSubtree) && removeResult.removedSubtree.length > 0) {
      entry.removedSubtree = cloneJsonDeep(removeResult.removedSubtree);
    }
    pushEntry(entry);
  }

  function pushObjectAddEntry(threeJsonId, addedDescriptor, parentThreeJsonId, label) {
    const id = String(threeJsonId || "").trim();
    if (!id || !addedDescriptor) {
      return;
    }
    pushEntry({
      kind: "objectAdd",
      threeJsonId: id,
      addedDescriptor: cloneJsonDeep(addedDescriptor),
      parent: String(parentThreeJsonId || "").trim(),
      label: String(label || "添加物体"),
      capturedAt: Date.now()
    });
  }

  function pushObjectObjJsonSnapshot(threeJsonId, beforeObjJson, afterObjJson, label) {
    if (!threeJsonId || !beforeObjJson || !afterObjJson) {
      return;
    }
    if (JSON.stringify(beforeObjJson) === JSON.stringify(afterObjJson)) {
      return;
    }
    pushEntry({
      kind: "objectObjJsonSnapshot",
      threeJsonId,
      beforeObjJson: cloneJsonDeep(beforeObjJson),
      afterObjJson: cloneJsonDeep(afterObjJson),
      label: String(label || "对象属性"),
      capturedAt: Date.now()
    });
  }

  function pushMeshCommandTransaction(threeJsonId, forwardCommand, undoCommand, label) {
    if (!threeJsonId || !forwardCommand || !undoCommand) return;
    pushEntry({
      kind: "meshCommandTransaction",
      threeJsonId,
      forwardCommand: cloneJsonDeep(forwardCommand),
      undoCommand: cloneJsonDeep(undoCommand),
      label: label || "网格编辑",
      capturedAt: Date.now()
    });
  }

  async function applyMeshCommandEntry(entry, direction) {
    const command = direction === "undo" ? entry.undoCommand : entry.forwardCommand;
    const batch = await host.getCommandLayer()?.runBatch?.([command], {
      label: `${direction === "undo" ? "撤销" : "重做"}：${entry.label}`,
      historyReplay: true
    });
    const ok = batch?.ok !== false;
    if (ok) {
      host.getSceneReserialize?.()?.markSceneNeedsReserialize?.();
      host.getSceneTree()?.syncPropInputs?.(host.getSelectedObject());
      host.getSceneTree()?.render?.();
    }
    return ok;
  }

  async function replaySceneSnapshot(snapshot, label) {
    if (!snapshot) {
      return false;
    }
    state.capturing = true;
    try {
      const ok = await host.ingestScenePayload(snapshot, label, {
        historyReplay: true,
        skipRuntimeResolve: true,
        skipHistoryPush: true,
        keepDirtyAfterLoad: true
      });
      if (ok) {
        host.getRightSidebarCache?.()?.invalidateRightSidebarSceneJsonTextCache?.();
        if (host.getCodeEditor?.()?.isCodeEditMode?.()) {
          void host.getCodeEditor()?.refreshFromScene?.();
        }
        host.getSceneManagePanel()?.bindFromPayload?.();
        host.getSceneTree()?.syncPropPanelSelectionFromCache?.();
        host.markSceneDirty?.();
      }
      return ok;
    } finally {
      state.capturing = false;
      syncMenuState();
    }
  }

  function resolveHistoryParentOption(parentThreeJsonId) {
    const id = String(parentThreeJsonId || "").trim();
    return id || host.getScene();
  }

  async function deployDescriptorForHistory(descriptor, parentOption) {
    const scene = host.getScene();
    const deployOpts = { parent: parentOption };
    let res = addObjectFromDescriptor(scene, descriptor, deployOpts);
    if (res.needsAsync) {
      res = await addObjectFromDescriptorAsync(scene, descriptor, deployOpts);
    }
    return res;
  }

  async function restoreRemovedSubtreeEntries(removedSubtree) {
    if (!Array.isArray(removedSubtree) || removedSubtree.length === 0) {
      return true;
    }
    for (let i = 0; i < removedSubtree.length; i += 1) {
      const sub = removedSubtree[i];
      if (!sub?.descriptor) {
        continue;
      }
      const parent = resolveHistoryParentOption(sub.removedParentThreeJsonId);
      const subRes = await deployDescriptorForHistory(sub.descriptor, parent);
      if (!subRes.ok) {
        return false;
      }
    }
    return true;
  }

  async function applyTransformEntry(entry, direction) {
    const isUndo = direction === "undo";
    const target = isUndo ? entry.before : entry.after;
    const partial = buildTransformPartialFromSnapshot(target);
    if (!partial) {
      return false;
    }
    const result = applyObjectPartial(entry.threeJsonId, partial, { runtimeScope: host.getScene() });
    if (!result.ok) {
      host.showMessage(`${isUndo ? "撤销" : "重做"}失败：${result.error || "对象不存在"}`, "warning");
      return false;
    }
    if (result.needsRedeploy) {
      const scene = host.getScene();
      const redeployed = redeployObject(scene, entry.threeJsonId);
      if (!redeployed) {
        return fallbackHistoryObjectReplay(direction);
      }
    }
    const next = result.object3D || host.getSelectedObject();
    if (next) {
      host.setSelectedObject(next);
      host.getSceneTree()?.syncPropInputs(next);
      host.getEditorInteraction()?.refreshBoxEdge(next);
      host.getSceneTree()?.render();
    }
    host.getEditorInteraction()?.refreshMeshList?.();
    host.getSceneReserialize?.()?.markSceneNeedsReserialize?.();
    return true;
  }

  async function applyObjectRemoveEntry(entry, direction) {
    const isUndo = direction === "undo";
    const scene = host.getScene();
    if (!scene?.isScene) {
      return false;
    }
    if (isUndo) {
      const parent = resolveHistoryParentOption(entry.parent);
      const res = await deployDescriptorForHistory(entry.removedDescriptor, parent);
      if (!res.ok) {
        host.showMessage(`撤销失败：${res.error || "无法恢复对象"}`, "warning");
        return false;
      }
      const subtreeOk = await restoreRemovedSubtreeEntries(entry.removedSubtree);
      if (!subtreeOk) {
        return fallbackHistoryObjectReplay(direction);
      }
      const next = res.object3D || getObjectByThreeJsonId(entry.threeJsonId, scene);
      if (next) {
        host.setSelectedObject(next);
        host.getSceneTree()?.syncPropInputs(next);
        host.getEditorInteraction()?.refreshBoxEdge(next);
      }
      host.getEditorInteraction()?.refreshMeshList?.();
      host.getSceneReserialize()?.markSceneNeedsReserialize?.();
      host.getSceneTree()?.render?.();
      return true;
    }
    const captureSubtree = Array.isArray(entry.removedSubtree) && entry.removedSubtree.length > 0;
    const removed = removeObjectById(scene, entry.threeJsonId, { captureSubtree });
    if (!removed.ok) {
      host.showMessage(`重做失败：${removed.error || "无法删除对象"}`, "warning");
      return false;
    }
    if (host.getSelectedObject() && String(host.getSelectedObject()?.userData?.objJson?.threeJsonId || "") === entry.threeJsonId) {
      host.setSelectedObject(null);
      host.getSceneTree()?.syncPropInputs(null);
    }
    host.getEditorInteraction()?.refreshMeshList?.();
    host.getSceneReserialize()?.markSceneNeedsReserialize?.();
    host.getSceneTree()?.render?.();
    return true;
  }

  async function applyObjectAddEntry(entry, direction) {
    const isUndo = direction === "undo";
    const scene = host.getScene();
    if (!scene?.isScene) {
      return false;
    }
    if (isUndo) {
      const removed = removeObjectById(scene, entry.threeJsonId);
      if (!removed.ok) {
        host.showMessage(`撤销失败：${removed.error || "无法删除对象"}`, "warning");
        return false;
      }
      if (String(host.getSelectedObject()?.userData?.objJson?.threeJsonId || "") === entry.threeJsonId) {
        host.setSelectedObject(null);
        host.getSceneTree()?.syncPropInputs(null);
      }
      host.getEditorInteraction()?.refreshMeshList?.();
      host.getSceneReserialize()?.markSceneNeedsReserialize?.();
      host.getSceneTree()?.render?.();
      return true;
    }
    const parent = resolveHistoryParentOption(entry.parent);
    const res = await deployDescriptorForHistory(entry.addedDescriptor, parent);
    if (!res.ok) {
      host.showMessage(`重做失败：${res.error || "无法添加对象"}`, "warning");
      return false;
    }
    const next = res.object3D || getObjectByThreeJsonId(entry.threeJsonId, scene);
    if (next) {
      host.setSelectedObject(next);
      host.getSceneTree()?.syncPropInputs(next);
      host.getEditorInteraction()?.refreshBoxEdge(next);
    }
    host.getEditorInteraction()?.refreshMeshList?.();
    host.getSceneReserialize()?.markSceneNeedsReserialize?.();
    host.getSceneTree()?.render?.();
    return true;
  }

  async function applyObjJsonSnapshotEntry(entry, direction) {
    const isUndo = direction === "undo";
    const target = isUndo ? entry.beforeObjJson : entry.afterObjJson;
    const result = await applyObjectSnapshotAsync(entry.threeJsonId, target, { runtimeScope: host.getScene() });
    if (!result.ok) {
      host.showMessage(`${isUndo ? "撤销" : "重做"}失败：${result.error || "对象不存在"}`, "warning");
      return false;
    }
    let redeployed = false;
    if (result.needsRedeploy) {
      const redeployedOk = redeployObject(host.getScene(), entry.threeJsonId);
      if (!redeployedOk) {
        return fallbackHistoryObjectReplay(direction);
      }
      redeployed = true;
    } else if (boxUsesIntentionalMaterialsArray(target)) {
      const redeployedOk = redeployObject(host.getScene(), entry.threeJsonId);
      if (!redeployedOk) {
        return fallbackHistoryObjectReplay(direction);
      }
      redeployed = true;
    }
    if (!redeployed && result.object3D) {
      syncEditorMeshVisualFromObjJson(result.object3D, target);
    }
    host.getEditorInteraction()?.refreshMeshList?.();
    if (result.object3D) {
      host.setSelectedObject(result.object3D);
      host.getSceneTree()?.syncPropInputs(result.object3D);
      host.getEditorInteraction()?.refreshBoxEdge(result.object3D);
      host.getSceneTree()?.render();
    }
    host.getSceneReserialize?.()?.markSceneNeedsReserialize?.();
    return true;
  }

  function afterObjectHistoryApplied() {
    host.getSceneTree()?.syncPropPanelSelectionFromCache?.();
  }

  let travelling = false;

  async function travelHistory(direction) {
    if (travelling) return { ok: false, error: "history operation already running" };
    const isUndo = direction === "undo";
    const source = isUndo ? state.past : state.future;
    const destination = isUndo ? state.future : state.past;
    const entry = source[source.length - 1];
    if (!entry) return { ok: false, error: `nothing to ${direction}` };
    const handlers = {
      objectDelta: entry.deltaType === "transform" ? applyTransformEntry : null,
      objectObjJsonSnapshot: applyObjJsonSnapshotEntry,
      objectRemove: applyObjectRemoveEntry,
      objectAdd: applyObjectAddEntry,
      meshCommandTransaction: applyMeshCommandEntry
    };
    if (entry.kind !== "sceneSnapshot" && !handlers[entry.kind]) {
      return { ok: false, error: "unsupported history entry" };
    }
    travelling = true;
    syncMenuState();
    // Transform-only edits are already atomic; structural legacy handlers need a
    // rollback checkpoint until all their mutations use prepared document transactions.
    let before = null;
    try {
      if (entry.kind !== "objectDelta") {
        before = await captureSceneSnapshotAsync();
        if (!before) throw new Error("无法创建回滚检查点，本次操作未执行。");
      }
      const ok = entry.kind === "sceneSnapshot"
        ? await replaySceneSnapshot(entry.snapshot, `${isUndo ? "撤销" : "重做"}：${entry.label}`)
        : await handlers[entry.kind](entry, direction);
      if (!ok) throw new Error(`${isUndo ? "撤销" : "重做"}未完成，历史记录已保留。`);
      source.pop();
      destination.push(entry.kind === "sceneSnapshot"
        ? { kind: "sceneSnapshot", snapshot: before, label: entry.label, capturedAt: Date.now() }
        : entry);
      trimDepth();
      afterObjectHistoryApplied();
      host.showMessage(t(isUndo ? "editor.message.undoDone" : "editor.message.redoDone", isUndo ? "Undone." : "Redone."), "info");
      return { ok: true };
    } catch (error) {
      // Replaying the current checkpoint is ROLLBACK, never a successful undo.
      // Keep the original history entry even if rollback itself cannot complete.
      let rollbackFailed = false;
      if (before) {
        try { rollbackFailed = !await replaySceneSnapshot(before, "恢复操作前状态"); }
        catch { rollbackFailed = true; }
      }
      const message = String(error?.message || error);
      host.showMessage(rollbackFailed ? `${message} 自动恢复失败，请勿覆盖保存当前场景。` : message, "warning");
      return { ok: false, error: message, rollbackFailed };
    } finally {
      travelling = false;
      syncMenuState();
    }
  }

  const undo = () => travelHistory("undo");
  const redo = () => travelHistory("redo");

  function hasUndo() {
    return state.past.length > 0;
  }

  function hasRedo() {
    return state.future.length > 0;
  }

  async function resetToBootstrap() {
    if (!state.bootstrap) {
      host.showMessage("尚无可用初始场景，无法重置。", "warning");
      return { ok: false };
    }
    const ok = await host.confirmYesNo(
      "将场景恢复为当前场景打开时的状态，并清空撤销/重做记录。是否继续？",
      { title: "重置场景" }
    );
    if (!ok) {
      return { ok: false, cancelled: true };
    }
    const bootstrap = cloneJsonDeep(state.bootstrap);
    const loaded = await replaySceneSnapshot(bootstrap, "重置");
    if (loaded) {
      state.past = [];
      state.future = [];
      syncMenuState();
      host.showMessage("已重置为打开时的场景状态。", "success");
      host.closeAllDropdowns?.();
    } else {
      state.bootstrap = bootstrap;
      syncMenuState();
    }
    return { ok: Boolean(loaded) };
  }

  function clear() {
    state.past = [];
    state.future = [];
    state.bootstrap = null;
    syncMenuState();
  }

  function applySettingsFromEditor(settings) {
    const raw = Number(settings?.editing?.historyMaxDepth);
    if (Number.isFinite(raw)) {
      state.maxDepth = Math.min(500, Math.max(1, Math.round(raw)));
      while (state.past.length > state.maxDepth) {
        state.past.shift();
      }
      syncMenuState();
    }
  }

  syncMenuState();

  return {
    captureSceneSnapshot,
    captureSceneSnapshotAsync,
    resetForFullSceneLoad,
    shouldPushEditorHistory,
    shouldResetEditorHistoryBootstrap,
    pushSceneSnapshot,
    pushCapturedSceneSnapshot,
    pushTransformDelta,
    pushObjectRemoveEntry,
    pushObjectAddEntry,
    pushObjectObjJsonSnapshot,
    pushMeshCommandTransaction,
    undo,
    redo,
    hasUndo,
    hasRedo,
    resetToBootstrap,
    clear,
    syncMenuState,
    applySettingsFromEditor
  };
}

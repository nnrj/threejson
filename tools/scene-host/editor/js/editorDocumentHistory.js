import { t } from "../../shared/i18n/index.js";

/** The UI's existing gesture/history hooks now feed one document delta timeline. */
export function createEditorDocumentHistory(host) {
  let bootstrap = null, travelling = false;
  const authoring = () => host.getAuthoringSession?.();
  const session = () => authoring()?.session;
  function syncMenuState() {
    const undo = document.getElementById("menuUndo"), redo = document.getElementById("menuRedo"), reset = document.getElementById("menuReset");
    if (undo) undo.disabled = travelling || !session()?.canUndo;
    if (redo) redo.disabled = travelling || !session()?.canRedo;
    if (reset) reset.disabled = travelling || !bootstrap;
  }
  const captureSceneSnapshot = () => authoring()?.export({ assertExportable: false }) || null;
  async function captureSceneSnapshotAsync() { await authoring()?.flush(); return captureSceneSnapshot(); }
  function record(label) {
    if (travelling) return;
    return authoring()?.recordRuntimeEdit(label);
  }
  async function travel(direction) {
    if (travelling) return { ok: false, error: "history operation already running" };
    travelling = true; syncMenuState();
    try {
      await authoring()?.flush();
      const result = await authoring()?.[direction]();
      if (!result?.changed) return { ok: false, error: `nothing to ${direction}` };
      host.getEditorInteraction?.()?.detachGizmo?.();
      host.setSelectedObject?.(null);
      host.getSceneTree?.()?.syncPropInputs?.(null);
      host.getEditorInteraction?.()?.refreshMeshList?.();
      host.getSceneTree?.()?.render?.();
      host.getSceneManagePanel?.()?.bindFromPayload?.();
      host.getSceneReserialize?.()?.markSceneDocumentSynced?.();
      host.markSceneDirty?.();
      host.showMessage?.(t(direction === "undo" ? "editor.message.undoDone" : "editor.message.redoDone", direction === "undo" ? "Undone." : "Redone."), "info");
      return { ok: true, revision: result.revision };
    } catch (error) {
      host.showMessage?.(`操作失败，原场景和历史记录已保留：${error.message}`, "error");
      return { ok: false, error: error.message };
    } finally { travelling = false; syncMenuState(); }
  }
  return {
    captureSceneSnapshot, captureSceneSnapshotAsync, syncMenuState,
    hasUndo: () => Boolean(session()?.canUndo), hasRedo: () => Boolean(session()?.canRedo),
    undo: () => travel("undo"), redo: () => travel("redo"),
    resetForFullSceneLoad(snapshot) { bootstrap = snapshot || captureSceneSnapshot(); session()?.clearHistory(); syncMenuState(); },
    shouldPushEditorHistory: (_label, options = {}) => !options.historyReplay && !options.skipHistoryPush,
    shouldResetEditorHistoryBootstrap: (_label, options = {}) => !options.historyReplay && !options.keepHistory,
    pushSceneSnapshot: (label) => record(label),
    pushCapturedSceneSnapshot: (_before, label) => record(label),
    pushTransformDelta: (_id, _before, _after, label) => record(label || "变换物体"),
    pushObjectRemoveEntry: (_entry, label) => record(label || "删除物体"),
    pushObjectAddEntry: (_id, _descriptor, _parent, label) => record(label || "添加物体"),
    pushObjectObjJsonSnapshot: (_id, _before, _after, label) => record(label || "对象属性"),
    pushMeshCommandTransaction: (_id, _forward, _undo, label) => record(label || "网格编辑"),
    applySettingsFromEditor(settings) { const limit = Number(settings?.editing?.historyMaxDepth); if (Number.isSafeInteger(limit) && limit > 0) session()?.configureHistory({ limit }); syncMenuState(); },
    clear() { bootstrap = null; session()?.clearHistory(); syncMenuState(); },
    async resetToBootstrap() {
      if (!bootstrap || travelling) return { ok: false };
      if (!await host.confirmYesNo("恢复打开时的场景并清空撤销/重做记录？", { title: "重置场景" })) return { ok: false, cancelled: true };
      const result = await authoring().execute([{ op: "scene.load", args: { json: bootstrap } }], { label: "重置场景" });
      if (result.ok) { session().clearHistory(); syncMenuState(); }
      return result;
    }
  };
}

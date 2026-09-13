import { syncBoxModelTransformFromObject3D } from "threejson";

export function createEditorSceneReserialize(host) {
  let sceneNeedsReserialize = false;

  function isRuntimeOnlyObject(obj) {
    return host.getSceneTree()?.isRuntimeOnlyObject?.(obj) ?? false;
  }

  function markSceneNeedsReserialize() {
    if (host.getSuppressCanvasDirty?.()?.isSuppressed?.()) {
      return;
    }
    forceMarkSceneNeedsReserialize();
  }

  function forceMarkSceneNeedsReserialize() {
    sceneNeedsReserialize = true;
    host.markSceneDirty?.();
    host.getRightSidebarCache?.()?.invalidateRightSidebarSceneJsonTextCache?.();
  }

  function markSceneDocumentSynced() {
    sceneNeedsReserialize = false;
  }

  function getSceneNeedsReserialize() {
    return sceneNeedsReserialize;
  }

  function syncAllTransformsFromSceneToLinkedObjJson() {
    // Direct manipulation owns only the selected object. Walking the entire scene
    // here used to freeze animated objects and Domain doors into saved snapshots.
    const selected = host.getSelectedObject?.();
    if (selected && !isRuntimeOnlyObject(selected)) syncBoxModelTransformFromObject3D(selected);
  }

  async function ensureCanvasSyncedBeforeExport() {
    if (!host.getScene()) {
      throw new Error("场景尚未初始化。");
    }
    if (!sceneNeedsReserialize) {
      return;
    }
    if (host.getAuthoringSession?.()?.session) await host.getAuthoringSession().recordRuntimeEdit("编辑场景");
    markSceneDocumentSynced();
  }

  return {
    markSceneNeedsReserialize,
    forceMarkSceneNeedsReserialize,
    markSceneDocumentSynced,
    getSceneNeedsReserialize,
    syncAllTransformsFromSceneToLinkedObjJson,
    ensureCanvasSyncedBeforeExport
  };
}

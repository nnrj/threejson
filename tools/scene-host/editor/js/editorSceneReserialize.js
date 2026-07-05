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
    const scene = host.getScene();
    if (!scene || typeof scene.traverse !== "function") {
      return;
    }
    scene.traverse((obj) => {
      if (obj === scene || isRuntimeOnlyObject(obj)) {
        return;
      }
      syncBoxModelTransformFromObject3D(obj);
    });
  }

  async function ensureCanvasSyncedBeforeExport() {
    if (!host.getScene()) {
      throw new Error("场景尚未初始化。");
    }
    if (!sceneNeedsReserialize) {
      return;
    }
    syncAllTransformsFromSceneToLinkedObjJson();
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

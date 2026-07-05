/** 右侧「场景管理」面板与 JSON 视图缓存失效（对齐基准 invalidateRightSidebarSceneJsonTextCache 调用链）。 */
export function createEditorRightSidebarCache(host) {
  let sceneJsonViewStale = false;

  function invalidateRightSidebarSceneJsonTextCache() {
    sceneJsonViewStale = true;
    host.getSceneManagePanel?.()?.markPayloadViewStale?.();
    if (host.getRightDockPanel?.()?.getActiveTab?.() === "sceneJson") {
      void host.getSceneManagePanel?.()?.refreshFromSceneIfStale?.();
    }
  }

  function markSceneJsonViewFresh() {
    sceneJsonViewStale = false;
    host.getSceneManagePanel?.()?.markPayloadViewFresh?.();
  }

  function isSceneJsonViewStale() {
    return sceneJsonViewStale;
  }

  return {
    invalidateRightSidebarSceneJsonTextCache,
    markSceneJsonViewFresh,
    isSceneJsonViewStale
  };
}

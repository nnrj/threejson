/** Player canvas double-click: selection highlight + hosted cabinet/UPS door toggle. */
import { attachHostedContainerDoorDblclick } from "threejson";

export function createPlayerSceneInteraction({
  getScene,
  getCamera,
  getCanvas,
  getSysConfig,
  getSelectionVisual
}) {
  /** @type {(() => void)|null} */
  let detachHostedContainerDoorDblclick = null;

  function attachHostedDoorDblclick() {
    detachHostedContainerDoorDblclick?.();
    detachHostedContainerDoorDblclick = attachHostedContainerDoorDblclick({
      getScene,
      getCamera,
      getCanvas
    });
  }

  function disposeHostedDoorDblclick() {
    detachHostedContainerDoorDblclick?.();
    detachHostedContainerDoorDblclick = null;
  }

  function handleObjectDoubleClick(obj) {
    if (!obj) {
      return;
    }
    const sysConfig = getSysConfig();
    if (sysConfig?.clickHighLightFlag) {
      getSelectionVisual()?.setInfoHighlight?.(obj);
    }
  }

  return {
    handleObjectDoubleClick,
    attachHostedDoorDblclick,
    disposeHostedDoorDblclick
  };
}

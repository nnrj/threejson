import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import * as THREE from "three";
import { sceneHighlight, trackDisposableResource } from "threejson";
import {
  HIGHLIGHT_ALARM_RED,
  HIGHLIGHT_LOCATE_AMBER
} from "../../../../../domains/sceneHighlight/channels.js";

export function getPlayerHighlightChannelOptions(playerSettings) {
  const ch = playerSettings?.highlight?.channels || {};
  const mk = (hex) => ({ visibleEdgeColor: hex, hiddenEdgeColor: hex });
  return {
    info: mk(ch.info || "#FFFFFF"),
    locate: mk(ch.locate || HIGHLIGHT_LOCATE_AMBER),
    alarm: mk(ch.alarm || HIGHLIGHT_ALARM_RED)
  };
}

export function createPlayerHighlightController() {
  let composer = null;
  let highlightPageSetup = null;
  let selectionVisual = null;
  let outlinePass = null;
  let alarmPass = null;
  let locatePass = null;
  let dblClickHandler = null;
  let onObjectDoubleClick = null;

  function dispose() {
    if (dblClickHandler) {
      document.removeEventListener("dblclick", dblClickHandler);
      dblClickHandler = null;
    }
    try {
      selectionVisual?.clearAll?.();
      selectionVisual?.dispose?.();
    } catch {
      /* ignore */
    }
    selectionVisual = null;
    outlinePass = null;
    alarmPass = null;
    locatePass = null;
    highlightPageSetup = null;
    if (composer) {
      try {
        composer.dispose?.();
      } catch {
        /* ignore */
      }
      composer = null;
    }
  }

  function pickObjectFromCanvasEvent(event, canvas, camera, scene) {
    if (!canvas || !camera || !scene?.isScene) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    const nx = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5;
    const ny = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5;
    const vector = new THREE.Vector3(nx * 2 - 1, -(ny * 2) + 1, 0.5);
    vector.unproject(camera);
    const raycaster = new THREE.Raycaster(camera.position, vector.sub(camera.position).normalize());
    raycaster.camera = camera;
    const intersects = raycaster.intersectObjects(scene.children, true);
    return intersects.length > 0 ? intersects[0].object : null;
  }

  function init({ scene, camera, renderer, renderLoop, channelOptions, canvas, onDoubleClickObject }) {
    dispose();
    onObjectDoubleClick = typeof onDoubleClickObject === "function" ? onDoubleClickObject : null;
    if (!scene?.isScene || !camera || !renderer || !renderLoop) {
      return false;
    }
    composer = new EffectComposer(renderer);
    trackDisposableResource(composer);
    highlightPageSetup = sceneHighlight.createPageHighlightSetup(scene, camera, {
      composer,
      renderer,
      channelOptions: channelOptions || getPlayerHighlightChannelOptions(null)
    });
    selectionVisual = highlightPageSetup.controller;
    outlinePass = highlightPageSetup.infoPass;
    alarmPass = highlightPageSetup.alarmPass ?? null;
    locatePass = highlightPageSetup.locatePass ?? null;
    renderLoop.setComposer(composer);
    dblClickHandler = (event) => {
      if (!canvas || !event.target || event.target !== canvas) {
        return;
      }
      const obj = pickObjectFromCanvasEvent(event, canvas, camera, scene);
      if (obj) {
        if (onObjectDoubleClick) {
          onObjectDoubleClick(obj);
        } else {
          selectionVisual?.setInfoHighlight?.(obj);
        }
      }
    };
    document.addEventListener("dblclick", dblClickHandler);
    return true;
  }

  function highlightModelList(modelList, lightType = "info") {
    if (!modelList?.length || !selectionVisual) {
      return;
    }
    if (lightType === "warn") {
      selectionVisual.addLocateObjects(modelList);
    } else if (lightType === "alarm") {
      selectionVisual.addAlarmObjects(modelList);
    } else if (outlinePass) {
      outlinePass.selectedObjects = modelList.slice();
      selectionVisual.syncPassActivity();
    }
  }

  function clearAlarmAndLocateHighlights() {
    selectionVisual?.clearLocateHighlights?.();
    selectionVisual?.clearAlarmHighlights?.();
  }

  return {
    init,
    dispose,
    getComposer: () => composer,
    getSelectionVisual: () => selectionVisual,
    getAlarmPass: () => alarmPass,
    getLocatePass: () => locatePass,
    highlightModelList,
    clearAlarmAndLocateHighlights
  };
}

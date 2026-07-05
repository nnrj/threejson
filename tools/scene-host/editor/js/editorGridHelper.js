import * as THREE from "three";
import { trackDisposableResource } from "threejson";

export function createEditorGridHelper(host) {
  let editorGridHelper = null;

  function disposeEditorGridHelper() {
    if (!editorGridHelper) {
      return;
    }
    try {
      editorGridHelper.parent?.remove(editorGridHelper);
      editorGridHelper.geometry?.dispose?.();
      const mats = editorGridHelper.material;
      if (Array.isArray(mats)) {
        for (const mat of mats) {
          mat?.dispose?.();
        }
      } else {
        mats?.dispose?.();
      }
    } catch {
      /* ignore */
    }
    editorGridHelper = null;
  }

  function syncEditorGridHelperFromSettings() {
    const show = Boolean(host.getEditorSettings()?.editing?.showGridHelper);
    const scene = host.getScene();
    if (!scene?.isScene) {
      if (!show) {
        disposeEditorGridHelper();
      }
      return;
    }
    if (!show) {
      if (editorGridHelper) {
        editorGridHelper.visible = false;
      }
      return;
    }
    if (!editorGridHelper) {
      editorGridHelper = new THREE.GridHelper(200, 40, 0x444444, 0x888888);
      editorGridHelper.userData = {
        ...(editorGridHelper.userData || {}),
        type: "editorGridHelper",
        editorOnly: true
      };
      editorGridHelper.name = "__editor_grid_helper__";
      scene.add(editorGridHelper);
      trackDisposableResource(editorGridHelper);
    } else if (editorGridHelper.parent !== scene) {
      scene.add(editorGridHelper);
    }
    editorGridHelper.visible = true;
  }

  function dispose() {
    disposeEditorGridHelper();
  }

  return { syncEditorGridHelperFromSettings, dispose };
}

/**
 * Viewer-only grid/axes reference helpers for the Shower (not written back to the scene JSON).
 * Sized to comfortably contain the loaded scene's estimated extent, keeping the grid's per-cell
 * size fixed (matches the sizing convention used by the editor's default scene helpers).
 */
import * as THREE from "three";
import { estimateSceneExtentFromPayload } from "../../../../core/util/sceneRuntimeDefaults.js";

const CELL_SIZE = 5;
const MIN_DIVISIONS = 20;

let gridHelper = null;
let axesHelper = null;

function computeHelperExtent(payload) {
  const extentGuess = estimateSceneExtentFromPayload(payload);
  const maxDim = extentGuess?.maxDim;
  let divisions = MIN_DIVISIONS;
  if (Number.isFinite(maxDim) && maxDim > 0) {
    const needed = Math.ceil((maxDim * 1.6) / CELL_SIZE / 2) * 2;
    divisions = Math.max(MIN_DIVISIONS, needed);
  }
  return { size: divisions * CELL_SIZE, divisions };
}

export function disposeShowerHelperOverlay() {
  if (gridHelper) {
    gridHelper.parent?.remove(gridHelper);
    gridHelper.geometry?.dispose?.();
    gridHelper.material?.dispose?.();
    gridHelper = null;
  }
  if (axesHelper) {
    axesHelper.parent?.remove(axesHelper);
    axesHelper.geometry?.dispose?.();
    axesHelper.material?.dispose?.();
    axesHelper = null;
  }
}

/**
 * (Re)creates the grid/axes overlay for the just-loaded scene.
 * @param {import("three").Scene} scene
 * @param {object} payload scene JSON payload used to estimate extent
 * @param {{ showGrid?: boolean, showAxes?: boolean }} [visibility]
 */
export function createShowerHelperOverlay(scene, payload, visibility = {}) {
  disposeShowerHelperOverlay();
  if (!scene) {
    return;
  }
  const { size, divisions } = computeHelperExtent(payload);
  gridHelper = new THREE.GridHelper(size, divisions, 0x444444, 0x888888);
  gridHelper.name = "__shower_grid_helper__";
  gridHelper.userData.__threeJsonRuntimeOnly = true;
  gridHelper.userData.__threeJsonShowerHelper = true;
  gridHelper.visible = visibility.showGrid !== false;
  scene.add(gridHelper);

  axesHelper = new THREE.AxesHelper(Math.max(size / 3, CELL_SIZE * 4));
  axesHelper.name = "__shower_axes_helper__";
  axesHelper.userData.__threeJsonRuntimeOnly = true;
  axesHelper.userData.__threeJsonShowerHelper = true;
  axesHelper.visible = visibility.showAxes !== false;
  scene.add(axesHelper);
}

export function setShowerGridVisible(visible) {
  if (gridHelper) {
    gridHelper.visible = visible;
  }
}

export function setShowerAxesVisible(visible) {
  if (axesHelper) {
    axesHelper.visible = visible;
  }
}

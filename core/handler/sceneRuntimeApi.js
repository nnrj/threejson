/**
 * Runtime imperative API: write transforms on `Object3D`, etc.; use `objectRegistry` exports to find objects.
 */
import { applyObjectTransform } from "../builder/heatmap/heatmapTexture.js";

/**
 * @param {import("three").Object3D|null|undefined} object
 * @param {{
 *   position?: { x?: number, y?: number, z?: number },
 *   rotation?: { rotationX?: number, rotationY?: number, rotationZ?: number },
 *   scale?: { scaleX?: number, scaleY?: number, scaleZ?: number },
 *   visible?: boolean
 * }} patch
 * @returns {boolean}
 */
function applyTransform(object, patch) {
  if (!object || !patch || typeof patch !== "object") {
    return false;
  }
  applyObjectTransform(object, patch);
  return true;
}

export { applyTransform };

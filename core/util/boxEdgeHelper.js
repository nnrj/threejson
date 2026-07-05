/**
 * Editor outline (THREE.BoxHelper), separate from highlight OutlinePass.
 */
import * as THREE from "three";
import { BOX_EDGE_HELPER_DEFAULT_COLOR } from "../theme/runtimeVisualDefaults.js";

/**
 * @param {import("three").Scene} scene
 * @param {string} [color]
 */
export function createBoxEdgeHelper(scene, color = BOX_EDGE_HELPER_DEFAULT_COLOR) {
  if (!scene) {
    throw new Error("[boxEdgeHelper] scene is required");
  }

  /** @type {THREE.BoxHelper|null} */
  let helper = null;

  return {
    show(obj) {
      if (!obj) {
        return;
      }
      if (helper) {
        helper.setFromObject(obj);
        helper.visible = true;
        return;
      }
      helper = new THREE.BoxHelper(obj, color);
      helper.userData = { type: "helperBoxEdge" };
      scene.add(helper);
    },

    hide() {
      if (helper) {
        helper.visible = false;
      }
    },

    update(obj) {
      if (helper && obj) {
        helper.setFromObject(obj);
        helper.visible = true;
      }
    },

    dispose() {
      if (!helper) {
        return;
      }
      scene.remove(helper);
      helper.dispose?.();
      helper = null;
    },

    get helper() {
      return helper;
    }
  };
}

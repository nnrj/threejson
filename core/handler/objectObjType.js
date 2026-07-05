/**
 * Query and batch operations by objType via objTypeIndex / objectRegistry.
 */
import * as THREE from "three";
import { getObjectByThreeJsonId } from "./objectRegistry.js";
import { getThreeJsonIdsByObjType } from "./objTypeIndex.js";
import { applyObjectVisibility } from "./objectVisibility.js";
import { removeObjectByThreeJsonIdCore } from "./objectDeleteById.js";

function normalizeObjType(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {import("three").Object3D|null|undefined} object
 * @param {import("three").Object3D|null|undefined} root
 * @returns {boolean}
 */
function isDescendantOf(object, root) {
  if (!object || !root) {
    return false;
  }
  let node = object;
  while (node) {
    if (node === root) {
      return true;
    }
    node = node.parent;
  }
  return false;
}

/**
 * @param {import("three").Scene|import("three").Object3D|null|undefined} scene
 * @param {string} objType
 * @param {{ root?: import("three").Object3D|null }} [options]
 * @returns {import("three").Object3D[]}
 */
export function getObjectsByObjType(scene, objType, options = {}) {
  const typeKey = normalizeObjType(objType);
  if (!typeKey) {
    return [];
  }
  const root = options.root ?? scene ?? null;
  const ids = getThreeJsonIdsByObjType(typeKey);
  const out = [];
  for (let i = 0; i < ids.length; i++) {
    const obj = getObjectByThreeJsonId(ids[i]);
    if (!obj) {
      continue;
    }
    if (root && !isDescendantOf(obj, root)) {
      continue;
    }
    out.push(obj);
  }
  return out;
}

/**
 * @param {import("three").Scene|import("three").Object3D|null|undefined} scene
 * @param {string} objType
 * @param {{ root?: import("three").Object3D|null }} [options]
 * @returns {object[]}
 */
export function getObjJsonListByObjType(scene, objType, options = {}) {
  const objects = getObjectsByObjType(scene, objType, options);
  const out = [];
  for (let i = 0; i < objects.length; i++) {
    const j = objects[i]?.userData?.objJson;
    if (j && typeof j === "object" && !Array.isArray(j)) {
      out.push(j);
    }
  }
  return out;
}

/**
 * @param {import("three").Scene} scene
 * @param {string} objType
 * @param {boolean} visible
 * @returns {number}
 */
export function setObjectsVisibleByObjType(scene, objType, visible) {
  const objects = getObjectsByObjType(scene, objType, { root: scene });
  const modelVisible = Boolean(visible);
  for (let i = 0; i < objects.length; i++) {
    applyObjectVisibility(objects[i], modelVisible, { applyToSubtree: false });
  }
  return objects.length;
}

/**
 * @param {import("three").Scene} scene
 * @param {string} objType
 * @returns {number}
 */
export function destroyObjectsByObjType(scene, objType) {
  if (!scene?.isScene) {
    return 0;
  }
  const typeKey = normalizeObjType(objType);
  if (!typeKey) {
    return 0;
  }
  const ids = getThreeJsonIdsByObjType(typeKey).slice();
  let count = 0;
  for (let i = 0; i < ids.length; i++) {
    const result = removeObjectByThreeJsonIdCore(scene, ids[i]);
    if (result.ok) {
      count += 1;
    }
  }
  return count;
}

/**
 * @param {import("three").Scene} scene
 * @param {string} objType
 * @param {number} [opacity]
 * @returns {number}
 */
export function transObjectsByObjType(scene, objType, opacity) {
  const objects = getObjectsByObjType(scene, objType, { root: scene });
  const alpha = opacity ? opacity : 1;
  for (let i = 0; i < objects.length; i++) {
    const model = objects[i];
    if (model instanceof THREE.Group) {
      if (model.opacity && model.opacity === 1) {
        model.transparent = false;
        continue;
      }
      model.transparent = true;
      model.opacity = alpha;
    } else if (model?.material) {
      if (Array.isArray(model.material)) {
        for (let mi = 0; mi < model.material.length; mi++) {
          if (model.material[mi].opacity && model.material[mi].opacity === 1) {
            model.material[mi].transparent = false;
            continue;
          }
          model.material[mi].transparent = true;
          model.material[mi].opacity = alpha;
        }
      } else {
        if (model.material.opacity && model.material.opacity === 1) {
          model.material.transparent = false;
          continue;
        }
        model.material.transparent = true;
        model.material.opacity = alpha;
      }
    }
  }
  return objects.length;
}

export { getThreeJsonIdsByObjType } from "./objTypeIndex.js";

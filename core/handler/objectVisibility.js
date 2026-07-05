/**
 * Visibility API based on objectRegistry / bucket indexes (exact name match; does not parse businessInfo).
 */
import * as THREE from "three";
import {
  getObjectByThreeJsonId,
  getObjectsByName
} from "./objectRegistry.js";
import {
  getObjectsInCustomBucket
} from "../util/bucketQuery.js";

/**
 * @param {import("three").Object3D|null|undefined} object3D
 * @param {boolean} visible
 * @param {{ applyToSubtree?: boolean }} [options]
 */
export function applyObjectVisibility(object3D, visible, options = {}) {
  if (!object3D) {
    return;
  }
  const modelVisible = Boolean(visible);
  const targets = options.applyToSubtree === false
    ? [object3D]
    : collectVisibilityTargets(object3D);
  for (let i = 0; i < targets.length; i++) {
    applyVisibilityToOne(targets[i], modelVisible);
  }
}

/**
 * @param {import("three").Object3D} root
 * @returns {import("three").Object3D[]}
 */
function collectVisibilityTargets(root) {
  const out = [];
  if (!root) {
    return out;
  }
  root.traverse((obj) => {
    if (obj?.userData?.objJson && typeof obj.userData.objJson === "object") {
      out.push(obj);
    }
  });
  if (out.length === 0) {
    out.push(root);
  }
  return out;
}

/**
 * @param {import("three").Object3D|null|undefined} model
 * @param {boolean} modelVisible
 */
function applyVisibilityToOne(model, modelVisible) {
  if (!model) {
    return;
  }
  if (model instanceof THREE.Group) {
    model.visible = modelVisible;
    return;
  }
  model.visible = modelVisible;
  if (!model.material) {
    return;
  }
  if (Array.isArray(model.material)) {
    for (let mi = 0; mi < model.material.length; mi++) {
      if (model.material[mi]) {
        model.material[mi].visible = modelVisible;
      }
    }
  } else {
    model.material.visible = modelVisible;
  }
}

/**
 * @param {string} threeJsonId
 * @param {boolean} visible
 * @returns {boolean}
 */
export function setObjectVisibleByThreeJsonId(threeJsonId, visible) {
  const obj = getObjectByThreeJsonId(threeJsonId);
  if (!obj) {
    return false;
  }
  applyObjectVisibility(obj, visible, { applyToSubtree: false });
  return true;
}

/**
 * @param {string} name
 * @param {boolean} visible
 * @param {{ applyToSubtree?: boolean }} [options]
 * @returns {number}
 */
export function setObjectsVisibleByName(name, visible, options = {}) {
  const list = getObjectsByName(name);
  const applyToSubtree = options.applyToSubtree !== false;
  for (let i = 0; i < list.length; i++) {
    applyObjectVisibility(list[i], visible, { applyToSubtree });
  }
  return list.length;
}

/**
 * @param {string[]} names
 * @param {boolean} visible
 * @param {{ applyToSubtree?: boolean }} [options]
 * @returns {number}
 */
export function setObjectsVisibleByNames(names, visible, options = {}) {
  if (!Array.isArray(names) || names.length === 0) {
    return 0;
  }
  let count = 0;
  for (let i = 0; i < names.length; i++) {
    count += setObjectsVisibleByName(names[i], visible, options);
  }
  return count;
}

/**
 * @param {string} bucket
 * @param {boolean} visible
 * @returns {number}
 */
export function setObjectsVisibleByCustomBucket(bucket, visible) {
  const list = getObjectsInCustomBucket(bucket);
  for (let i = 0; i < list.length; i++) {
    applyObjectVisibility(list[i], visible, { applyToSubtree: false });
  }
  return list.length;
}

/**
 * @param {string[]} buckets
 * @param {boolean} visible
 * @returns {number}
 */
export function setObjectsVisibleByCustomBuckets(buckets, visible) {
  if (!Array.isArray(buckets) || buckets.length === 0) {
    return 0;
  }
  let count = 0;
  for (let i = 0; i < buckets.length; i++) {
    count += setObjectsVisibleByCustomBucket(buckets[i], visible);
  }
  return count;
}

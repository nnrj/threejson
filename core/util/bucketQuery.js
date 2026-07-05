/**
 * Resolve Object3D instances by system/custom bucket (thin wrapper, no index state).
 */
import { getObjectByThreeJsonId } from "../handler/objectRegistry.js";
import {
  getThreeJsonIdsInCustomBucket,
  getThreeJsonIdsInSystemBucket,
  normalizeSystemBucketTag
} from "../handler/bucketIndex.js";

function normalizeObjType(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * @param {string} bucketKey
 * @returns {import("three").Object3D[]}
 */
export function getObjectsInSystemBucket(bucketKey) {
  const ids = getThreeJsonIdsInSystemBucket(bucketKey);
  const out = [];
  for (let i = 0; i < ids.length; i++) {
    const obj = getObjectByThreeJsonId(ids[i]);
    if (obj) {
      out.push(obj);
    }
  }
  return out;
}

/**
 * @param {string} customBucketName
 * @returns {import("three").Object3D[]}
 */
export function getObjectsInCustomBucket(customBucketName) {
  const ids = getThreeJsonIdsInCustomBucket(customBucketName);
  const out = [];
  for (let i = 0; i < ids.length; i++) {
    const obj = getObjectByThreeJsonId(ids[i]);
    if (obj) {
      out.push(obj);
    }
  }
  return out;
}

/**
 * @param {string} threeJsonId
 * @param {string} tag
 * @returns {boolean}
 */
export function hasSystemBucketTag(threeJsonId, tag) {
  const normalized = normalizeSystemBucketTag(tag);
  if (!normalized) {
    return false;
  }
  const ids = getThreeJsonIdsInSystemBucket(normalized);
  return ids.includes(threeJsonId);
}

/**
 * Export filter: exclude assist / environment / temp by default.
 * @param {string} threeJsonId
 * @param {object|null|undefined} record
 * @returns {boolean}
 */
export function shouldIncludeThreeJsonIdInDefaultWorldExport(threeJsonId, record = null) {
  if (hasSystemBucketTag(threeJsonId, "assist")) {
    return false;
  }
  if (hasSystemBucketTag(threeJsonId, "environment")) {
    return false;
  }
  if (hasSystemBucketTag(threeJsonId, "temp")) {
    return false;
  }
  if (hasSystemBucketTag(threeJsonId, "native-scene")) {
    return false;
  }
  const objType = normalizeObjType(record?.objType);
  if (objType === "gridhelper" || objType === "axeshelper" || objType === "boxhelper") {
    return false;
  }
  return true;
}

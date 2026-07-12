/**
 * Dual index for systemBucket / customBucket (threeJsonId → tag Set).
 * Mutable state lives only here; objectRegistry syncs on register/unregister.
 *
 * State lives inside `createBucketIndexStore()` instances so each scene/canvas
 * (via its RuntimeContext, see core/runtime/runtimeContext.js) gets its own
 * bucket index. The named exports below are thin wrappers that resolve the
 * right store from an optional trailing `runtimeScope` (a Scene, a RuntimeContext,
 * or any ctx bag carrying one); omitting it preserves today's single shared
 * global-store behavior.
 */
import { inferSystemBucketTags } from "./inferSystemBucketTags.js";
import { resolveRuntimeContext } from "../runtime/runtimeContext.js";

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeThreeJsonId(value) {
  return hasText(value) ? value.trim() : "";
}

/**
 * @param {string} raw
 * @returns {string} Tag name without the `system:` prefix
 */
export function normalizeSystemBucketTag(raw) {
  if (!hasText(raw)) {
    return "";
  }
  const trimmed = raw.trim();
  return trimmed.startsWith("system:") ? trimmed.slice("system:".length) : trimmed;
}

/**
 * @param {string} tag
 * @returns {string}
 */
export function toSystemBucketKey(tag) {
  const normalized = normalizeSystemBucketTag(tag);
  return normalized ? `system:${normalized}` : "";
}

function addToIdSetIndex(indexMap, key, threeJsonId) {
  if (!hasText(key) || !hasText(threeJsonId)) {
    return;
  }
  let bucket = indexMap.get(key);
  if (!bucket) {
    bucket = new Set();
    indexMap.set(key, bucket);
  }
  bucket.add(threeJsonId);
}

function removeFromIdSetIndex(indexMap, key, threeJsonId) {
  if (!hasText(key) || !hasText(threeJsonId)) {
    return;
  }
  const bucket = indexMap.get(key);
  if (!bucket) {
    return;
  }
  bucket.delete(threeJsonId);
  if (bucket.size === 0) {
    indexMap.delete(key);
  }
}

/**
 * @returns {{
 *   addSystemBucketTag: Function, removeSystemBucketTag: Function,
 *   clearSystemBucketTagsForThreeJsonId: Function, getThreeJsonIdsInSystemBucket: Function,
 *   getSystemBucketTagsForThreeJsonId: Function, assignCustomBucket: Function,
 *   removeCustomBucket: Function, getThreeJsonIdsInCustomBucket: Function,
 *   getCustomBucketForThreeJsonId: Function, syncSystemBucketTagsForRecord: Function,
 *   syncCustomBucketForRecord: Function, syncBucketIndexesForRecord: Function,
 *   clearBucketIndexesForThreeJsonId: Function, clearAllBucketIndexes: Function,
 *   getBucketIndexSnapshot: Function, dispose: Function
 * }}
 */
export function createBucketIndexStore() {
  /** @type {Map<string, Set<string>>} tag -> Set<threeJsonId> */
  const systemBucketIndex = new Map();
  /** @type {Map<string, Set<string>>} tag -> Set<threeJsonId> */
  const customBucketIndex = new Map();
  /** @type {Map<string, Set<string>>} threeJsonId -> system tags */
  const systemTagsByThreeJsonId = new Map();
  /** @type {Map<string, string>} threeJsonId -> custom bucket name */
  const customBucketByThreeJsonId = new Map();

  function addSystemBucketTag(threeJsonId, tag) {
    const id = normalizeThreeJsonId(threeJsonId);
    const normalizedTag = normalizeSystemBucketTag(tag);
    if (!id || !normalizedTag) {
      return;
    }
    let tags = systemTagsByThreeJsonId.get(id);
    if (!tags) {
      tags = new Set();
      systemTagsByThreeJsonId.set(id, tags);
    }
    if (tags.has(normalizedTag)) {
      return;
    }
    tags.add(normalizedTag);
    addToIdSetIndex(systemBucketIndex, normalizedTag, id);
  }

  function removeSystemBucketTag(threeJsonId, tag) {
    const id = normalizeThreeJsonId(threeJsonId);
    const normalizedTag = normalizeSystemBucketTag(tag);
    if (!id || !normalizedTag) {
      return;
    }
    const tags = systemTagsByThreeJsonId.get(id);
    if (!tags || !tags.has(normalizedTag)) {
      return;
    }
    tags.delete(normalizedTag);
    if (tags.size === 0) {
      systemTagsByThreeJsonId.delete(id);
    }
    removeFromIdSetIndex(systemBucketIndex, normalizedTag, id);
  }

  function clearSystemBucketTagsForThreeJsonId(threeJsonId) {
    const id = normalizeThreeJsonId(threeJsonId);
    if (!id) {
      return;
    }
    const tags = systemTagsByThreeJsonId.get(id);
    if (!tags) {
      return;
    }
    for (const tag of tags) {
      removeFromIdSetIndex(systemBucketIndex, tag, id);
    }
    systemTagsByThreeJsonId.delete(id);
  }

  function getThreeJsonIdsInSystemBucket(bucketKey) {
    const tag = normalizeSystemBucketTag(bucketKey);
    if (!tag) {
      return [];
    }
    const bucket = systemBucketIndex.get(tag);
    return bucket ? [...bucket] : [];
  }

  function getSystemBucketTagsForThreeJsonId(threeJsonId) {
    const id = normalizeThreeJsonId(threeJsonId);
    if (!id) {
      return [];
    }
    const tags = systemTagsByThreeJsonId.get(id);
    return tags ? [...tags] : [];
  }

  function assignCustomBucket(threeJsonId, customBucketName) {
    const id = normalizeThreeJsonId(threeJsonId);
    const name = hasText(customBucketName) ? customBucketName.trim() : "";
    if (!id || !name) {
      return;
    }
    if (name.toLowerCase().startsWith("system:")) {
      return;
    }
    removeCustomBucket(id);
    customBucketByThreeJsonId.set(id, name);
    addToIdSetIndex(customBucketIndex, name, id);
  }

  function removeCustomBucket(threeJsonId) {
    const id = normalizeThreeJsonId(threeJsonId);
    if (!id) {
      return;
    }
    const prev = customBucketByThreeJsonId.get(id);
    if (!prev) {
      return;
    }
    customBucketByThreeJsonId.delete(id);
    removeFromIdSetIndex(customBucketIndex, prev, id);
  }

  function getThreeJsonIdsInCustomBucket(customBucketName) {
    const name = hasText(customBucketName) ? customBucketName.trim() : "";
    if (!name) {
      return [];
    }
    const bucket = customBucketIndex.get(name);
    return bucket ? [...bucket] : [];
  }

  function getCustomBucketForThreeJsonId(threeJsonId) {
    const id = normalizeThreeJsonId(threeJsonId);
    return id ? (customBucketByThreeJsonId.get(id) ?? null) : null;
  }

  function syncSystemBucketTagsForRecord(threeJsonId, record, ctx = {}) {
    const id = normalizeThreeJsonId(threeJsonId);
    if (!id) {
      return;
    }
    clearSystemBucketTagsForThreeJsonId(id);
    const tags = inferSystemBucketTags(record, ctx);
    for (let i = 0; i < tags.length; i++) {
      addSystemBucketTag(id, tags[i]);
    }
  }

  function syncCustomBucketForRecord(threeJsonId, record, globalCustomBuckets = null) {
    const id = normalizeThreeJsonId(threeJsonId);
    if (!id) {
      return;
    }
    const name = resolveCustomBucketName(record, globalCustomBuckets);
    if (name) {
      assignCustomBucket(id, name);
    } else {
      removeCustomBucket(id);
    }
  }

  function syncBucketIndexesForRecord(threeJsonId, record, options = {}) {
    syncSystemBucketTagsForRecord(threeJsonId, record, options.bucketCtx || {});
    syncCustomBucketForRecord(threeJsonId, record, options.customBuckets ?? null);
  }

  function clearBucketIndexesForThreeJsonId(threeJsonId) {
    clearSystemBucketTagsForThreeJsonId(threeJsonId);
    removeCustomBucket(threeJsonId);
  }

  function clearAllBucketIndexes() {
    systemBucketIndex.clear();
    customBucketIndex.clear();
    systemTagsByThreeJsonId.clear();
    customBucketByThreeJsonId.clear();
  }

  function getBucketIndexSnapshot() {
    /** @type {Record<string, number>} */
    const system = {};
    for (const [tag, ids] of systemBucketIndex.entries()) {
      system[`system:${tag}`] = ids.size;
    }
    /** @type {Record<string, number>} */
    const custom = {};
    for (const [name, ids] of customBucketIndex.entries()) {
      custom[name] = ids.size;
    }
    return { system, custom };
  }

  return {
    addSystemBucketTag,
    removeSystemBucketTag,
    clearSystemBucketTagsForThreeJsonId,
    getThreeJsonIdsInSystemBucket,
    getSystemBucketTagsForThreeJsonId,
    assignCustomBucket,
    removeCustomBucket,
    getThreeJsonIdsInCustomBucket,
    getCustomBucketForThreeJsonId,
    syncSystemBucketTagsForRecord,
    syncCustomBucketForRecord,
    syncBucketIndexesForRecord,
    clearBucketIndexesForThreeJsonId,
    clearAllBucketIndexes,
    getBucketIndexSnapshot,
    dispose: clearAllBucketIndexes
  };
}

function resolveStore(runtimeScope) {
  return resolveRuntimeContext(runtimeScope).bucketIndex;
}

/**
 * @param {object|null|undefined} record
 * @param {Record<string, string[]>|null|undefined} [globalCustomBuckets]
 * @returns {string|null}
 */
export function resolveCustomBucketName(record, globalCustomBuckets = null) {
  if (!record || typeof record !== "object") {
    return null;
  }
  if (hasText(record.customBucket)) {
    return record.customBucket.trim();
  }
  const id = normalizeThreeJsonId(record.threeJsonId);
  if (!id || !globalCustomBuckets || typeof globalCustomBuckets !== "object") {
    return null;
  }
  for (const [bucketName, ids] of Object.entries(globalCustomBuckets)) {
    if (!Array.isArray(ids)) {
      continue;
    }
    if (ids.some((entry) => normalizeThreeJsonId(entry) === id)) {
      return hasText(bucketName) ? bucketName.trim() : null;
    }
  }
  return null;
}

export function addSystemBucketTag(threeJsonId, tag, runtimeScope) {
  return resolveStore(runtimeScope).addSystemBucketTag(threeJsonId, tag);
}

export function removeSystemBucketTag(threeJsonId, tag, runtimeScope) {
  return resolveStore(runtimeScope).removeSystemBucketTag(threeJsonId, tag);
}

export function clearSystemBucketTagsForThreeJsonId(threeJsonId, runtimeScope) {
  return resolveStore(runtimeScope).clearSystemBucketTagsForThreeJsonId(threeJsonId);
}

export function getThreeJsonIdsInSystemBucket(bucketKey, runtimeScope) {
  return resolveStore(runtimeScope).getThreeJsonIdsInSystemBucket(bucketKey);
}

export function getSystemBucketTagsForThreeJsonId(threeJsonId, runtimeScope) {
  return resolveStore(runtimeScope).getSystemBucketTagsForThreeJsonId(threeJsonId);
}

export function assignCustomBucket(threeJsonId, customBucketName, runtimeScope) {
  return resolveStore(runtimeScope).assignCustomBucket(threeJsonId, customBucketName);
}

export function removeCustomBucket(threeJsonId, runtimeScope) {
  return resolveStore(runtimeScope).removeCustomBucket(threeJsonId);
}

export function getThreeJsonIdsInCustomBucket(customBucketName, runtimeScope) {
  return resolveStore(runtimeScope).getThreeJsonIdsInCustomBucket(customBucketName);
}

export function getCustomBucketForThreeJsonId(threeJsonId, runtimeScope) {
  return resolveStore(runtimeScope).getCustomBucketForThreeJsonId(threeJsonId);
}

export function syncSystemBucketTagsForRecord(threeJsonId, record, ctx = {}, runtimeScope) {
  return resolveStore(runtimeScope).syncSystemBucketTagsForRecord(threeJsonId, record, ctx);
}

export function syncCustomBucketForRecord(threeJsonId, record, globalCustomBuckets = null, runtimeScope) {
  return resolveStore(runtimeScope).syncCustomBucketForRecord(threeJsonId, record, globalCustomBuckets);
}

export function syncBucketIndexesForRecord(threeJsonId, record, options = {}, runtimeScope) {
  return resolveStore(runtimeScope ?? options.runtimeScope).syncBucketIndexesForRecord(threeJsonId, record, options);
}

export function clearBucketIndexesForThreeJsonId(threeJsonId, runtimeScope) {
  return resolveStore(runtimeScope).clearBucketIndexesForThreeJsonId(threeJsonId);
}

export function clearAllBucketIndexes(runtimeScope) {
  return resolveStore(runtimeScope).clearAllBucketIndexes();
}

export function getBucketIndexSnapshot(runtimeScope) {
  return resolveStore(runtimeScope).getBucketIndexSnapshot();
}

export { inferSystemBucketTags };

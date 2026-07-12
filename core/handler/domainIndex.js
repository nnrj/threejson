/**
 * domain id → threeJsonId index for canonical domain deploy roots.
 * Synced by objectRegistry on register/unregister.
 *
 * State lives inside `createDomainIndexStore()` instances, one per RuntimeContext
 * (see core/runtime/runtimeContext.js). Named exports are thin wrappers taking an
 * optional trailing `runtimeScope`; omitting it preserves today's shared-global behavior.
 */
import { resolveRuntimeContext } from "../runtime/runtimeContext.js";

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeThreeJsonId(value) {
  return hasText(value) ? value.trim() : "";
}

function normalizeDomainKey(value) {
  return hasText(value) ? value.trim() : "";
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
 * @param {object|null|undefined} record
 * @returns {string[]}
 */
export function extractDomainIndexKeys(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return [];
  }
  const objType = typeof record.objType === "string" ? record.objType.trim().toLowerCase() : "";
  if (objType !== "domain") {
    return [];
  }
  const domain = normalizeDomainKey(record.domain);
  return domain ? [domain] : [];
}

export function createDomainIndexStore() {
  /** @type {Map<string, Set<string>>} domain id -> Set<threeJsonId> */
  const byDomain = new Map();
  /** @type {Map<string, Set<string>>} threeJsonId -> domain keys */
  const domainKeysByThreeJsonId = new Map();

  function syncDomainIndexesForRecord(threeJsonId, record) {
    const id = normalizeThreeJsonId(threeJsonId);
    if (!id) {
      return;
    }
    clearDomainIndexesForThreeJsonId(id);
    const keys = extractDomainIndexKeys(record);
    if (keys.length === 0) {
      return;
    }
    let keySet = domainKeysByThreeJsonId.get(id);
    if (!keySet) {
      keySet = new Set();
      domainKeysByThreeJsonId.set(id, keySet);
    }
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      keySet.add(key);
      addToIdSetIndex(byDomain, key, id);
    }
  }

  function clearDomainIndexesForThreeJsonId(threeJsonId) {
    const id = normalizeThreeJsonId(threeJsonId);
    if (!id) {
      return;
    }
    const keys = domainKeysByThreeJsonId.get(id);
    if (keys) {
      for (const key of keys) {
        removeFromIdSetIndex(byDomain, key, id);
      }
      domainKeysByThreeJsonId.delete(id);
    }
  }

  function clearAllDomainIndexes() {
    byDomain.clear();
    domainKeysByThreeJsonId.clear();
  }

  function getThreeJsonIdsByDomain(domainId) {
    const key = normalizeDomainKey(domainId);
    if (!key) {
      return [];
    }
    const bucket = byDomain.get(key);
    return bucket ? Array.from(bucket) : [];
  }

  return {
    syncDomainIndexesForRecord,
    clearDomainIndexesForThreeJsonId,
    clearAllDomainIndexes,
    getThreeJsonIdsByDomain,
    dispose: clearAllDomainIndexes
  };
}

function resolveStore(runtimeScope) {
  return resolveRuntimeContext(runtimeScope).domainIndex;
}

export function syncDomainIndexesForRecord(threeJsonId, record, runtimeScope) {
  return resolveStore(runtimeScope).syncDomainIndexesForRecord(threeJsonId, record);
}

export function clearDomainIndexesForThreeJsonId(threeJsonId, runtimeScope) {
  return resolveStore(runtimeScope).clearDomainIndexesForThreeJsonId(threeJsonId);
}

export function clearAllDomainIndexes(runtimeScope) {
  return resolveStore(runtimeScope).clearAllDomainIndexes();
}

export function getThreeJsonIdsByDomain(domainId, runtimeScope) {
  return resolveStore(runtimeScope).getThreeJsonIdsByDomain(domainId);
}

/**
 * domain id → threeJsonId index for canonical domain deploy roots.
 * Synced by objectRegistry on register/unregister.
 */

/** @type {Map<string, Set<string>>} domain id -> Set<threeJsonId> */
const byDomain = new Map();
/** @type {Map<string, Set<string>>} threeJsonId -> domain keys */
const domainKeysByThreeJsonId = new Map();

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

/**
 * @param {string} threeJsonId
 * @param {object|null|undefined} record
 */
export function syncDomainIndexesForRecord(threeJsonId, record) {
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

/**
 * @param {string} threeJsonId
 */
export function clearDomainIndexesForThreeJsonId(threeJsonId) {
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

export function clearAllDomainIndexes() {
  byDomain.clear();
  domainKeysByThreeJsonId.clear();
}

/**
 * @param {string} domainId
 * @returns {string[]}
 */
export function getThreeJsonIdsByDomain(domainId) {
  const key = normalizeDomainKey(domainId);
  if (!key) {
    return [];
  }
  const bucket = byDomain.get(key);
  return bucket ? Array.from(bucket) : [];
}

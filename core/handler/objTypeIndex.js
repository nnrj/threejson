/**
 * objType → threeJsonId index.
 * Synced by objectRegistry on register/unregister.
 */

/** @type {Map<string, Set<string>>} objType key -> Set<threeJsonId> */
const byObjType = new Map();
/** @type {Map<string, Set<string>>} threeJsonId -> objType keys */
const objTypeKeysByThreeJsonId = new Map();

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeThreeJsonId(value) {
  return hasText(value) ? value.trim() : "";
}

function normalizeObjTypeKey(value) {
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
export function extractObjTypeIndexKeys(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return [];
  }
  const keys = [];
  const objType = normalizeObjTypeKey(record.objType);
  if (objType) {
    keys.push(objType);
  }
  return keys;
}

/**
 * @param {string} threeJsonId
 * @param {object|null|undefined} record
 */
export function syncObjTypeIndexesForRecord(threeJsonId, record) {
  const id = normalizeThreeJsonId(threeJsonId);
  if (!id) {
    return;
  }
  clearObjTypeIndexesForThreeJsonId(id);
  const keys = extractObjTypeIndexKeys(record);
  if (keys.length === 0) {
    return;
  }
  let keySet = objTypeKeysByThreeJsonId.get(id);
  if (!keySet) {
    keySet = new Set();
    objTypeKeysByThreeJsonId.set(id, keySet);
  }
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    keySet.add(key);
    addToIdSetIndex(byObjType, key, id);
  }
}

/**
 * @param {string} threeJsonId
 */
export function clearObjTypeIndexesForThreeJsonId(threeJsonId) {
  const id = normalizeThreeJsonId(threeJsonId);
  if (!id) {
    return;
  }
  const keys = objTypeKeysByThreeJsonId.get(id);
  if (keys) {
    for (const key of keys) {
      removeFromIdSetIndex(byObjType, key, id);
    }
    objTypeKeysByThreeJsonId.delete(id);
  }
}

export function clearAllObjTypeIndexes() {
  byObjType.clear();
  objTypeKeysByThreeJsonId.clear();
}

/**
 * @param {string} objType
 * @returns {string[]}
 */
export function getThreeJsonIdsByObjType(objType) {
  const key = normalizeObjTypeKey(objType);
  if (!key) {
    return [];
  }
  const bucket = byObjType.get(key);
  return bucket ? Array.from(bucket) : [];
}

import { sanitizePlainData } from "../handler/sceneJsonHandler.js";

/**
 * @param {object|null|undefined} record
 * @returns {string}
 */
export function descriptorListMergeKey(record) {
  if (!record || typeof record !== "object") {
    return "";
  }
  const id = String(record.threeJsonId ?? "").trim();
  if (id) {
    return `id:${id}`;
  }
  const bid = record.boxInfoId;
  if (bid != null && String(bid).trim() !== "") {
    return `box:${bid}`;
  }
  const name = String(record.name ?? "").trim();
  if (name) {
    return `name:${name}`;
  }
  return "";
}

/**
 * @param {object} base
 * @param {object} fresh
 * @returns {object}
 */
export function applyDescriptorTransformsFromFresh(base, fresh) {
  const out = sanitizePlainData(base) || {};
  if (fresh?.position && typeof fresh.position === "object") {
    out.position = { ...fresh.position };
  }
  if (fresh?.rotation && typeof fresh.rotation === "object") {
    out.rotation = { ...fresh.rotation };
  }
  if (fresh?.scale && typeof fresh.scale === "object") {
    out.scale = { ...fresh.scale };
  }
  return out;
}

/**
 * @param {unknown} baseList
 * @param {unknown} freshList
 * @returns {object[]}
 */
export function mergeWorldInfoModelListByIdentity(baseList, freshList) {
  const base = Array.isArray(baseList) ? baseList : [];
  const fresh = Array.isArray(freshList) ? freshList : [];
  if (!fresh.length) {
    return sanitizePlainData(base) || [];
  }
  if (!base.length) {
    return sanitizePlainData(fresh) || [];
  }
  const freshByKey = new Map();
  const freshNoKey = [];
  for (let i = 0; i < fresh.length; i += 1) {
    const item = fresh[i];
    if (!item || typeof item !== "object") {
      continue;
    }
    const key = descriptorListMergeKey(item);
    if (key) {
      freshByKey.set(key, item);
    } else {
      freshNoKey.push(item);
    }
  }
  const usedFreshKeys = new Set();
  const merged = [];
  for (let i = 0; i < base.length; i += 1) {
    const b = base[i];
    if (!b || typeof b !== "object") {
      continue;
    }
    const key = descriptorListMergeKey(b);
    if (key && freshByKey.has(key)) {
      merged.push(freshByKey.get(key));
      usedFreshKeys.add(key);
    } else {
      merged.push(b);
    }
  }
  for (const [key, item] of freshByKey) {
    if (!usedFreshKeys.has(key)) {
      merged.push(item);
    }
  }
  merged.push(...freshNoKey);
  return sanitizePlainData(merged) || [];
}

/**
 * @param {unknown} baseItems
 * @param {unknown} freshItems
 * @param {(base: object, fresh: object) => object} [mergePair]
 * @param {(item: object) => string} [keyFn] domain-level pairing key; defaults to {@link descriptorListMergeKey}
 * @returns {object[]}
 */
export function mergeModelListItemsByIdentity(baseItems, freshItems, mergePair, keyFn) {
  const base = Array.isArray(baseItems) ? baseItems : [];
  const fresh = Array.isArray(freshItems) ? freshItems : [];
  const resolveKey =
    typeof keyFn === "function"
      ? keyFn
      : descriptorListMergeKey;
  if (!fresh.length) {
    return sanitizePlainData(base) || [];
  }
  if (!base.length) {
    return sanitizePlainData(fresh) || [];
  }
  const freshByKey = new Map();
  const freshNoKey = [];
  for (let i = 0; i < fresh.length; i += 1) {
    const item = fresh[i];
    if (!item || typeof item !== "object") {
      continue;
    }
    const key = resolveKey(item);
    if (key) {
      freshByKey.set(key, item);
    } else {
      freshNoKey.push(item);
    }
  }
  const usedFreshKeys = new Set();
  const merged = [];
  for (let i = 0; i < base.length; i += 1) {
    const b = base[i];
    if (!b || typeof b !== "object") {
      continue;
    }
    const key = resolveKey(b);
    if (key && freshByKey.has(key)) {
      const f = freshByKey.get(key);
      merged.push(typeof mergePair === "function" ? mergePair(b, f) : f);
      usedFreshKeys.add(key);
    } else {
      merged.push(b);
    }
  }
  for (const [key, item] of freshByKey) {
    if (!usedFreshKeys.has(key)) {
      merged.push(item);
    }
  }
  merged.push(...freshNoKey);
  return sanitizePlainData(merged) || [];
}

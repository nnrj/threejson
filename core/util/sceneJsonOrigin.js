export const JSON_ORIGIN_CONFIG = "config";
export const JSON_ORIGIN_LIST = "list";

const JSON_ORIGIN_RUNTIME_OBJ_TYPES = new Set(["camera", "light", "controls"]);

function normalizeObjType(value) {
  return String(value || "").trim().toLowerCase();
}

/**
 * @param {string} value
 * @returns {boolean}
 */
export function isJsonOriginValue(value) {
  return value === JSON_ORIGIN_CONFIG || value === JSON_ORIGIN_LIST;
}

/**
 * @param {object|null|undefined} record
 * @returns {boolean}
 */
export function supportsJsonOrigin(record) {
  return JSON_ORIGIN_RUNTIME_OBJ_TYPES.has(normalizeObjType(record?.objType));
}

/**
 * Override jsonOrigin tag based on physical placement.
 *
 * @param {object|null|undefined} record
 * @param {"config"|"list"} physicalOrigin
 * @returns {object|null|undefined}
 */
export function ensureJsonOrigin(record, physicalOrigin) {
  if (!record || typeof record !== "object" || !supportsJsonOrigin(record)) {
    return record;
  }
  return {
    ...record,
    jsonOrigin: physicalOrigin
  };
}

/**
 * @param {object|null|undefined} record
 * @returns {string}
 */
export function runtimeRecordDedupKey(record) {
  if (!record || typeof record !== "object") {
    return "";
  }
  const objType = normalizeObjType(record.objType);
  if (!JSON_ORIGIN_RUNTIME_OBJ_TYPES.has(objType)) {
    return "";
  }
  const id = String(record.threeJsonId || "").trim();
  if (id) {
    return `${objType}:id:${id}`;
  }
  const name = String(record.name || "").trim();
  if (name) {
    return `${objType}:name:${name}`;
  }
  return "";
}

/**
 * @param {object[]} configRuntimeRecords
 * @returns {Set<string>}
 */
export function buildConfigRuntimeDedupKeySet(configRuntimeRecords) {
  const keys = new Set();
  const list = Array.isArray(configRuntimeRecords) ? configRuntimeRecords : [];
  for (let i = 0; i < list.length; i++) {
    const key = runtimeRecordDedupKey(list[i]);
    if (key) {
      keys.add(key);
    }
  }
  return keys;
}

/**
 * @param {object|null|undefined} record
 * @param {Set<string>} configKeys
 * @returns {boolean}
 */
export function shouldDropDuplicateObjectListRuntime(record, configKeys) {
  const key = runtimeRecordDedupKey(record);
  return Boolean(key && configKeys.has(key));
}

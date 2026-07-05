import { sanitizePlainData } from "../handler/sceneJsonHandler.js";
import { getDomain } from "../handler/businessDomainRegistry.js";
import {
  descriptorListMergeKey,
  mergeModelListItemsByIdentity,
  mergeWorldInfoModelListByIdentity
} from "./persistListMerge.js";

const ROOT_METADATA_KEYS = [
  "threeJsonId",
  "name",
  "version",
  "assetLibrary",
  "descriptorBinding",
  "canvasWidth",
  "canvasHeight"
];

const WORLD_INFO_LIST_KEYS = new Set([
  "boxModelList",
  "sphereModelList",
  "groupList",
  "lineList",
  "domainModelList",
  "heatList",
  "windList",
  "shaderSurfaceList",
  "infoPanelList",
  "css3dPanelList",
  "objModelList",
  "meshList",
  "modelList",
  "objectList"
]);

/**
 * @param {object|null|undefined} record
 * @returns {boolean}
 */
function isDomainObjectListRecord(record) {
  return record
    && typeof record === "object"
    && String(record.objType || "").trim().toLowerCase() === "domain"
    && record.domain;
}

/**
 * @param {object} base
 * @param {object} fresh
 * @returns {object}
 */
function mergeDomainObjectListPair(base, fresh) {
  const domainId = String(fresh.domain || base.domain || "").trim();
  const domain = domainId ? getDomain(domainId) : null;
  const mergeHook = domain?.api?.mergePersistDescriptor;
  const keyFn = domain?.api?.persistMergeKey;
  const baseItems = Array.isArray(base.items) ? base.items : [];
  const freshItems = Array.isArray(fresh.items) ? fresh.items : [];
  const mergedItems = typeof mergeHook === "function"
    ? mergeModelListItemsByIdentity(baseItems, freshItems, (b, f) => mergeHook(b, f), keyFn)
    : mergeWorldInfoModelListByIdentity(baseItems, freshItems);
  return sanitizePlainData({
    ...base,
    ...fresh,
    domain: domainId || fresh.domain || base.domain,
    items: mergedItems
  }) || { ...fresh, items: mergedItems };
}

/**
 * @param {unknown} baseList
 * @param {unknown} freshList
 * @returns {object[]}
 */
export function mergeObjectListByIdentity(baseList, freshList) {
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
      const f = freshByKey.get(key);
      if (isDomainObjectListRecord(b) && isDomainObjectListRecord(f)) {
        merged.push(mergeDomainObjectListPair(b, f));
      } else {
        merged.push(f);
      }
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
 * Extract root-level metadata from base that can be merged into standard JSON; drops friendly lists and legacy UI worldInfo keys.
 *
 * @param {object|null|undefined} basePayload
 * @returns {object}
 */
export function extractRootMetadataFromBase(basePayload) {
  const base = sanitizePlainData(basePayload || {}) || {};
  const out = {};
  for (let i = 0; i < ROOT_METADATA_KEYS.length; i += 1) {
    const key = ROOT_METADATA_KEYS[i];
    if (Object.prototype.hasOwnProperty.call(base, key) && base[key] !== undefined) {
      out[key] = base[key];
    }
  }
  if (!out.assetLibrary && base.worldInfo?.assetLibrary) {
    out.assetLibrary = sanitizePlainData(base.worldInfo.assetLibrary);
  }
  if (!out.descriptorBinding && base.worldInfo?.descriptorBinding) {
    out.descriptorBinding = sanitizePlainData(base.worldInfo.descriptorBinding);
  }
  if (base.sceneConfig && typeof base.sceneConfig === "object") {
    out.sceneConfig = sanitizePlainData(base.sceneConfig) || {};
  }
  if (base.saveMeta && typeof base.saveMeta === "object") {
    out.saveMeta = sanitizePlainData(base.saveMeta) || {};
  }
  return out;
}

/**
 * Native-scene: preserve nativeSceneList from base (does not write back other worldInfo list keys).
 *
 * @param {object} payload
 * @param {object|null|undefined} basePayload
 */
/**
 * @param {object|null|undefined} record
 * @returns {boolean}
 */
function isAudioObjectListRecord(record) {
  return Boolean(record)
    && typeof record === "object"
    && String(record.objType || "").trim().toLowerCase() === "audio";
}

/**
 * @param {unknown} list
 * @returns {boolean}
 */
function objectListHasAudioRecords(list) {
  if (!Array.isArray(list)) {
    return false;
  }
  for (let i = 0; i < list.length; i += 1) {
    if (isAudioObjectListRecord(list[i])) {
      return true;
    }
  }
  return false;
}

/**
 * Collect declarative audio entries from base objectList or friendly `worldInfo.audioList`.
 *
 * @param {object|null|undefined} basePayload
 * @returns {object[]}
 */
function collectDeclarativeAudioRecordsFromBase(basePayload) {
  const fromObjectList = resolveBaseObjectList(basePayload).filter(isAudioObjectListRecord);
  if (fromObjectList.length) {
    return sanitizePlainData(fromObjectList) || [];
  }
  const wi = basePayload?.worldInfo;
  if (Array.isArray(wi?.audioList) && wi.audioList.length) {
    return sanitizePlainData(wi.audioList) || [];
  }
  return [];
}

/**
 * When canvas reverse-scan omits camera-attached ambient audio, restore declarative audio entries from load base.
 *
 * @param {object} payload
 * @param {object|null|undefined} basePayload
 */
export function preserveDeclarativeAudioFromBase(payload, basePayload) {
  if (!payload || typeof payload !== "object") {
    return;
  }
  const objectList = Array.isArray(payload.objectList) ? payload.objectList : [];
  if (objectListHasAudioRecords(objectList)) {
    return;
  }
  const audioRecords = collectDeclarativeAudioRecordsFromBase(basePayload);
  if (!audioRecords.length) {
    return;
  }
  payload.objectList = mergeObjectListByIdentity(objectList, audioRecords);
}

export function preserveNativeSceneEmbedFromBase(payload, basePayload) {
  const wi = basePayload?.worldInfo;
  if (!wi || typeof wi !== "object" || !Array.isArray(wi.nativeSceneList) || !wi.nativeSceneList.length) {
    return;
  }
  payload.worldInfo = payload.worldInfo && typeof payload.worldInfo === "object" ? payload.worldInfo : {};
  payload.worldInfo.nativeSceneList = sanitizePlainData(wi.nativeSceneList);
  for (const key of Object.keys(payload.worldInfo)) {
    if (key !== "nativeSceneList") {
      delete payload.worldInfo[key];
    }
  }
  if (!Object.keys(payload.worldInfo).length) {
    delete payload.worldInfo;
  }
}

/**
 * @param {object|null|undefined} basePayload
 * @returns {object[]}
 */
export function resolveBaseObjectList(basePayload) {
  if (!basePayload || typeof basePayload !== "object") {
    return [];
  }
  if (Array.isArray(basePayload.objectList)) {
    return sanitizePlainData(basePayload.objectList) || [];
  }
  return [];
}

export { WORLD_INFO_LIST_KEYS };

/**
 * Runtime event binding registry — parallel to objectRegistry.
 * Stores (threeJsonId × platformEventName) → binding entries.
 *
 * State lives inside `createEventBindingRegistryStore()` instances, one per
 * RuntimeContext (see core/runtime/runtimeContext.js), so two scenes that happen
 * to reuse the same threeJsonId (e.g. generated from the same template) don't
 * dispatch each other's bindings. Named exports are thin wrappers taking an
 * optional trailing `runtimeScope`; omitting it preserves today's shared-global
 * behavior for unmigrated callers.
 */

import { log } from "../../util/logger.js";
import { isPlatformEventName, normalizePlatformEventName } from "./platformEvents.js";
import { resolveRuntimeContext } from "../runtimeContext.js";

/** @typedef {'json'|'runtime'} EventBindingSource */

/** @typedef {import("./bindingDescriptor.js").EventExecutorKind} EventExecutorKind */

/** @typedef {object} EventBindingEntry
 * @property {string} id
 * @property {string} threeJsonId
 * @property {string} eventName
 * @property {EventBindingSource} source
 * @property {string} objType
 * @property {string} domainKey
 * @property {EventExecutorKind} executorKind
 * @property {unknown} payload
 * @property {string} [sceneToken]
 */

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function bindingKey(threeJsonId, eventName) {
  return `${threeJsonId}\0${eventName}`;
}

export function createEventBindingRegistryStore() {
  /** @type {Map<string, EventBindingEntry[]>} */
  const byThreeJsonIdAndEvent = new Map();
  /** @type {Map<string, Set<string>>} */
  const byEventName = new Map();
  /** @type {Map<string, Set<string>>} */
  const byObjType = new Map();
  /** @type {Map<string, Set<string>>} */
  const byDomainKey = new Map();
  /** @type {Map<string, Set<string>>} */
  const bySceneToken = new Map();
  let bindingSeq = 0;

  function nextBindingId() {
    bindingSeq += 1;
    return `eb-${bindingSeq}`;
  }

  function addToSetIndex(indexMap, key, bindingId) {
    if (!key) {
      return;
    }
    let bucket = indexMap.get(key);
    if (!bucket) {
      bucket = new Set();
      indexMap.set(key, bucket);
    }
    bucket.add(bindingId);
  }

  function removeFromSetIndex(indexMap, key, bindingId) {
    if (!key) {
      return;
    }
    const bucket = indexMap.get(key);
    if (!bucket) {
      return;
    }
    bucket.delete(bindingId);
    if (bucket.size === 0) {
      indexMap.delete(key);
    }
  }

  function indexBinding(entry) {
    addToSetIndex(byEventName, entry.eventName, entry.id);
    if (entry.objType) {
      addToSetIndex(byObjType, entry.objType, entry.id);
    }
    if (entry.domainKey) {
      addToSetIndex(byDomainKey, entry.domainKey, entry.id);
    }
    if (entry.sceneToken) {
      addToSetIndex(bySceneToken, entry.sceneToken, entry.id);
    }
  }

  function unindexBinding(entry) {
    removeFromSetIndex(byEventName, entry.eventName, entry.id);
    removeFromSetIndex(byObjType, entry.objType, entry.id);
    removeFromSetIndex(byDomainKey, entry.domainKey, entry.id);
    removeFromSetIndex(bySceneToken, entry.sceneToken, entry.id);
  }

  function findEntryById(bindingId) {
    for (const list of byThreeJsonIdAndEvent.values()) {
      for (let i = 0; i < list.length; i++) {
        if (list[i].id === bindingId) {
          return list[i];
        }
      }
    }
    return null;
  }

  /**
   * @param {object} input
   * @returns {EventBindingEntry|null}
   */
  function addBinding(input) {
    const threeJsonId = normalizeText(input?.threeJsonId);
    const eventName = normalizePlatformEventName(input?.eventName);
    if (!threeJsonId || !isPlatformEventName(eventName)) {
      log.warn("[eventMechanism] addBinding rejected: invalid threeJsonId or eventName", {
        threeJsonId,
        eventName
      });
      return null;
    }
    const entry = {
      id: nextBindingId(),
      threeJsonId,
      eventName,
      source: input?.source === "json" ? "json" : "runtime",
      objType: normalizeText(input?.objType).toLowerCase(),
      domainKey: normalizeText(input?.domainKey),
      executorKind: input?.executorKind === "domain" ? "domain" : "core",
      payload: input?.payload ?? null,
      sceneToken: normalizeText(input?.sceneToken) || undefined
    };
    const key = bindingKey(threeJsonId, eventName);
    let list = byThreeJsonIdAndEvent.get(key);
    if (!list) {
      list = [];
      byThreeJsonIdAndEvent.set(key, list);
    }
    list.push(entry);
    indexBinding(entry);
    return entry;
  }

  /**
   * @param {string} bindingId
   * @returns {EventBindingEntry|null}
   */
  function removeBinding(bindingId) {
    const id = normalizeText(bindingId);
    if (!id) {
      return null;
    }
    for (const [key, list] of byThreeJsonIdAndEvent.entries()) {
      const index = list.findIndex((entry) => entry.id === id);
      if (index >= 0) {
        const [removed] = list.splice(index, 1);
        if (list.length === 0) {
          byThreeJsonIdAndEvent.delete(key);
        }
        unindexBinding(removed);
        return removed;
      }
    }
    return null;
  }

  /**
   * @param {string} threeJsonId
   * @param {string} [eventName]
   * @returns {EventBindingEntry[]}
   */
  function getBindings(threeJsonId, eventName) {
    const id = normalizeText(threeJsonId);
    if (!id) {
      return [];
    }
    const eventKey = eventName != null ? normalizePlatformEventName(eventName) : "";
    if (eventKey) {
      return [...(byThreeJsonIdAndEvent.get(bindingKey(id, eventKey)) ?? [])];
    }
    const out = [];
    for (const [key, list] of byThreeJsonIdAndEvent.entries()) {
      if (key.startsWith(`${id}\0`)) {
        out.push(...list);
      }
    }
    return out;
  }

  /**
   * @param {string} eventName
   * @returns {string[]}
   */
  function getThreeJsonIdsWithBindingsForEvent(eventName) {
    const key = normalizePlatformEventName(eventName);
    if (!isPlatformEventName(key)) {
      return [];
    }
    const ids = new Set();
    for (const [mapKey, list] of byThreeJsonIdAndEvent.entries()) {
      if (!mapKey.endsWith(`\0${key}`)) {
        continue;
      }
      for (let i = 0; i < list.length; i++) {
        ids.add(list[i].threeJsonId);
      }
    }
    return Array.from(ids);
  }

  /**
   * @param {string} threeJsonId
   * @returns {number}
   */
  function clearBindingsForThreeJsonId(threeJsonId) {
    const id = normalizeText(threeJsonId);
    if (!id) {
      return 0;
    }
    let removed = 0;
    for (const key of [...byThreeJsonIdAndEvent.keys()]) {
      if (!key.startsWith(`${id}\0`)) {
        continue;
      }
      const list = byThreeJsonIdAndEvent.get(key) ?? [];
      while (list.length > 0) {
        const entry = list.pop();
        if (entry) {
          unindexBinding(entry);
          removed += 1;
        }
      }
      byThreeJsonIdAndEvent.delete(key);
    }
    return removed;
  }

  /**
   * @param {string} sceneToken
   * @returns {number}
   */
  function clearBindingsForScene(sceneToken) {
    const token = normalizeText(sceneToken);
    if (!token) {
      return 0;
    }
    const bindingIds = bySceneToken.get(token);
    if (!bindingIds || bindingIds.size === 0) {
      return 0;
    }
    let removed = 0;
    for (const bindingId of [...bindingIds]) {
      if (removeBinding(bindingId)) {
        removed += 1;
      }
    }
    return removed;
  }

  function clearAllEventBindings() {
    byThreeJsonIdAndEvent.clear();
    byEventName.clear();
    byObjType.clear();
    byDomainKey.clear();
    bySceneToken.clear();
  }

  /**
   * @param {string} [objType]
   * @returns {EventBindingEntry[]}
   */
  function listBindingsByObjType(objType) {
    const key = normalizeText(objType).toLowerCase();
    const ids = key ? byObjType.get(key) : null;
    if (!ids) {
      return [];
    }
    const out = [];
    for (const bindingId of ids) {
      const entry = findEntryById(bindingId);
      if (entry) {
        out.push(entry);
      }
    }
    return out;
  }

  /**
   * @param {string} [domainKey]
   * @returns {EventBindingEntry[]}
   */
  function listBindingsByDomainKey(domainKey) {
    const key = normalizeText(domainKey);
    const ids = key ? byDomainKey.get(key) : null;
    if (!ids) {
      return [];
    }
    const out = [];
    for (const bindingId of ids) {
      const entry = findEntryById(bindingId);
      if (entry) {
        out.push(entry);
      }
    }
    return out;
  }

  function getEventBindingRegistrySnapshot() {
    let bindingCount = 0;
    for (const list of byThreeJsonIdAndEvent.values()) {
      bindingCount += list.length;
    }
    return {
      bindingCount,
      eventNameCount: byEventName.size,
      objTypeIndexCount: byObjType.size,
      domainKeyIndexCount: byDomainKey.size,
      sceneTokenCount: bySceneToken.size
    };
  }

  return {
    addBinding,
    removeBinding,
    getBindings,
    getThreeJsonIdsWithBindingsForEvent,
    clearBindingsForThreeJsonId,
    clearBindingsForScene,
    clearAllEventBindings,
    listBindingsByObjType,
    listBindingsByDomainKey,
    getEventBindingRegistrySnapshot,
    dispose: clearAllEventBindings
  };
}

function resolveStore(runtimeScope) {
  return resolveRuntimeContext(runtimeScope).eventBindingRegistry;
}

/**
 * @param {object} input
 * @param {*} [runtimeScope]
 * @returns {EventBindingEntry|null}
 */
export function addBinding(input, runtimeScope) {
  return resolveStore(runtimeScope).addBinding(input);
}

export function removeBinding(bindingId, runtimeScope) {
  return resolveStore(runtimeScope).removeBinding(bindingId);
}

export function getBindings(threeJsonId, eventName, runtimeScope) {
  return resolveStore(runtimeScope).getBindings(threeJsonId, eventName);
}

export function getThreeJsonIdsWithBindingsForEvent(eventName, runtimeScope) {
  return resolveStore(runtimeScope).getThreeJsonIdsWithBindingsForEvent(eventName);
}

export function clearBindingsForThreeJsonId(threeJsonId, runtimeScope) {
  return resolveStore(runtimeScope).clearBindingsForThreeJsonId(threeJsonId);
}

export function clearBindingsForScene(sceneToken, runtimeScope) {
  return resolveStore(runtimeScope).clearBindingsForScene(sceneToken);
}

export function clearAllEventBindings(runtimeScope) {
  return resolveStore(runtimeScope).clearAllEventBindings();
}

export function listBindingsByObjType(objType, runtimeScope) {
  return resolveStore(runtimeScope).listBindingsByObjType(objType);
}

export function listBindingsByDomainKey(domainKey, runtimeScope) {
  return resolveStore(runtimeScope).listBindingsByDomainKey(domainKey);
}

export function getEventBindingRegistrySnapshot(runtimeScope) {
  return resolveStore(runtimeScope).getEventBindingRegistrySnapshot();
}

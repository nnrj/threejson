/**
 * ThreeJSON runtime object registry:
 * - `threeJsonId` as stable cross-session identity
 * - `uuid` as fast index for the current session
 * - `name` / `refName` for convenient lookup
 *
 * State lives inside `createObjectRegistryStore()` instances, one per RuntimeContext
 * (see core/runtime/runtimeContext.js), so concurrently-mounted scenes/canvases don't
 * share (or clobber) each other's object identity indices. Named exports below are
 * thin wrappers taking an optional trailing `runtimeScope` (a Scene, a RuntimeContext,
 * or any ctx bag carrying one); omitting it falls back to one lazily-created default
 * context, preserving today's single-shared-registry behavior for unmigrated callers.
 */

import { attachDescriptorToObject } from "./objectDescriptorAttach.js";
import { createBucketIndexStore } from "./bucketIndex.js";
import { createObjTypeIndexStore } from "./objTypeIndex.js";
import { createDomainIndexStore } from "./domainIndex.js";
import { resolveRuntimeContext, attachRuntimeContext, detachRuntimeContext } from "../runtime/runtimeContext.js";

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeText(value) {
  return hasText(value) ? value.trim() : "";
}

function addToSetIndex(indexMap, key, object) {
  if (!hasText(key) || !object) {
    return;
  }
  let bucket = indexMap.get(key);
  if (!bucket) {
    bucket = new Set();
    indexMap.set(key, bucket);
  }
  bucket.add(object);
}

function removeFromSetIndex(indexMap, key, object) {
  if (!hasText(key) || !object) {
    return;
  }
  const bucket = indexMap.get(key);
  if (!bucket) {
    return;
  }
  bucket.delete(object);
  if (bucket.size === 0) {
    indexMap.delete(key);
  }
}

function extractRefName(descriptor) {
  if (!descriptor || typeof descriptor !== "object") {
    return "";
  }
  const candidates = [
    descriptor.refName,
    descriptor.runtimeRef,
    descriptor.ref
  ];
  for (let i = 0; i < candidates.length; i++) {
    const key = normalizeText(candidates[i]);
    if (key) {
      return key;
    }
  }
  return "";
}

/**
 * @param {{ bucketIndexStore?: ReturnType<typeof createBucketIndexStore>,
 *   objTypeIndexStore?: ReturnType<typeof createObjTypeIndexStore>,
 *   domainIndexStore?: ReturnType<typeof createDomainIndexStore> }} [deps]
 */
export function createObjectRegistryStore(deps = {}) {
  const bucketIndexStore = deps.bucketIndexStore ?? createBucketIndexStore();
  const objTypeIndexStore = deps.objTypeIndexStore ?? createObjTypeIndexStore();
  const domainIndexStore = deps.domainIndexStore ?? createDomainIndexStore();
  const ownerRuntimeContext = deps.ownerRuntimeContext ?? null;

  const byThreeJsonId = new Map();
  const byUuid = new Map();
  const byName = new Map();
  const byRefName = new Map();
  const objectMeta = new WeakMap();

  function ensureMeta(object) {
    let meta = objectMeta.get(object);
    if (!meta) {
      meta = {
        descriptor: null,
        lastIndexed: {
          uuid: "",
          threeJsonId: "",
          name: "",
          refName: ""
        },
        listenersBound: false
      };
      objectMeta.set(object, meta);
    }
    return meta;
  }

  function extractDescriptor(object, explicitDescriptor = null) {
    if (explicitDescriptor && typeof explicitDescriptor === "object" && !Array.isArray(explicitDescriptor)) {
      return explicitDescriptor;
    }
    const linked = object?.userData?.objJson;
    if (linked && typeof linked === "object" && !Array.isArray(linked)) {
      return linked;
    }
    const meta = object ? objectMeta.get(object) : null;
    return meta?.descriptor && typeof meta.descriptor === "object" ? meta.descriptor : null;
  }

  function unindexObject(object) {
    if (!object) {
      return;
    }
    const meta = ensureMeta(object);
    const prev = meta.lastIndexed || {};
    if (hasText(prev.threeJsonId)) {
      bucketIndexStore.clearBucketIndexesForThreeJsonId(prev.threeJsonId);
      objTypeIndexStore.clearObjTypeIndexesForThreeJsonId(prev.threeJsonId);
      domainIndexStore.clearDomainIndexesForThreeJsonId(prev.threeJsonId);
    }
    if (hasText(prev.uuid) && byUuid.get(prev.uuid) === object) {
      byUuid.delete(prev.uuid);
    }
    if (hasText(prev.threeJsonId) && byThreeJsonId.get(prev.threeJsonId) === object) {
      byThreeJsonId.delete(prev.threeJsonId);
    }
    removeFromSetIndex(byName, prev.name, object);
    if (hasText(prev.refName) && byRefName.get(prev.refName) === object) {
      byRefName.delete(prev.refName);
    }
    meta.lastIndexed = {
      uuid: "",
      threeJsonId: "",
      name: "",
      refName: ""
    };
    if (ownerRuntimeContext) {
      detachRuntimeContext(object);
    }
  }

  function indexObject(object, descriptor = null, bucketOptions = {}) {
    if (!object) {
      return object;
    }
    const meta = ensureMeta(object);
    const linkedDescriptor = attachDescriptorToObject(object, descriptor || meta.descriptor);
    if (linkedDescriptor) {
      meta.descriptor = linkedDescriptor;
    }
    if (!hasText(object.name) && hasText(linkedDescriptor?.name)) {
      object.name = linkedDescriptor.name.trim();
    }
    unindexObject(object);

    const uuidKey = normalizeText(object.uuid);
    const idKey = normalizeText(linkedDescriptor?.threeJsonId);
    const nameKey = normalizeText(object.name || linkedDescriptor?.name);
    const refNameKey = extractRefName(linkedDescriptor);

    if (uuidKey) {
      byUuid.set(uuidKey, object);
    }
    if (idKey) {
      byThreeJsonId.set(idKey, object);
    }
    addToSetIndex(byName, nameKey, object);
    if (refNameKey) {
      byRefName.set(refNameKey, object);
    }

    meta.lastIndexed = {
      uuid: uuidKey,
      threeJsonId: idKey,
      name: nameKey,
      refName: refNameKey
    };
    if (idKey) {
      bucketIndexStore.syncBucketIndexesForRecord(idKey, linkedDescriptor, bucketOptions);
      objTypeIndexStore.syncObjTypeIndexesForRecord(idKey, linkedDescriptor);
      domainIndexStore.syncDomainIndexesForRecord(idKey, linkedDescriptor);
    }
    if (ownerRuntimeContext) {
      attachRuntimeContext(object, ownerRuntimeContext);
    }
    return object;
  }

  function walkRegistrableObjects(root, rootDescriptor, visitor) {
    if (!root || typeof visitor !== "function") {
      return;
    }
    visitor(root, rootDescriptor);
    if (typeof root.traverse !== "function") {
      return;
    }
    root.traverse((child) => {
      if (!child || child === root) {
        return;
      }
      const descriptor = extractDescriptor(child);
      if (!descriptor) {
        return;
      }
      visitor(child, descriptor);
    });
  }

  function bindLifecycle(object) {
    if (!object || typeof object.addEventListener !== "function") {
      return;
    }
    const meta = ensureMeta(object);
    if (meta.listenersBound) {
      return;
    }
    object.addEventListener("removed", () => {
      unregisterObject(object, { recursive: true, keepDescriptor: true });
    });
    object.addEventListener("added", () => {
      registerObject(object, meta.descriptor, { recursive: true });
    });
    meta.listenersBound = true;
  }

  /**
   * Register an object and its identifiable children in the runtime registry.
   *
   * @param {import("three").Object3D|null|undefined} object
   * @param {object|null|undefined} [descriptor]
   * @param {{ recursive?: boolean }} [options]
   * @returns {import("three").Object3D|null|undefined}
   */
  function registerObject(object, descriptor = null, options = {}) {
    if (!object) {
      return object;
    }
    const recursive = options.recursive !== false;
    const bucketOptions = {
      bucketCtx: options.bucketCtx,
      customBuckets: options.customBuckets
    };
    if (!recursive) {
      bindLifecycle(object);
      indexObject(object, descriptor, bucketOptions);
      return object;
    }
    walkRegistrableObjects(object, descriptor, (node, desc) => {
      bindLifecycle(node);
      indexObject(node, desc, bucketOptions);
    });
    return object;
  }

  function refreshRegisteredObject(object, descriptor = null, options = {}) {
    return registerObject(object, descriptor, options);
  }

  /**
   * Remove an object and its registered children from the registry.
   *
   * @param {import("three").Object3D|null|undefined} object
   * @param {{ recursive?: boolean, keepDescriptor?: boolean }} [options]
   * @returns {import("three").Object3D|null|undefined}
   */
  function unregisterObject(object, options = {}) {
    if (!object) {
      return object;
    }
    const recursive = options.recursive !== false;
    const keepDescriptor = options.keepDescriptor !== false;
    if (!recursive || typeof object.traverse !== "function") {
      const meta = ensureMeta(object);
      unindexObject(object);
      if (!keepDescriptor) {
        meta.descriptor = null;
      }
      return object;
    }
    object.traverse((node) => {
      if (!node) {
        return;
      }
      const meta = ensureMeta(node);
      unindexObject(node);
      if (!keepDescriptor) {
        meta.descriptor = null;
      }
    });
    return object;
  }

  function clearObjectRegistry() {
    byThreeJsonId.clear();
    byUuid.clear();
    byName.clear();
    byRefName.clear();
    bucketIndexStore.clearAllBucketIndexes();
    objTypeIndexStore.clearAllObjTypeIndexes();
    domainIndexStore.clearAllDomainIndexes();
  }

  function getObjectByThreeJsonId(threeJsonId) {
    const key = normalizeText(threeJsonId);
    return key ? (byThreeJsonId.get(key) || null) : null;
  }

  function getObjectByUuid(uuid) {
    const key = normalizeText(uuid);
    return key ? (byUuid.get(key) || null) : null;
  }

  function getObjectByRefName(refName) {
    const key = normalizeText(refName);
    return key ? (byRefName.get(key) || null) : null;
  }

  function getObjectsByName(name) {
    const key = normalizeText(name);
    if (!key) {
      return [];
    }
    const bucket = byName.get(key);
    return bucket ? Array.from(bucket) : [];
  }

  function getObjectRegistrySnapshot() {
    return {
      threeJsonIdCount: byThreeJsonId.size,
      uuidCount: byUuid.size,
      nameCount: byName.size,
      refNameCount: byRefName.size
    };
  }

  function rebuildObjectRegistryFromScene(scene, options = {}) {
    if (options.clear !== false) {
      clearObjectRegistry();
    }
    if (!scene || typeof scene.traverse !== "function") {
      return getObjectRegistrySnapshot();
    }
    scene.traverse((object) => {
      if (!object || object === scene) {
        return;
      }
      const descriptor = extractDescriptor(object);
      if (!descriptor && !hasText(object.name)) {
        return;
      }
      registerObject(object, descriptor, { recursive: false });
    });
    return getObjectRegistrySnapshot();
  }

  return {
    bucketIndexStore,
    objTypeIndexStore,
    domainIndexStore,
    registerObject,
    refreshRegisteredObject,
    unregisterObject,
    clearObjectRegistry,
    getObjectByThreeJsonId,
    getObjectByUuid,
    getObjectByRefName,
    getObjectsByName,
    rebuildObjectRegistryFromScene,
    getObjectRegistrySnapshot,
    dispose: clearObjectRegistry
  };
}

function resolveStore(runtimeScope) {
  return resolveRuntimeContext(runtimeScope).objectRegistry;
}

export { setUserDataObjJson, attachDescriptorToObject } from "./objectDescriptorAttach.js";

export function registerObject(object, descriptor = null, options = {}, runtimeScope) {
  return resolveStore(runtimeScope ?? options.runtimeScope ?? object).registerObject(object, descriptor, options);
}

export function refreshRegisteredObject(object, descriptor = null, options = {}, runtimeScope) {
  return resolveStore(runtimeScope ?? options.runtimeScope ?? object).refreshRegisteredObject(object, descriptor, options);
}

export function unregisterObject(object, options = {}, runtimeScope) {
  return resolveStore(runtimeScope ?? options.runtimeScope ?? object).unregisterObject(object, options);
}

export function clearObjectRegistry(runtimeScope) {
  return resolveStore(runtimeScope).clearObjectRegistry();
}

export function getObjectByThreeJsonId(threeJsonId, runtimeScope) {
  return resolveStore(runtimeScope).getObjectByThreeJsonId(threeJsonId);
}

export function getObjectByUuid(uuid, runtimeScope) {
  return resolveStore(runtimeScope).getObjectByUuid(uuid);
}

export function getObjectByRefName(refName, runtimeScope) {
  return resolveStore(runtimeScope).getObjectByRefName(refName);
}

export function getObjectsByName(name, runtimeScope) {
  return resolveStore(runtimeScope).getObjectsByName(name);
}

export function rebuildObjectRegistryFromScene(scene, options = {}, runtimeScope) {
  return resolveStore(runtimeScope ?? scene).rebuildObjectRegistryFromScene(scene, options);
}

export function getObjectRegistrySnapshot(runtimeScope) {
  return resolveStore(runtimeScope).getObjectRegistrySnapshot();
}

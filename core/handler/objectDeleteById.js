import { disposeObjectTree, detachObjectTree } from "./disposeObjectTree.js";
import { getObjectByThreeJsonId } from "./objectRegistry.js";
import { getSystemBucketTagsForThreeJsonId } from "./bucketIndex.js";
import { inferSystemBucketTags } from "./inferSystemBucketTags.js";
import {
  buildObjectLifecyclePayload,
  createObjectLifecycleContext,
  notifyObjectDispose,
  recordHasObjectDisposeBinding,
  resolveObjectLifecycleContext
} from "../runtime/objectLifecycle/index.js";
import { log } from "../util/logger.js";

const PROTECTED_OBJ_TYPES = new Set([
  "scene",
  "camera",
  "renderer",
  "controls",
  "renderloop",
  "pass"
]);

const PROTECTED_SYSTEM_TAGS = new Set(["native-scene", "environment", "assist"]);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function normalizeObjType(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isObjectRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function extractDescriptor(object3D) {
  const userData = isObjectRecord(object3D?.userData) ? object3D.userData : null;
  const descriptor = userData?.objJson;
  return isObjectRecord(descriptor) ? descriptor : null;
}

function resolveParentThreeJsonId(object3D) {
  const parent = object3D?.parent;
  if (!parent) {
    return "";
  }
  const desc = extractDescriptor(parent);
  const id = typeof desc?.threeJsonId === "string" ? desc.threeJsonId.trim() : "";
  return id;
}

function collectSystemTags(descriptor, threeJsonId) {
  const tags = new Set(getSystemBucketTagsForThreeJsonId(threeJsonId));
  for (const tag of inferSystemBucketTags(descriptor, {})) {
    tags.add(tag);
  }
  return tags;
}

function isProtectedForRemoval(object3D, descriptor, threeJsonId) {
  const objType = normalizeObjType(descriptor?.objType);
  if (PROTECTED_OBJ_TYPES.has(objType)) {
    return true;
  }
  for (const tag of collectSystemTags(descriptor, threeJsonId)) {
    if (PROTECTED_SYSTEM_TAGS.has(tag)) {
      return true;
    }
  }
  return false;
}

function captureDescriptorSnapshot(object3D) {
  const descriptor = extractDescriptor(object3D);
  return descriptor ? cloneJson(descriptor) : null;
}

function captureRemovedSubtree(root, rootId) {
  const removedSubtree = [];
  if (!root || typeof root.traverse !== "function") {
    return removedSubtree;
  }
  root.traverse((node) => {
    if (!node || node === root) {
      return;
    }
    const descriptor = extractDescriptor(node);
    if (!descriptor) {
      return;
    }
    const id = typeof descriptor.threeJsonId === "string" ? descriptor.threeJsonId.trim() : "";
    if (!id || id === rootId) {
      return;
    }
    removedSubtree.push({
      threeJsonId: id,
      descriptor: cloneJson(descriptor),
      removedParentThreeJsonId: resolveParentThreeJsonId(node)
    });
  });
  return removedSubtree;
}

/**
 * Shared core for removing scene objects by threeJsonId (no commandResult / markDirty side effects).
 *
 * @param {import("three").Scene} scene
 * @param {string} threeJsonId
 * @param {object} [options]
 * @returns {{
 *   ok: boolean,
 *   error: string|null,
 *   threeJsonId: string,
 *   object3D: import("three").Object3D|null,
 *   protected?: boolean,
 *   descriptor?: object|null,
 *   removedDescriptor?: object|null,
 *   removedParentThreeJsonId?: string,
 *   removedSubtree?: Array<object>
 * }}
 */
function removeObjectByThreeJsonIdCore(scene, threeJsonId, options = {}) {
  if (!scene?.isScene) {
    return { ok: false, error: "scene must be a THREE.Scene.", threeJsonId: "", object3D: null };
  }
  const id = String(threeJsonId ?? "").trim();
  if (!id) {
    return { ok: false, error: "threeJsonId is required.", threeJsonId: "", object3D: null };
  }

  const object3D = getObjectByThreeJsonId(id);
  if (!object3D) {
    return { ok: false, error: `Object not found for threeJsonId "${id}".`, threeJsonId: id, object3D: null };
  }

  const descriptor = extractDescriptor(object3D);
  if (options.allowProtectedRemoval !== true && isProtectedForRemoval(object3D, descriptor, id)) {
    return {
      ok: false,
      error: "protected runtime object",
      threeJsonId: id,
      object3D: null,
      protected: true
    };
  }

  const removedDescriptor = captureDescriptorSnapshot(object3D);
  const removedParentThreeJsonId = resolveParentThreeJsonId(object3D);
  const removedSubtree =
    options.captureSubtree === true ? captureRemovedSubtree(object3D, id) : undefined;

  const detachOnly = options.detachOnly === true || options.disposeResources === false;
  const explicitLifecycleCtx = resolveObjectLifecycleContext(options);
  const lifecycleCtx =
    explicitLifecycleCtx || (recordHasObjectDisposeBinding(removedDescriptor) ? createObjectLifecycleContext(options) : null);

  if (!detachOnly && removedDescriptor && lifecycleCtx) {
    const hook = lifecycleCtx.callbacks?.onObjectBeforeRemove;
    if (hook) {
      try {
        hook(buildObjectLifecyclePayload(removedDescriptor));
      } catch (error) {
        log.warn("[objectLifecycle] onObjectBeforeRemove failed:", id, error);
      }
    }
  }

  if (detachOnly) {
    detachObjectTree(object3D);
  } else {
    disposeObjectTree(object3D);
  }

  const result = {
    ok: true,
    error: null,
    threeJsonId: id,
    object3D: null,
    descriptor: descriptor || null,
    removedDescriptor: removedDescriptor || null,
    removedParentThreeJsonId
  };
  if (removedSubtree) {
    result.removedSubtree = removedSubtree;
  }
  return result;
}

/**
 * Async delete with full object.dispose lifecycle (host hook + ELM) before GPU teardown.
 * @param {import("three").Scene} scene
 * @param {string} threeJsonId
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function removeObjectByThreeJsonIdCoreAsync(scene, threeJsonId, options = {}) {
  if (!scene?.isScene) {
    return { ok: false, error: "scene must be a THREE.Scene.", threeJsonId: "", object3D: null };
  }
  const id = String(threeJsonId ?? "").trim();
  if (!id) {
    return { ok: false, error: "threeJsonId is required.", threeJsonId: "", object3D: null };
  }

  const object3D = getObjectByThreeJsonId(id);
  if (!object3D) {
    return { ok: false, error: `Object not found for threeJsonId "${id}".`, threeJsonId: id, object3D: null };
  }

  const descriptor = extractDescriptor(object3D);
  if (options.allowProtectedRemoval !== true && isProtectedForRemoval(object3D, descriptor, id)) {
    return {
      ok: false,
      error: "protected runtime object",
      threeJsonId: id,
      object3D: null,
      protected: true
    };
  }

  const removedDescriptor = captureDescriptorSnapshot(object3D);
  const removedParentThreeJsonId = resolveParentThreeJsonId(object3D);
  const removedSubtree =
    options.captureSubtree === true ? captureRemovedSubtree(object3D, id) : undefined;

  const detachOnly = options.detachOnly === true || options.disposeResources === false;
  const explicitLifecycleCtx = resolveObjectLifecycleContext(options);
  const lifecycleCtx =
    explicitLifecycleCtx || (recordHasObjectDisposeBinding(removedDescriptor) ? createObjectLifecycleContext(options) : null);

  if (!detachOnly && removedDescriptor && lifecycleCtx) {
    await notifyObjectDispose(removedDescriptor, lifecycleCtx);
  }

  if (detachOnly) {
    detachObjectTree(object3D);
  } else {
    disposeObjectTree(object3D);
  }

  const result = {
    ok: true,
    error: null,
    threeJsonId: id,
    object3D: null,
    descriptor: descriptor || null,
    removedDescriptor: removedDescriptor || null,
    removedParentThreeJsonId
  };
  if (removedSubtree) {
    result.removedSubtree = removedSubtree;
  }
  return result;
}

export {
  removeObjectByThreeJsonIdCore,
  removeObjectByThreeJsonIdCoreAsync,
  resolveParentThreeJsonId
};

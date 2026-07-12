/**
 * Descriptor authoring side: partial merge, write transforms back from Object3D, trigger descriptor-binding dirty flags.
 *
 * The debounce-timer map is per RuntimeContext (see core/runtime/runtimeContext.js)
 * so two scenes editing objects that happen to share the same threeJsonId don't
 * cancel each other's pending write-back. Resolution is automatic (walks up from
 * the object to its attached scene context); omitting/lacking an attached context
 * falls back to one shared default store, matching today's behavior.
 */
import { syncBoxModelTransformFromObject3D } from "../builder/modelBuilder.js";
import { markDescriptorBindingJsonDirty } from "./sceneDescriptorBinding.js";
import { resolveRuntimeContext } from "../runtime/runtimeContext.js";

/**
 * Shallow-merge `partial` into `object.userData.objJson` (does not replace the entire userData).
 * @param {import("three").Object3D|null|undefined} object
 * @param {object} partial
 * @param {{ markBindingDirty?: boolean }} [options]
 * @returns {object|null} Updated objJson
 */
function patchObjectDescriptor(object, partial, options = {}) {
  if (!object || !partial || typeof partial !== "object" || Array.isArray(partial)) {
    return object?.userData?.objJson || null;
  }
  const u = object.userData && typeof object.userData === "object" ? object.userData : {};
  object.userData = u;
  const prev = u.objJson && typeof u.objJson === "object" && !Array.isArray(u.objJson) ? u.objJson : {};
  u.objJson = { ...prev, ...partial };
  const mark = options.markBindingDirty !== false;
  if (mark) {
    markDescriptorBindingJsonDirty(u.objJson, object);
  }
  return u.objJson;
}

/**
 * Write current Object3D position / rotation / scale back to `userData.objJson` (same fields as box descriptors).
 * @param {import("three").Object3D|null|undefined} object
 * @param {{ markBindingDirty?: boolean }} [options]
 * @returns {boolean}
 */
function reconcileTransformToDescriptor(object, options = {}) {
  if (!object) {
    return false;
  }
  const ok = syncBoxModelTransformFromObject3D(object);
  if (ok && options.markBindingDirty !== false) {
    const j = object.userData?.objJson;
    if (j) {
      markDescriptorBindingJsonDirty(j, object);
    }
  }
  return ok;
}

export function createDescriptorSyncStore() {
  /** @type {Map<string, ReturnType<typeof setTimeout>>} */
  const reconcileThrottleTimers = new Map();

  function resolveThrottleId(object) {
    const j = object.userData?.objJson;
    return (
      (j && typeof j.threeJsonId === "string" && j.threeJsonId.trim()) ||
      (typeof object.uuid === "string" && object.uuid) ||
      "__anon__"
    );
  }

  function scheduleThrottledReconcileTransform(object, options = {}) {
    if (!object) {
      return;
    }
    const id = resolveThrottleId(object);
    const delayMs = Math.max(0, Number(options.delayMs) || 48);
    const prev = reconcileThrottleTimers.get(id);
    if (prev) {
      clearTimeout(prev);
    }
    reconcileThrottleTimers.set(
      id,
      setTimeout(() => {
        reconcileThrottleTimers.delete(id);
        reconcileTransformToDescriptor(object, {
          markBindingDirty: options.markBindingDirty !== false
        });
      }, delayMs)
    );
  }

  function cancelThrottledReconcileTransform(object) {
    if (!object) {
      return;
    }
    const id = resolveThrottleId(object);
    const t = reconcileThrottleTimers.get(id);
    if (t) {
      clearTimeout(t);
      reconcileThrottleTimers.delete(id);
    }
  }

  function clearAll() {
    for (const t of reconcileThrottleTimers.values()) {
      clearTimeout(t);
    }
    reconcileThrottleTimers.clear();
  }

  return {
    scheduleThrottledReconcileTransform,
    cancelThrottledReconcileTransform,
    dispose: clearAll
  };
}

function resolveStore(runtimeScope) {
  return resolveRuntimeContext(runtimeScope).descriptorSync;
}

/**
 * Hybrid: debounce Object3D → objJson write-back to reduce sync pressure during high-frequency drags.
 * Last call wins; `markBindingDirty` runs once on the actual flush by default.
 *
 * @param {import("three").Object3D|null|undefined} object
 * @param {{ delayMs?: number, markBindingDirty?: boolean }} [options]
 */
function scheduleThrottledReconcileTransform(object, options = {}) {
  return resolveStore(object).scheduleThrottledReconcileTransform(object, options);
}

/**
 * Cancel pending debounced write-back (does not trigger a write-back).
 * @param {import("three").Object3D|null|undefined} object
 */
function cancelThrottledReconcileTransform(object) {
  return resolveStore(object).cancelThrottledReconcileTransform(object);
}

export {
  patchObjectDescriptor,
  reconcileTransformToDescriptor,
  scheduleThrottledReconcileTransform,
  cancelThrottledReconcileTransform
};

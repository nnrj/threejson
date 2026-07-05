/**
 * Descriptor authoring side: partial merge, write transforms back from Object3D, trigger descriptor-binding dirty flags.
 */
import { syncBoxModelTransformFromObject3D } from "../builder/modelBuilder.js";
import { markDescriptorBindingJsonDirty } from "./sceneDescriptorBinding.js";

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
    markDescriptorBindingJsonDirty(u.objJson);
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
      markDescriptorBindingJsonDirty(j);
    }
  }
  return ok;
}

/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const reconcileThrottleTimers = new Map();

/**
 * Hybrid: debounce Object3D → objJson write-back to reduce sync pressure during high-frequency drags.
 * Last call wins; `markBindingDirty` runs once on the actual flush by default.
 *
 * @param {import("three").Object3D|null|undefined} object
 * @param {{ delayMs?: number, markBindingDirty?: boolean }} [options]
 */
function scheduleThrottledReconcileTransform(object, options = {}) {
  if (!object) {
    return;
  }
  const j = object.userData?.objJson;
  const id =
    (j && typeof j.threeJsonId === "string" && j.threeJsonId.trim()) ||
    (typeof object.uuid === "string" && object.uuid) ||
    "__anon__";
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

/**
 * Cancel pending debounced write-back (does not trigger a write-back).
 * @param {import("three").Object3D|null|undefined} object
 */
function cancelThrottledReconcileTransform(object) {
  if (!object) {
    return;
  }
  const j = object.userData?.objJson;
  const id =
    (j && typeof j.threeJsonId === "string" && j.threeJsonId.trim()) ||
    (typeof object.uuid === "string" && object.uuid) ||
    "__anon__";
  const t = reconcileThrottleTimers.get(id);
  if (t) {
    clearTimeout(t);
    reconcileThrottleTimers.delete(id);
  }
}

export {
  patchObjectDescriptor,
  reconcileTransformToDescriptor,
  scheduleThrottledReconcileTransform,
  cancelThrottledReconcileTransform
};

/**
 * Pure attach helpers for objects and descriptors (`userData.objJson`); no registry side effects.
 * Split from {@link ./objectRegistry.js} so objectRegistry can focus on indexing and lifecycle.
 */
import { cloneJson } from "../util/cloneJson.js";

/**
 * Write `userData.objJson` while preserving other existing userData keys (does not replace userData with descriptor only).
 * Descriptor is decoupled from deploy input record: always deep-cloned on attach.
 * @param {import("three").Object3D|null|undefined} object
 * @param {object} objJson
 * @returns {import("three").Object3D|null|undefined}
 */
function setUserDataObjJson(object, objJson) {
  if (!object || objJson == null || typeof objJson !== "object" || Array.isArray(objJson)) {
    return object;
  }
  const prev = object.userData && typeof object.userData === "object" ? object.userData : {};
  object.userData = { ...prev, objJson: cloneJson(objJson) };
  return object;
}

/**
 * Ensure `userData.objJson` matches the descriptor reference; attach `descriptor` when objJson is missing.
 * @param {import("three").Object3D|null|undefined} object
 * @param {object} descriptor
 * @returns {object|null|undefined}
 */
function attachDescriptorToObject(object, descriptor) {
  if (!object || !descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
    return descriptor;
  }
  const prev = object.userData && typeof object.userData === "object" ? { ...object.userData } : {};
  object.userData = prev;
  if (!object.userData.objJson || typeof object.userData.objJson !== "object") {
    object.userData.objJson = descriptor;
  }
  return object.userData.objJson;
}

export { setUserDataObjJson, attachDescriptorToObject };

/**
 * L3: apply RFC 6902 JSON Patch to `userData.objJson` (allowlisted paths).
 * Import from package entry `threejson/patch` on demand to avoid default bundle dependency.
 */
import { applyJsonPatchToJsonDocument, DEFAULT_ALLOWED_PREFIXES } from "./jsonPatchApplyCore.js";
import { markDescriptorBindingJsonDirty } from "./sceneDescriptorBinding.js";

/**
 * @param {import("three").Object3D} object
 * @param {object[]} patch RFC6902 operation array
 * @param {{ allowedPathPrefixes?: string[], markBindingDirty?: boolean }} [options]
 * @returns {{ ok: boolean, error?: string }}
 */
function applyJsonPatchToObjectDescriptor(object, patch, options = {}) {
  if (!object) {
    return { ok: false, error: "missing object" };
  }
  const u = object.userData && typeof object.userData === "object" ? object.userData : {};
  object.userData = u;
  if (!u.objJson || typeof u.objJson !== "object" || Array.isArray(u.objJson)) {
    u.objJson = {};
  }
  const r = applyJsonPatchToJsonDocument(u.objJson, patch, options);
  if (!r.ok) {
    return r;
  }
  if (options.markBindingDirty !== false) {
    markDescriptorBindingJsonDirty(u.objJson);
  }
  return { ok: true };
}

export { applyJsonPatchToObjectDescriptor, DEFAULT_ALLOWED_PREFIXES };

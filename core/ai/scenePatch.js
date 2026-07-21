/**
 * Scene-level RFC 6902 patch helpers for optional incremental AI updates.
 */
import { applyJsonPatchToJsonDocument } from "../handler/jsonPatchApplyCore.js";
import { sanitizeAiJsonText, stripMarkdownCodeFence } from "./sceneJsonSanitize.js";

/** Paths the scene editor / normalizer accept for AI incremental edits. */
const SCENE_PATCH_ALLOWED_PREFIXES = [
  "/threeJsonId",
  "/worldInfo",
  "/sceneConfig",
  "/controlsConfig",
  "/businessInfo",
  "/objectList",
  "/extensions"
];

/**
 * @param {string} rawText
 * @returns {object[]}
 */
function extractPatchOperations(rawText) {
  if (typeof rawText !== "string" || !rawText.trim()) {
    throw new Error("AI patch response is empty.");
  }
  const fenced = rawText.match(/```[ \t]*(?:json|threejson)?[ \t]*(?:\r?\n|$)([\s\S]*?)(?:\r?\n)?[ \t]*```/i);
  const body = sanitizeAiJsonText((fenced && fenced[1] ? fenced[1] : stripMarkdownCodeFence(rawText)).trim());
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    const arrStart = body.indexOf("[");
    const arrEnd = body.lastIndexOf("]");
    if (arrStart >= 0 && arrEnd > arrStart) {
      parsed = JSON.parse(sanitizeAiJsonText(body.slice(arrStart, arrEnd + 1)));
    } else {
      throw new Error(`Invalid patch JSON: ${err?.message || err}`);
    }
  }
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (parsed && Array.isArray(parsed.patch)) {
    return parsed.patch;
  }
  if (parsed && Array.isArray(parsed.operations)) {
    return parsed.operations;
  }
  throw new Error("Patch response must be a JSON array or { patch: [...] }.");
}

/**
 * @param {object} sceneObj
 * @param {object[]} patch
 * @returns {{ ok: boolean, scene?: object, error?: string }}
 */
function applySceneJsonPatch(sceneObj, patch) {
  const doc = JSON.parse(JSON.stringify(sceneObj));
  const result = applyJsonPatchToJsonDocument(doc, patch, {
    allowedPathPrefixes: SCENE_PATCH_ALLOWED_PREFIXES
  });
  if (!result.ok) {
    return result;
  }
  return { ok: true, scene: doc };
}

export {
  SCENE_PATCH_ALLOWED_PREFIXES,
  extractPatchOperations,
  applySceneJsonPatch
};

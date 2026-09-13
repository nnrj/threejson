/**
 * Structural scene JSON validation (no tools/common/editor-single dependency).
 */
import { analyzeSceneUsage } from "../capabilities/sceneUsage.js";
import { sanitizeAiJsonText } from "../util/sceneJsonSanitize.js";
import { DEFAULT_FRIENDLY_SCENE_LIST_ORDER } from "./sceneFriendlyMap.js";
import { isLoadableScenePayload, normalizeScenePayload } from "./sceneFriendlyNormalizer.js";

/**
 * @param {string} sceneJsonString
 * @returns {object}
 */
function parseSceneJsonForValidation(sceneJsonString) {
  const sanitized = sanitizeAiJsonText(String(sceneJsonString || "").trim());
  return JSON.parse(sanitized);
}

/**
 * @param {object} worldInfo
 * @returns {number}
 */
function countFriendlyListItems(worldInfo) {
  if (!worldInfo || typeof worldInfo !== "object") {
    return 0;
  }
  let total = 0;
  for (let i = 0; i < DEFAULT_FRIENDLY_SCENE_LIST_ORDER.length; i += 1) {
    const listName = DEFAULT_FRIENDLY_SCENE_LIST_ORDER[i];
    const arr = worldInfo[listName];
    if (Array.isArray(arr)) {
      total += arr.length;
    }
  }
  return total;
}

/**
 * Fast structural validation (no handler graph import).
 * @param {string} sceneJsonString
 * @returns {{ ok: boolean, error?: string, boxCount?: number, objectCount?: number, friendlyCount?: number, usage?: object }}
 */
export function validateSceneJson(sceneJsonString) {
  try {
    const parsed = parseSceneJsonForValidation(sceneJsonString);
    if (!isLoadableScenePayload(parsed)) {
      return { ok: false, error: "missing worldInfo or standard objectList/sceneConfig" };
    }
    const normalized = normalizeScenePayload(parsed);
    // Count authored records, not synthetic scene/camera records injected by normalization.
    const objectCount = Array.isArray(parsed.objectList) ? parsed.objectList.length
      : normalized.objectList.filter((record) => !["scene", "camera", "light"].includes(record.objType)).length;
    const wi = parsed.worldInfo;
    const hasFriendly = wi && typeof wi === "object";
    const friendlyCount = hasFriendly ? countFriendlyListItems(wi) : 0;
    const boxCount = hasFriendly && Array.isArray(wi.boxModelList) ? wi.boxModelList.length : 0;
    const usage = analyzeSceneUsage(parsed);
    if (objectCount === 0 && friendlyCount === 0) {
      return {
        ok: false,
        error:
          "scene has no deployable content (objectList and friendly worldInfo lists are all empty)"
      };
    }
    return {
      ok: true,
      boxCount,
      objectCount,
      friendlyCount,
      usage: {
        listsUsed: usage.listsUsed,
        objTypes: [...usage.objTypes],
        totalItems: usage.totalItems
      }
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

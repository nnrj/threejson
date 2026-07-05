/**
 * Structural scene JSON validation (no tools/common/editor-single dependency).
 */
import { analyzeSceneUsage } from "../ai/sceneCapability.js";
import { sanitizeAiJsonText } from "../ai/sceneJsonSanitize.js";
import { DEFAULT_FRIENDLY_SCENE_LIST_ORDER } from "./sceneFriendlyMap.js";
import { isLoadableScenePayload } from "./sceneFriendlyNormalizer.js";

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
    const objectCount = Array.isArray(parsed.objectList) ? parsed.objectList.length : 0;
    const wi = parsed.worldInfo;
    const hasFriendly = wi && typeof wi === "object";
    if (hasFriendly && !Array.isArray(wi.boxModelList)) {
      return { ok: false, error: "missing boxModelList" };
    }
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

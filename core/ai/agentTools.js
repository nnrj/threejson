/**
 * Read-only / dry-run tools for the scene agent loop.
 */
import { parseSceneJsonString, requestChatCompletion } from "./sceneAiService.js";
import {
  THREE_JSON_SCENE_SCHEMA_DESCRIPTION,
  THREE_JSON_CORE_CAPABILITIES,
  buildSceneCapabilityCatalog,
  buildSceneOutlineSystemPrompt,
  buildSceneReviewSystemPrompt
} from "./threeJsonCoreSkill.js";
import {
  analyzeSceneUsage,
  buildCapabilityFixPrompt,
  evaluateCapabilityFit
} from "./sceneCapability.js";
import { validateSceneJson } from "../handler/sceneJsonValidate.js";
import { DEFAULT_FRIENDLY_SCENE_LIST_ORDER } from "../handler/sceneFriendlyMap.js";

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
 * Engine-aligned validation via {@link normalizeScenePayload} (dynamic import).
 * @param {string} sceneJsonString
 * @returns {Promise<{ ok: boolean, error?: string, boxCount?: number, objectCount?: number, friendlyCount?: number, usage?: object }>}
 */
async function validateSceneJsonWithNormalizer(sceneJsonString) {
  try {
    const { normalizeScenePayload } = await import("../handler/sceneFriendlyNormalizer.js");
    const parsed = parseSceneJsonString(String(sceneJsonString || ""));
    const normalized = normalizeScenePayload(parsed);
    const objectCount = Array.isArray(normalized.objectList) ? normalized.objectList.length : 0;
    const wi = normalized.worldInfo || parsed.worldInfo;
    const friendlyCount = countFriendlyListItems(wi);
    const boxCount = Array.isArray(wi?.boxModelList) ? wi.boxModelList.length : 0;
    const usage = analyzeSceneUsage(parsed);
    if (objectCount === 0 && friendlyCount === 0) {
      return {
        ok: false,
        error:
          "normalizeScenePayload: no deployable content after normalization"
      };
    }
    return {
      ok: true,
      boxCount,
      objectCount,
      friendlyCount,
      engineAligned: true,
      usage: {
        listsUsed: usage.listsUsed,
        objTypes: [...usage.objTypes],
        totalItems: usage.totalItems
      }
    };
  } catch (err) {
    return { ok: false, engineAligned: true, error: String(err?.message || err), code: err?.code || "SCENE_NORMALIZATION_FAILED" };
  }
}

/**
 * @param {string} prompt
 * @param {object} sceneObj
 * @returns {{ ok: boolean, matchedSignals: string[], gaps: string[], blockoutOk: boolean }}
 */
function evaluateSceneCapabilityFit(prompt, sceneObj) {
  return evaluateCapabilityFit(prompt, sceneObj);
}

/**
 * @param {number} [maxChars=Infinity] Optional host-requested excerpt; full schema by default.
 * @returns {string}
 */
function summarizeSchema(maxChars = Infinity) {
  const text = [
    buildSceneCapabilityCatalog().trim(),
    THREE_JSON_CORE_CAPABILITIES.trim(),
    THREE_JSON_SCENE_SCHEMA_DESCRIPTION.trim()
  ].join("\n\n");
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n...(truncated)`;
}

/**
 * @param {object} params
 * @param {string} params.prompt
 * @param {string} [params.mode]
 * @param {object} chatOptions
 * @returns {Promise<string>}
 */
async function requestSceneOutline({ prompt, mode = "generate" }, chatOptions = {}) {
  const content = await requestChatCompletion({
    ...chatOptions,
    temperature: chatOptions.temperature ?? 0.3,
    taskKind: chatOptions.taskKind || "scene_outline",
    messages: [
      {
        role: "system",
        content: buildSceneOutlineSystemPrompt()
      },
      {
        role: "user",
        content: `Mode: ${mode}\nUser request:\n${String(prompt || "").trim()}`
      }
    ]
  });
  return String(content || "").trim();
}

/**
 * @param {string} sceneJsonString
 * @param {string} userPrompt
 * @param {{ ok?: boolean, gaps?: string[] }} [capabilityFit]
 * @returns {string}
 */
function buildLayoutReviewPrompt(sceneJsonString, userPrompt, capabilityFit) {
  const capabilityBlock =
    capabilityFit && capabilityFit.gaps && capabilityFit.gaps.length > 0
      ? `Capability gaps to address:\n${capabilityFit.gaps.map((g) => `- ${g}`).join("\n")}`
      : "";
  return [
    buildSceneReviewSystemPrompt(),
    "",
    `User intent: ${userPrompt}`,
    capabilityBlock,
    "Review spatial composition, visibility, scale, and material semantics only. Preserve all existing texture URL fields exactly; texture acquisition is handled separately after rendering.",
    "Return the full corrected scene JSON only.",
    "",
    sceneJsonString
  ].join("\n");
}

export {
  validateSceneJson,
  validateSceneJsonWithNormalizer,
  evaluateSceneCapabilityFit,
  buildCapabilityFixPrompt,
  summarizeSchema,
  requestSceneOutline,
  buildLayoutReviewPrompt
};

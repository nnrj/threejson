/**
 * Read-only / dry-run tools for the scene agent loop.
 */
import { parseSceneJsonString, requestChatCompletion } from "./sceneAiService.js";
import { planTextures } from "./textureAiService.js";
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
import { listTextureUrlPointers } from "./textureAiService.js";
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
    return validateSceneJson(sceneJsonString);
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
 * @param {string|object} sceneJsonStringOrObject
 * @returns {{ count: number, pointers: string[] }}
 */
function listTexturePointersSummary(sceneJsonStringOrObject) {
  const obj =
    typeof sceneJsonStringOrObject === "string"
      ? parseSceneJsonString(sceneJsonStringOrObject)
      : sceneJsonStringOrObject;
  const pointers = listTextureUrlPointers(obj);
  return { count: pointers.length, pointers: pointers.slice(0, 40) };
}

/**
 * @param {number} [maxChars=4200]
 * @returns {string}
 */
function summarizeSchema(maxChars = 4200) {
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
 * @param {string|object} sceneJsonStringOrObject
 * @param {string} userHint
 * @param {object} chatOptions
 * @returns {Promise<{ taskCount: number, tasks: object[], note: string }>}
 */
async function planTexturesDry(sceneJsonStringOrObject, userHint = "", chatOptions = {}) {
  const planned = await planTextures(sceneJsonStringOrObject, userHint, chatOptions);
  const tasks = planned?.tasks || [];
  return {
    taskCount: tasks.length,
    tasks: tasks.slice(0, 20),
    note:
      "Dry plan only. Browser cannot save textures locally without a custom sink; use the external Python/Node tool to fill textureUrl."
  };
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
    maxTokens: chatOptions.maxTokens || 1200,
    temperature: chatOptions.temperature ?? 0.3,
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
 * @param {{ count: number, pointers: string[] }} pointerSummary
 * @param {{ ok?: boolean, gaps?: string[] }} [capabilityFit]
 * @returns {string}
 */
function buildLayoutReviewPrompt(sceneJsonString, userPrompt, pointerSummary, capabilityFit) {
  const pointerBlock =
    pointerSummary.count > 0
      ? `TextureUrl slots (${pointerSummary.count}): ${pointerSummary.pointers.join(", ")}`
      : "No textureUrl slots detected.";
  const capabilityBlock =
    capabilityFit && capabilityFit.gaps && capabilityFit.gaps.length > 0
      ? `Capability gaps to address:\n${capabilityFit.gaps.map((g) => `- ${g}`).join("\n")}`
      : "";
  return [
    buildSceneReviewSystemPrompt(),
    "",
    `User intent: ${userPrompt}`,
    pointerBlock,
    capabilityBlock,
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
  listTexturePointersSummary,
  summarizeSchema,
  planTexturesDry,
  requestSceneOutline,
  buildLayoutReviewPrompt
};

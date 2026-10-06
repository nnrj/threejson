import {
  buildSanitizedJsonParseErrorMessage,
  sanitizeAiJsonText
} from "../util/sceneJsonSanitize.js";
import { isLoadableScenePayload } from "./sceneFriendlyNormalizer.js";
import { classifyJsonPrefix } from "../util/jsonPrefix.js";

function sceneParseError(text, cause) {
  return Object.assign(new SyntaxError(buildSanitizedJsonParseErrorMessage(text, cause), { cause }), {
    code: classifyJsonPrefix(text).status === "incomplete" ? "SCENE_JSON_TRUNCATED" : "SCENE_JSON_INVALID"
  });
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate and normalize a parsed ThreeJSON scene document without loading any AI capability.
 * Empty deployable collection placeholders are pruned, matching the historical parser behavior.
 */
function normalizeSceneJsonObject(sceneObj) {
  if (!isObject(sceneObj)) {
    throw new Error("Generated scene JSON must be an object.");
  }
  if (!isLoadableScenePayload(sceneObj)) {
    throw new Error(
      "Generated scene JSON must contain worldInfo or standard objectList/sceneConfig."
    );
  }
  if (isObject(sceneObj.worldInfo)) {
    for (const [key, value] of Object.entries(sceneObj.worldInfo)) {
      if (Array.isArray(value) && value.length === 0) {
        delete sceneObj.worldInfo[key];
      }
    }
  }
  for (const key of ["objectList", "assetLibrary"]) {
    if (Array.isArray(sceneObj[key]) && sceneObj[key].length === 0) {
      delete sceneObj[key];
    }
  }
  return sceneObj;
}

/** Parse tolerant scene JSON text and require a loadable ThreeJSON document. */
function parseSceneJsonString(sceneJsonString) {
  const raw = String(sceneJsonString || "").trim();
  const sanitized = sanitizeAiJsonText(raw);
  let parsed;
  try {
    parsed = JSON.parse(sanitized);
  } catch (error) {
    throw sceneParseError(sanitized, error);
  }
  return normalizeSceneJsonObject(parsed);
}

/** Parse the same tolerant syntax without requiring a complete scene document. */
function parseJsonObjectWithoutSceneValidation(sceneJsonString) {
  const sanitized = sanitizeAiJsonText(String(sceneJsonString || "").trim());
  let parsed;
  try {
    parsed = JSON.parse(sanitized);
  } catch (error) {
    throw sceneParseError(sanitized, error);
  }
  if (!isObject(parsed)) {
    throw new Error("Generated scene JSON must be an object.");
  }
  return parsed;
}

export {
  normalizeSceneJsonObject,
  parseJsonObjectWithoutSceneValidation,
  parseSceneJsonString
};

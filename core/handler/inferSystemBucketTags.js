/**
 * Infer systemBucket tag list from object record and optional deploy context (may yield multiple tags).
 */
import { resolveParseMode } from "./nativeParseMode.js";

const ASSIST_OBJ_TYPES = new Set([
  "gridhelper",
  "axeshelper",
  "boxhelper",
  "transformcontrolshelper"
]);

const MODEL_OBJ_TYPES = new Set(["externalmodel", "objmodel", "skinned"]);

const RUNTIME_SPLIT_OBJ_TYPES = new Set([
  "scene",
  "camera",
  "renderer",
  "controls",
  "renderloop",
  "pass"
]);

function normalizeObjType(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * @param {object|null|undefined} record
 * @param {object} [ctx]
 * @param {string} [ctx.deployKind] e.g. `"native-scene"`
 * @param {boolean} [ctx.isRuntimeSpawn] Interactive spawn, temporary Object3D
 * @returns {string[]}
 */
export function inferSystemBucketTags(record, ctx = {}) {
  if (!record || typeof record !== "object") {
    return [];
  }

  const tags = new Set();
  const objType = normalizeObjType(record.objType);

  if (ctx.deployKind === "native-scene") {
    tags.add("native-scene");
    return [...tags];
  }

  if (ctx.isRuntimeSpawn === true) {
    tags.add("temp");
  }

  if (ASSIST_OBJ_TYPES.has(objType)) {
    tags.add("assist");
    return [...tags];
  }

  if (objType === "light" || objType === "camera") {
    tags.add("environment");
    return [...tags];
  }

  if (objType === "native" || resolveParseMode(record, ctx) === "native") {
    tags.add("native-record");
  }

  if (objType === "domain") {
    tags.add("domain");
    tags.add("objects");
    return [...tags];
  }

  if (MODEL_OBJ_TYPES.has(objType)) {
    tags.add("models");
    tags.add("objects");
    return [...tags];
  }

  if (objType && !RUNTIME_SPLIT_OBJ_TYPES.has(objType)) {
    tags.add("objects");
  }

  return [...tags];
}

export {
  ASSIST_OBJ_TYPES,
  MODEL_OBJ_TYPES,
  normalizeObjType as normalizeBucketObjType
};

/**
 * parseMode routing: auto | native | default
 */

const PARSE_MODES = new Set(["auto", "native", "default"]);

function normalizeObjType(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * @param {object} [record]
 * @param {object} [ctxOrOptions]
 * @returns {"auto"|"native"|"default"}
 */
export function resolveParseMode(record, ctxOrOptions = {}) {
  const rawRecord = typeof record?.parseMode === "string" ? record.parseMode.trim().toLowerCase() : "";
  if (PARSE_MODES.has(rawRecord)) {
    return /** @type {"auto"|"native"|"default"} */ (rawRecord);
  }
  const sceneConfig =
    ctxOrOptions?.sceneConfig ??
    ctxOrOptions?.sceneJsonRoot?.sceneConfig ??
    ctxOrOptions?.jsonData?.sceneConfig ??
    null;
  const rawScene =
    sceneConfig && typeof sceneConfig.parseMode === "string"
      ? sceneConfig.parseMode.trim().toLowerCase()
      : "";
  if (PARSE_MODES.has(rawScene)) {
    return /** @type {"auto"|"native"|"default"} */ (rawScene);
  }
  return "auto";
}

/**
 * @param {object} record
 * @param {object} [ctx]
 * @returns {boolean}
 */
export function shouldDeployNativeOnly(record, ctx) {
  if (!record || typeof record !== "object") {
    return false;
  }
  if (resolveParseMode(record, ctx) === "native") {
    return true;
  }
  return normalizeObjType(record.objType) === "native";
}

/**
 * @param {object} record
 * @param {object} [ctx]
 * @returns {boolean}
 */
export function shouldTryNativeFallback(record, ctx) {
  return resolveParseMode(record, ctx) === "auto";
}

/**
 * @param {object} record
 * @param {object} [options]
 * @returns {boolean}
 */
export function shouldDeferBoxCoerce(record, options = {}) {
  const mode = resolveParseMode(record, options);
  if (mode === "default") {
    return false;
  }
  if (normalizeObjType(record?.objType) === "native") {
    return true;
  }
  return mode === "auto" || mode === "native";
}

/**
 * @param {object} record
 * @param {object} [ctxOrOptions]
 * @returns {boolean}
 */
export function isNativeShapeHeuristicEnabled(record, ctxOrOptions = {}) {
  if (record && record.nativeShapeHeuristic === true) {
    return true;
  }
  if (record && record.nativeShapeHeuristic === false) {
    return false;
  }
  const sceneConfig =
    ctxOrOptions?.sceneConfig ??
    ctxOrOptions?.sceneJsonRoot?.sceneConfig ??
    ctxOrOptions?.jsonData?.sceneConfig ??
    null;
  return Boolean(sceneConfig && sceneConfig.nativeShapeHeuristic === true);
}

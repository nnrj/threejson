function hasOwn(value, key) {
  return Boolean(value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key));
}

function recordDeclaresSceneBackground(record) {
  return String(record?.objType || "").trim().toLowerCase() === "scene"
    && hasOwn(record, "background");
}

/**
 * Detect an authored scene background without interpreting its value. An explicit `null` is still
 * an author decision and must not be replaced by the Shower UI theme.
 */
export function sceneJsonDeclaresBackground(sceneJson) {
  if (!sceneJson || typeof sceneJson !== "object") return false;
  if (hasOwn(sceneJson.sceneConfig?.scene, "background")) return true;
  if (hasOwn(sceneJson.sceneConfig, "background")) return true;

  const recordLists = [
    sceneJson.objectList,
    sceneJson.worldInfo?.objectList
  ];
  return recordLists.some((records) => Array.isArray(records) && records.some(recordDeclaresSceneBackground));
}

/**
 * The host theme is only a fallback. Runtime-provided backgrounds include native scene backdrops,
 * domain-created skies, and backgrounds resolved from ThreeJSON descriptors.
 */
export function shouldApplyThemeSceneBackground({
  sceneJson,
  runtimeBackground,
  usingThemeFallback = false
} = {}) {
  if (usingThemeFallback) return true;
  if (sceneJsonDeclaresBackground(sceneJson)) return false;
  return runtimeBackground == null;
}

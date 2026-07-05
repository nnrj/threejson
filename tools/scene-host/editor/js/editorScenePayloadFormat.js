import { resolveScenePayloadForLoad } from "threejson";
import { detectScenePayloadViewFormat } from "../../../../core/handler/sceneFriendlyNormalizer.js";

function resolveFriendlyMapFromPayload(payload = {}) {
  if (payload?.friendlyMap && typeof payload.friendlyMap === "object") {
    return payload.friendlyMap;
  }
  if (payload?.worldInfo?.friendlyMap && typeof payload.worldInfo.friendlyMap === "object") {
    return payload.worldInfo.friendlyMap;
  }
  return undefined;
}

export function createEditorScenePayloadFormat(host) {
  let loadedFormat = "standard";
  let loadedFriendlyMap = null;

  function recordEditorScenePayloadViewFormat(rawPayload, hintLabel = "") {
    const resolved = resolveScenePayloadForLoad(rawPayload, { label: hintLabel });
    if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) {
      return;
    }
    loadedFormat = detectScenePayloadViewFormat(resolved);
    loadedFriendlyMap = resolveFriendlyMapFromPayload(resolved);
  }

  function resolveEditorSceneJsonDisplayFormat() {
    const pref = host.getEditorSettings()?.sceneJson?.codeViewFormat ?? "auto";
    if (pref === "friendly" || pref === "standard") {
      return pref;
    }
    return loadedFormat === "friendly" ? "friendly" : "standard";
  }

  function resolveEditorSceneJsonFriendlyMapForDisplay() {
    return (
      loadedFriendlyMap ??
      resolveFriendlyMapFromPayload(host.getSysConfig()?.jsonData) ??
      host.resolveFriendlyMapFromPayload?.(host.getSysConfig()?.jsonData)
    );
  }

  function buildSceneToJsonOptionsForDisplay(extra = {}) {
    const format = resolveEditorSceneJsonDisplayFormat();
    const subSceneLayout = extra.subSceneLayout ?? host.getEditorSettings()?.sceneJson?.subSceneLayout ?? "nested";
    const options = host.buildSceneToJsonOptions?.({
      ...extra,
      subSceneLayout,
      format
    });
    if (format === "friendly") {
      options.friendlyMap = resolveEditorSceneJsonFriendlyMapForDisplay();
    }
    return options;
  }

  function reset() {
    loadedFormat = "standard";
    loadedFriendlyMap = null;
  }

  return {
    recordEditorScenePayloadViewFormat,
    resolveEditorSceneJsonDisplayFormat,
    resolveEditorSceneJsonFriendlyMapForDisplay,
    buildSceneToJsonOptionsForDisplay,
    reset
  };
}

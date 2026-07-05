import {
  parseSceneJsonString,
  resolveScenePayloadForLoad,
  sceneToStandardJsonSimple
} from "threejson";
import { SceneExportBlockedError } from "../../../../core/handler/domainDeployDescriptor.js";
import { normalizeSubSceneHierarchy } from "../../../../core/handler/subSceneHierarchy.js";

export { SceneExportBlockedError };

/**
 * @param {"incremental"|"fullReplace"} context
 */
export function buildCaptureOptionsForContext(host, context = "incremental") {
  const basePayload = host.getSysConfig()?.jsonData || {};
  if (context === "fullReplace") {
    return { merge: false, basePayload };
  }
  return { merge: true, basePayload };
}

export function normalizeCodeEditorJsonTextToNestedForPersistence(host, rawText) {
  const raw = String(rawText || "").trim();
  if (!raw) {
    return raw;
  }
  try {
    const parsed = resolveScenePayloadForLoad(parseSceneJsonString(raw));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return raw;
    }
    const sceneDocId = typeof parsed.threeJsonId === "string" ? parsed.threeJsonId.trim() : "";
    const subSceneList = Array.isArray(parsed.subSceneList) ? parsed.subSceneList : [];
    const { payload: normalized } = normalizeSubSceneHierarchy(parsed, {
      policy: host.getEditorSettings()?.sceneJson?.subSceneNormalizePolicy ?? "warn",
      sceneDocId,
      subSceneList
    });
    const indent = host.getEditorSettings()?.io?.exportJsonIndent ?? 2;
    return JSON.stringify(normalized, null, indent);
  } catch (error) {
    console.warn("[scene-editor] normalizeCodeEditorJsonTextToNestedForPersistence:", error);
    return raw;
  }
}

export async function captureCurrentSessionJsonText(host, captureOptions = {}) {
  if (host.getCodeEditor?.()?.isCodeEditMode?.()) {
    const raw = host.getCodeEditor()?.getActiveCodeJsonText?.() ?? "";
    return normalizeCodeEditorJsonTextToNestedForPersistence(host, raw);
  }
  await host.ensureCanvasSyncedBeforeExport?.();
  const scene = host.getScene();
  if (!scene?.isScene) {
    return "";
  }
  const indent = host.getEditorSettings()?.io?.exportJsonIndent ?? 2;
  const payload = sceneToStandardJsonSimple(scene, {
    ...host.buildSceneToJsonOptions?.({ format: "standard" }),
    ...captureOptions,
    format: "standard",
    assertExportable: true
  });
  return JSON.stringify(payload, null, indent);
}

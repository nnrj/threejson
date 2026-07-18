import { t } from "../../shared/i18n/index.js";
import {
  acceptForKind,
  parseUploadedModelFile,
  parseUploadedSceneJsonFile,
  parseUploadedTjzFile
} from "../../shared/js/sceneFileUpload.js";
import { enqueueThreeBoxSceneLoad } from "./threeBoxSceneLoadQueue.js";

export { acceptForKind };

/** Re-localizes a shared-parser error by its `.code` (see sceneFileUpload.js) rather than the
 * plain hardcoded message the shared module throws — keeps ThreeBox's existing i18n behavior
 * (threebox.upload.*) unchanged after the parsing logic moved to shared/js/. */
function localizeJsonParseError(error) {
  if (error?.code === "JSON_PARSE_FAILED") {
    return new Error(
      t("threebox.upload.jsonParseFailed", "JSON 解析失败：{error}", {
        error: error.cause?.message || error.cause || error.message
      })
    );
  }
  if (error?.code === "NOT_LOADABLE_SCENE") {
    return new Error(
      t("threebox.upload.notLoadableScene", "不是有效的 ThreeJSON 场景（缺少 worldInfo 或 objectList）。")
    );
  }
  return error;
}

async function processJsonFile(file) {
  try {
    return await parseUploadedSceneJsonFile(file);
  } catch (error) {
    throw localizeJsonParseError(error);
  }
}

/** Wraps the shared .tjz parser in ThreeBox's scene-load busy tracker (threebox:scene-load-busy —
 * used by background work like template-thumbnail generation to wait for a quiet moment). */
async function processTjzFile(file) {
  return enqueueThreeBoxSceneLoad(() => parseUploadedTjzFile(file));
}

/** Wraps the shared model parser in the same busy tracker as processTjzFile. */
async function processModelFile(file) {
  return enqueueThreeBoxSceneLoad(() => parseUploadedModelFile(file));
}

/**
 * Routes an uploaded file by the composer's chosen attach-kind. `json`/`tjz`/`model` are
 * auto-loadable (return a parsed `sceneJson`); `image`/`other` are cache-only (no `sceneJson`).
 * @param {File} file
 * @param {"json"|"tjz"|"image"|"model"|"other"} kind
 * @returns {Promise<{ kind: string, name: string, sceneJson: object|null, file: File }>}
 */
export async function processUploadedFile(file, kind) {
  if (kind === "json") {
    return { kind, name: file.name, sceneJson: await processJsonFile(file), file };
  }
  if (kind === "tjz") {
    return { kind, name: file.name, sceneJson: await processTjzFile(file), file };
  }
  if (kind === "model") {
    return { kind, name: file.name, sceneJson: await processModelFile(file), file };
  }
  return { kind, name: file.name, sceneJson: null, file };
}

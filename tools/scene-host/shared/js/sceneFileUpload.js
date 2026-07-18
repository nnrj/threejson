/**
 * Shared parsers for uploaded scene-reference files (.json/.threejson, .tjz, and 3rd-party
 * models), extracted from ThreeBox's threeBoxUploadHandler.js — the parsing itself was already
 * pure `threejson` package functions with no ThreeBox-specific state, just historically housed in
 * ThreeBox's app folder. threeBoxUploadHandler.js now thin-wraps this (zero behavior change);
 * Editor's AI-generate "+" menu (editorAiGeneratePanel.js) uses it directly for its
 * 上传场景JSON/上传.tjz包 attach options.
 */
import { sceneHostAssetUrl } from "./sceneHostPaths.js";

const ACCEPT_BY_KIND = {
  json: ".json,.threejson,.tjson,application/json",
  tjz: ".tjz",
  image: "image/*",
  model: ".gltf,.glb,.obj,.fbx",
  other: "*/*"
};

export function acceptForKind(kind) {
  return ACCEPT_BY_KIND[kind] || "*/*";
}

function createOffscreenCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  return canvas;
}

/** Parses an uploaded `.json`/`.threejson` file's text into a scene JSON object, validating it's
 * actually a loadable scene payload (not just arbitrary JSON) before treating it as one. Thrown
 * errors carry a `.code` (JSON_PARSE_FAILED / NOT_LOADABLE_SCENE) so callers can re-localize the
 * message (see threeBoxUploadHandler.js) instead of string-matching. */
export async function parseUploadedSceneJsonFile(file) {
  const { isLoadableScenePayload } = await import("threejson");
  const text = await file.text();
  let sceneJson;
  try {
    sceneJson = JSON.parse(text);
  } catch (error) {
    const err = new Error(`JSON 解析失败：${error?.message || error}`);
    err.code = "JSON_PARSE_FAILED";
    err.cause = error;
    throw err;
  }
  if (!isLoadableScenePayload(sceneJson)) {
    const err = new Error("不是有效的 ThreeJSON 场景（缺少 worldInfo 或 objectList）。");
    err.code = "NOT_LOADABLE_SCENE";
    throw err;
  }
  return sceneJson;
}

/** Unpacks a `.tjz` archive via a throwaway offscreen runtime, then re-exports it back to a
 * standard scene JSON object — reused purely for its archive-unpack + JSON-export side effect. */
export async function parseUploadedTjzFile(file) {
  const { createJsonSceneFromArchive, sceneToStandardJsonSimple } = await import("threejson");
  const runtime = await createJsonSceneFromArchive(file, {
    canvas: createOffscreenCanvas(),
    assetsBase: sceneHostAssetUrl("assets/")
  });
  try {
    return sceneToStandardJsonSimple(runtime.scene, { merge: false });
  } finally {
    runtime.dispose?.();
  }
}

/** Wraps a 3rd-party model file (glTF/OBJ/FBX) as an `externalModel` object record (core's
 * `importMeshBlob`), deploys it into a throwaway offscreen runtime, then re-exports back to a
 * standard scene JSON — after this point it's indistinguishable from any other loaded scene. */
export async function parseUploadedModelFile(file) {
  const { importMeshBlob, createJsonSceneFromObjectRecord, sceneToStandardJsonSimple } = await import("threejson");
  const { record } = await importMeshBlob(file, { fileName: file.name });
  const runtime = await createJsonSceneFromObjectRecord(record, {
    canvas: createOffscreenCanvas(),
    assetsBase: sceneHostAssetUrl("assets/")
  });
  try {
    return sceneToStandardJsonSimple(runtime.scene, { merge: false });
  } finally {
    runtime.dispose?.();
  }
}

/**
 * Routes an uploaded file by kind. `json`/`tjz`/`model` are auto-loadable (return a parsed
 * `sceneJson`); `image`/`other` are cache-only (no `sceneJson`).
 * @param {File} file
 * @param {"json"|"tjz"|"image"|"model"|"other"} kind
 * @returns {Promise<{ kind: string, name: string, sceneJson: object|null, file: File }>}
 */
export async function processUploadedSceneFile(file, kind) {
  if (kind === "json") {
    return { kind, name: file.name, sceneJson: await parseUploadedSceneJsonFile(file), file };
  }
  if (kind === "tjz") {
    return { kind, name: file.name, sceneJson: await parseUploadedTjzFile(file), file };
  }
  if (kind === "model") {
    return { kind, name: file.name, sceneJson: await parseUploadedModelFile(file), file };
  }
  return { kind, name: file.name, sceneJson: null, file };
}

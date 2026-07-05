import { hasExplicitCameraConfig } from "../../../../core/util/sceneRuntimeDefaults.js";
import { resolveEditorCanvasBindSceneEvents } from "../../shared/js/resolveEditorEventBinding.js";

export function scenePayloadHasExplicitLights(payload) {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const sc = payload.sceneConfig || {};
  const wi = payload.worldInfo || {};
  const lights = sc.lights ?? wi.lights;
  if (Array.isArray(lights)) {
    return lights.length > 0;
  }
  if (lights && typeof lights === "object") {
    return Object.keys(lights).length > 0;
  }
  return false;
}

export function scenePayloadNeedsFillCamera(payload) {
  if (!payload) {
    return true;
  }
  return !hasExplicitCameraConfig(payload.sceneConfig || {}, payload.worldInfo || {});
}

function triStateToFillFlag(mode, promptValue, needsDecision) {
  const m = mode || "auto";
  if (m === "off") {
    return false;
  }
  if (m === "auto") {
    return true;
  }
  if (!needsDecision) {
    return true;
  }
  return promptValue !== false;
}

function computeDeployAutoFitForPayload(payload, editorSettings) {
  const render = editorSettings?.render || {};
  if (render.deployAutoFitCamera === false) {
    return false;
  }
  const explicit = hasExplicitCameraConfig(payload?.sceneConfig || {}, payload?.worldInfo || {});
  if (explicit && render.deployAutoFitOverrideExplicitCamera !== true) {
    return false;
  }
  return true;
}

export function resolveEditorRuntimeFlagsSync(editorSettings, context, payload, objectPick = null) {
  const render = editorSettings?.render || {};
  const isFull = context === "fullScene";
  const lightsMode = isFull
    ? render.fullSceneFillLightsMode || "auto"
    : render.objectRecordFillLightsMode || "prompt";
  const cameraMode = isFull
    ? render.fullSceneFillCameraMode || "auto"
    : render.objectRecordFillCameraMode || "auto";
  const needsLights = !scenePayloadHasExplicitLights(payload);
  const needsCamera = scenePayloadNeedsFillCamera(payload);

  let lightsPrompt = true;
  let cameraPrompt = true;
  if (objectPick) {
    if (objectPick.fillLights != null) {
      lightsPrompt = objectPick.fillLights !== false;
    }
    if (objectPick.fillCamera != null) {
      cameraPrompt = objectPick.fillCamera !== false;
    }
  }

  const autoFillLights = triStateToFillFlag(lightsMode, lightsPrompt, isFull ? needsLights : true);
  const autoFillCamera = triStateToFillFlag(
    cameraMode,
    cameraPrompt,
    isFull ? needsCamera : scenePayloadNeedsFillCamera(payload)
  );
  const autoFitCamera = isFull ? computeDeployAutoFitForPayload(payload, editorSettings) : false;

  const flags = {};
  if (autoFillLights === false) {
    flags.autoFillLights = false;
  } else if (autoFillLights === true) {
    flags.autoFillLights = true;
  }
  if (autoFillCamera) {
    flags.autoFillCamera = true;
  } else {
    flags.autoFillCamera = false;
  }
  if (autoFitCamera) {
    flags.autoFitCamera = true;
    flags.autoFitCameraMode = "positionAndTarget";
  }
  flags.bindSceneEvents = resolveEditorCanvasBindSceneEvents(editorSettings, payload);
  return flags;
}

export async function resolveEditorRuntimeFlags(editorSettings, context, payload, objectPick, ui) {
  const render = editorSettings?.render || {};
  const isFull = context === "fullScene";
  if (!isFull) {
    return resolveEditorRuntimeFlagsSync(editorSettings, context, payload, objectPick);
  }
  const lightsMode = render.fullSceneFillLightsMode || "auto";
  const cameraMode = render.fullSceneFillCameraMode || "auto";
  const needsLights = !scenePayloadHasExplicitLights(payload);
  const needsCamera = scenePayloadNeedsFillCamera(payload);
  const wantLightsPrompt = lightsMode === "prompt" && needsLights;
  const wantCameraPrompt = cameraMode === "prompt" && needsCamera;
  if (!wantLightsPrompt && !wantCameraPrompt) {
    return resolveEditorRuntimeFlagsSync(editorSettings, context, payload, objectPick);
  }
  const prompt = await ui.openFullSceneLoadPrompt({ needsLights: wantLightsPrompt, needsCamera: wantCameraPrompt });
  if (!prompt) {
    return null;
  }
  return resolveEditorRuntimeFlagsSync(editorSettings, context, payload, {
    fillLights: wantLightsPrompt ? prompt.fillLights : undefined,
    fillCamera: wantCameraPrompt ? prompt.fillCamera : undefined
  });
}

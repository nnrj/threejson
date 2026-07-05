import { hasValue, isCanonicalScenePayload, resolveRenderLoopFpsPolicy, valueOr } from "threejson";
import { mergeSceneHelpersFromSysConfig } from "./mergeSceneHelpers.js";

/** Mirrors scene-editor.html buildEditorRuntimeConfig */
export function buildEditorRuntimeConfig(sysConfig, editorSettings, baseSceneConfig = {}) {
  const existing = baseSceneConfig && typeof baseSceneConfig === "object" ? baseSceneConfig : {};
  const cameraConfig = existing.camera && typeof existing.camera === "object" ? existing.camera : {};
  const rendererConfig = existing.renderer && typeof existing.renderer === "object" ? existing.renderer : {};
  const controlsConfig = existing.controls && typeof existing.controls === "object" ? existing.controls : {};
  const renderLoopConfig = existing.renderLoop && typeof existing.renderLoop === "object" ? existing.renderLoop : {};
  const sceneHints = existing.scene && typeof existing.scene === "object" ? existing.scene : {};
  const cameraBlock = {
    fov: valueOr(cameraConfig.fov, 50),
    near: valueOr(cameraConfig.near, 0.15),
    far: valueOr(cameraConfig.far, 3500)
  };
  if (cameraConfig.position) {
    cameraBlock.position = cameraConfig.position;
  }

  return {
    ...existing,
    canvasWidth: valueOr(existing.canvasWidth, sysConfig.canvasWidth),
    canvasHeight: valueOr(existing.canvasHeight, sysConfig.canvasHeight),
    scene: { ...sceneHints },
    camera: cameraBlock,
    renderer: {
      antialias: valueOr(rendererConfig.antialias, sysConfig.antialias),
      ratioRate: valueOr(rendererConfig.ratioRate, sysConfig.ratioRate),
      precision: valueOr(rendererConfig.precision, "highp"),
      preserveDrawingBuffer: valueOr(rendererConfig.preserveDrawingBuffer, true),
      stencil: valueOr(rendererConfig.stencil, true),
      alpha: valueOr(rendererConfig.alpha, true),
      shadowMapEnabled: valueOr(rendererConfig.shadowMapEnabled, true),
      clearAlpha: valueOr(rendererConfig.clearAlpha, 0.1)
    },
    controls: {
      listenToKeyEvents: valueOr(controlsConfig.listenToKeyEvents, true),
      enableDamping: valueOr(controlsConfig.enableDamping, true),
      dampingFactor: valueOr(controlsConfig.dampingFactor, 0.35),
      enableZoom: valueOr(controlsConfig.enableZoom, true),
      autoRotate: valueOr(controlsConfig.autoRotate, sysConfig.sceneAutoRotate),
      minDistance: valueOr(controlsConfig.minDistance, 5),
      maxDistance: valueOr(controlsConfig.maxDistance, 2600),
      maxPolarAngle: valueOr(controlsConfig.maxPolarAngle, Math.PI / 1.9),
      enablePan: valueOr(controlsConfig.enablePan, true),
      target: controlsConfig.target
    },
    renderLoop: (() => {
      const fpsPolicy = resolveRenderLoopFpsPolicy(renderLoopConfig, {
        fps: sysConfig.fps,
        lowFps: sysConfig.lowFps,
        overrideSceneRenderLoop: editorSettings?.render?.overrideSceneRenderLoop === true
      });
      const loop = {
        autoResize: valueOr(renderLoopConfig.autoResize, sysConfig.autoResize),
        firstAutoResize: valueOr(renderLoopConfig.firstAutoResize, sysConfig.firstAutoResize),
        fps: fpsPolicy.fps,
        lowFps: fpsPolicy.lowFps
      };
      const renderMode = valueOr(renderLoopConfig.renderMode, sysConfig.renderMode);
      if (hasValue(renderMode)) {
        loop.renderMode = renderMode;
      }
      return loop;
    })(),
    ...(function () {
      const mergedHelpers = mergeSceneHelpersFromSysConfig(existing.helpers, sysConfig);
      return mergedHelpers ? { helpers: mergedHelpers } : {};
    })()
  };
}

export function buildEditorScenePayload(sysConfig, editorSettings) {
  const payload = JSON.parse(JSON.stringify(sysConfig.jsonData || {}));
  if (isCanonicalScenePayload(payload)) {
    return payload;
  }
  payload.sceneConfig = buildEditorRuntimeConfig(sysConfig, editorSettings, payload.sceneConfig);
  return payload;
}

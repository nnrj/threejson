import {
  hasValue,
  isCanonicalScenePayload,
  resolveRenderLoopFpsPolicy,
  valueOr
} from "threejson/runtime-config";
import { mergeSceneHelpersFromSysConfig } from "./mergeSceneHelpers.js";

/** Shared scene-host runtime config builder used by editor/player adapters. */
export function buildSceneHostRuntimeConfig(sysConfig, hostSettings, baseSceneConfig = {}) {
  const existing = baseSceneConfig && typeof baseSceneConfig === "object" ? baseSceneConfig : {};
  const cameraConfig = existing.camera && typeof existing.camera === "object" ? existing.camera : {};
  const rendererConfig = existing.renderer && typeof existing.renderer === "object" ? existing.renderer : {};
  const controlsConfig = existing.controls && typeof existing.controls === "object" ? existing.controls : {};
  const renderLoopConfig = existing.renderLoop && typeof existing.renderLoop === "object" ? existing.renderLoop : {};
  const sceneHints = existing.scene && typeof existing.scene === "object" ? existing.scene : {};
  const cameraBlock = {
    ...cameraConfig,
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
      ...rendererConfig,
      antialias: valueOr(rendererConfig.antialias, sysConfig.antialias),
      ratioRate: valueOr(rendererConfig.ratioRate, sysConfig.ratioRate),
      precision: valueOr(rendererConfig.precision, "highp"),
      preserveDrawingBuffer: valueOr(rendererConfig.preserveDrawingBuffer, true),
      stencil: valueOr(rendererConfig.stencil, true),
      alpha: valueOr(rendererConfig.alpha, true),
      shadowMapEnabled: valueOr(rendererConfig.shadowMapEnabled, true),
      clearAlpha: valueOr(rendererConfig.clearAlpha, 0.1)
    },
    controls: (() => {
      const typeRaw = controlsConfig.type || "";
      if (String(typeRaw).toLowerCase() === "firstperson") {
        return {
          ...controlsConfig,
          type: "firstPerson",
          moveSpeed: valueOr(controlsConfig.moveSpeed, 5),
          eyeHeight: valueOr(controlsConfig.eyeHeight, 1.6),
          lookSensitivity: valueOr(controlsConfig.lookSensitivity, 0.001),
          pointerLock: controlsConfig.pointerLock !== false,
          floorSnap: controlsConfig.floorSnap !== false
        };
      }
      return {
        ...controlsConfig,
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
      };
    })(),
    renderLoop: (() => {
      const fpsPolicy = resolveRenderLoopFpsPolicy(renderLoopConfig, {
        fps: sysConfig.fps,
        lowFps: sysConfig.lowFps,
        overrideSceneRenderLoop: hostSettings?.render?.overrideSceneRenderLoop === true
      });
      const loop = {
        ...renderLoopConfig,
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

export function buildSceneHostScenePayload(sysConfig, hostSettings) {
  const payload = JSON.parse(JSON.stringify(sysConfig.jsonData || {}));
  if (isCanonicalScenePayload(payload)) {
    return payload;
  }
  payload.sceneConfig = buildSceneHostRuntimeConfig(sysConfig, hostSettings, payload.sceneConfig);
  return payload;
}

import { JSON_ORIGIN_CONFIG } from "./sceneJsonOrigin.js";

/**
 * Extract sceneConfig (camera, controls, lights) from runtime scene / target.
 */

function safeNum(value, fallback) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

/**
 * @param {object|null|undefined} target
 * @param {import("three").Scene|null|undefined} scene
 * @returns {object|null}
 */
export function extractCameraConfigFromRuntime(target, scene) {
  const runtimeCamera = target?.camera?.isCamera ? target.camera : null;
  const fallbackCamera = scene?.isScene === true && typeof scene.getObjectByProperty === "function"
    ? scene.getObjectByProperty("isCamera", true)
    : null;
  const camera = runtimeCamera || fallbackCamera;
  if (!camera) {
    return null;
  }
  return {
    fov: safeNum(camera.fov, 60),
    near: safeNum(camera.near, 0.1),
    far: safeNum(camera.far, 2500),
    position: {
      x: safeNum(camera.position?.x, 0),
      y: safeNum(camera.position?.y, 0),
      z: safeNum(camera.position?.z, 5)
    }
  };
}

/**
 * @param {object|null|undefined} target
 * @returns {object|null}
 */
export function extractControlsConfigFromRuntime(target) {
  const controls = target?.controls;
  if (!controls || typeof controls !== "object") {
    return null;
  }
  const targetVec = controls.target && typeof controls.target === "object"
    ? {
      x: safeNum(controls.target.x, 0),
      y: safeNum(controls.target.y, 0),
      z: safeNum(controls.target.z, 0)
    }
    : { x: 0, y: 0, z: 0 };
  return {
    target: targetVec
  };
}

function classifyLightType(light) {
  if (!light || !light.isLight) {
    return "";
  }
  if (light.isAmbientLight) {
    return "ambient";
  }
  if (light.isDirectionalLight) {
    return "directional";
  }
  if (light.isPointLight) {
    return "point";
  }
  if (light.isSpotLight) {
    return "spot";
  }
  return "";
}

/**
 * @param {import("three").Scene|null|undefined} scene
 * @returns {object[]}
 */
export function extractLightsConfigFromScene(scene) {
  if (!scene?.traverse) {
    return [];
  }
  const out = [];
  scene.traverse((obj) => {
    const type = classifyLightType(obj);
    if (!type) {
      return;
    }
    const entry = {
      type,
      color: `#${obj.color?.getHexString?.() || "ffffff"}`,
      intensity: safeNum(obj.intensity, 1),
      position: {
        x: safeNum(obj.position?.x, 0),
        y: safeNum(obj.position?.y, 0),
        z: safeNum(obj.position?.z, 0)
      }
    };
    if (type === "point" || type === "spot") {
      entry.distance = safeNum(obj.distance, 0);
      entry.decay = safeNum(obj.decay, 2);
    }
    if (type === "spot") {
      entry.angle = safeNum(obj.angle, Math.PI / 3);
      entry.penumbra = safeNum(obj.penumbra, 0);
      if (obj.target?.position) {
        entry.target = {
          x: safeNum(obj.target.position.x, 0),
          y: safeNum(obj.target.position.y, 0),
          z: safeNum(obj.target.position.z, 0)
        };
      }
    }
    out.push(entry);
  });
  return out;
}

/**
 * @param {object} payload
 * @param {object|null|undefined} target
 * @param {import("three").Scene|null|undefined} scene
 */
export function applyRuntimeSceneConfigToPayload(payload, target, scene) {
  const cameraConfig = extractCameraConfigFromRuntime(target, scene);
  const controlsConfig = extractControlsConfigFromRuntime(target);
  const lightsConfig = extractLightsConfigFromScene(scene);
  payload.sceneConfig = payload.sceneConfig && typeof payload.sceneConfig === "object"
    ? payload.sceneConfig
    : {};
  if (cameraConfig) {
    payload.sceneConfig.camera = {
      ...cameraConfig,
      jsonOrigin: JSON_ORIGIN_CONFIG
    };
  }
  if (controlsConfig) {
    payload.sceneConfig.controls = {
      ...controlsConfig,
      jsonOrigin: JSON_ORIGIN_CONFIG
    };
  }
  if (lightsConfig.length > 0) {
    payload.sceneConfig.lights = lightsConfig.map((entry) => ({
      ...entry,
      jsonOrigin: JSON_ORIGIN_CONFIG
    }));
  }
}

/**
 * @param {object} payload
 */
export function stripRuntimeSceneConfigFromPayload(payload) {
  if (!payload?.sceneConfig || typeof payload.sceneConfig !== "object") {
    return;
  }
  delete payload.sceneConfig.scene;
  delete payload.sceneConfig.camera;
  delete payload.sceneConfig.renderer;
  delete payload.sceneConfig.controls;
  delete payload.sceneConfig.lights;
  delete payload.sceneConfig.renderLoop;
}

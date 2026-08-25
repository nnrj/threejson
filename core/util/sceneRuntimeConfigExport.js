import { JSON_ORIGIN_CONFIG } from "./sceneJsonOrigin.js";
import { Vector3 } from "three";

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
    ...(controls.threeJsonControlsConfig && typeof controls.threeJsonControlsConfig === "object"
      ? controls.threeJsonControlsConfig
      : {}),
    type: controls.threeJsonControlsKind || controls.threeJsonControlsConfig?.type || "orbit",
    target: targetVec
  };
}

/** Preserve constructor-only renderer choices as well as live mutable values. */
export function extractRendererConfigFromRuntime(target) {
  const renderer = target?.renderer;
  if (!renderer || typeof renderer !== "object") return null;
  const saved = renderer.userData?.threeJsonRendererConfig;
  const result = saved && typeof saved === "object" ? { ...saved } : {};
  result.backend = renderer.__threeJsonBackend || result.backend || "webgl";
  if (Number.isInteger(renderer.toneMapping)) result.toneMapping = renderer.toneMapping;
  if (Number.isFinite(renderer.toneMappingExposure)) result.toneMappingExposure = renderer.toneMappingExposure;
  if (renderer.outputColorSpace != null) result.outputColorSpace = renderer.outputColorSpace;
  if (renderer.shadowMap) {
    result.shadowMap = {
      ...(result.shadowMap && typeof result.shadowMap === "object" ? result.shadowMap : {}),
      enabled: Boolean(renderer.shadowMap.enabled),
      type: renderer.shadowMap.type
    };
  }
  return result;
}

function classifyLightType(light) {
  if (!light || !light.isLight) {
    return "";
  }
  if (light.isAmbientLight) {
    return "ambient";
  }
  if (light.isHemisphereLight) {
    return "hemisphere";
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
  if (light.isRectAreaLight) {
    return "rectarea";
  }
  return "";
}

/**
 * Runtime-only host helpers must never become authored sceneConfig.lights during a scene
 * snapshot. Checking every ancestor is intentional because a host may mark a container while
 * the actual light nodes are its children.
 *
 * @param {import("three").Object3D|null|undefined} object
 * @returns {boolean}
 */
function isRuntimeOnlyLight(object) {
  let current = object;
  while (current) {
    if (
      current.userData?.__threeJsonRuntimeOnly === true
      || current.userData?.__threeJsonExportExcluded === true
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
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
    if (isRuntimeOnlyLight(obj)) {
      return;
    }
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
    if (type === "hemisphere") {
      entry.skyColor = `#${obj.color?.getHexString?.() || "ffffff"}`;
      entry.groundColor = `#${obj.groundColor?.getHexString?.() || "444444"}`;
    }
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
    if (type === "rectarea") {
      entry.width = safeNum(obj.width, 10);
      entry.height = safeNum(obj.height, 10);
      const direction = new Vector3(0, 0, -1);
      obj.getWorldDirection?.(direction);
      entry.target = {
        x: safeNum(obj.position?.x, 0) + safeNum(direction.x, 0),
        y: safeNum(obj.position?.y, 0) + safeNum(direction.y, 0),
        z: safeNum(obj.position?.z, 0) + safeNum(direction.z, -1)
      };
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
  const rendererConfig = extractRendererConfigFromRuntime(target);
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
  } else if (Array.isArray(payload.sceneConfig.lights)) {
    // Preserve an explicit empty list from basePayload. It is an author decision to keep the
    // scene unlit; deleting it would make the next load inject default lights and change meaning.
    payload.sceneConfig.lights = [];
  } else {
    delete payload.sceneConfig.lights;
  }
  if (rendererConfig) {
    payload.sceneConfig.renderer = {
      ...rendererConfig,
      jsonOrigin: JSON_ORIGIN_CONFIG
    };
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

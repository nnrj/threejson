import * as THREE from "three";

const rectAreaLightSupportInitializers = new Map();

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function vector3(value, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: finiteOr(value?.x, fallback.x),
    y: finiteOr(value?.y, fallback.y),
    z: finiteOr(value?.z, fallback.z)
  };
}

export function normalizeLightType(value) {
  const type = String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (type === "ambientlight") return "ambient";
  if (type === "hemispherelight") return "hemisphere";
  if (type === "directionallight") return "directional";
  if (type === "pointlight") return "point";
  if (type === "spotlight") return "spot";
  if (type === "rectarea" || type === "rectarealight") return "rectarea";
  return type;
}

export function containsRectAreaLightDescriptor(lights) {
  return Array.isArray(lights) && lights.some((descriptor) => normalizeLightType(descriptor?.type) === "rectarea");
}

/** Optional renderer entries register their own LTC initializer without making core import them. */
export function registerRectAreaLightSupportInitializer(rendererBackend, initializer) {
  const backend = String(rendererBackend || "").trim().toLowerCase();
  if (!backend || typeof initializer !== "function") {
    throw new TypeError("rendererBackend and initializer are required");
  }
  rectAreaLightSupportInitializers.set(backend, initializer);
}

/** Load the renderer-specific LTC tables only when a RectAreaLight is requested. */
export async function ensureRectAreaLightSupport(lights, rendererBackend = "webgl") {
  if (!containsRectAreaLightDescriptor(lights)) return false;
  const backend = String(rendererBackend || "webgl").trim().toLowerCase();
  if (backend === "webgl") {
    const module = await import("./light/rectAreaLightWebgl.js");
    module.ensureRectAreaLightWebglInitialized();
    return true;
  }
  const initializer = rectAreaLightSupportInitializers.get(backend);
  if (!initializer) {
    throw Object.assign(new Error(`RectAreaLight support is not registered for renderer backend: ${backend}`), {
      code: "E_RECT_AREA_LIGHT_BACKEND_UNAVAILABLE",
      rendererBackend: backend
    });
  }
  await initializer();
  return true;
}

/**
 * Create a light and any attachment nodes required by Three.js (currently SpotLight targets).
 * Intensity may be supplied by a compatibility adapter without mutating the descriptor.
 */
export function createLightBundleFromDescriptor(descriptor = {}, options = {}) {
  const type = normalizeLightType(descriptor.type);
  const color = descriptor.color ?? "#ffffff";
  const intensity = finiteOr(options.intensity ?? descriptor.intensity, 1);
  let light = null;

  if (type === "ambient") {
    light = new THREE.AmbientLight(color, intensity);
  } else if (type === "hemisphere") {
    light = new THREE.HemisphereLight(
      descriptor.skyColor ?? color,
      descriptor.groundColor ?? "#444444",
      intensity
    );
  } else if (type === "directional") {
    light = new THREE.DirectionalLight(color, intensity);
  } else if (type === "point") {
    light = new THREE.PointLight(
      color,
      intensity,
      finiteOr(descriptor.distance, 0),
      finiteOr(descriptor.decay, 2)
    );
  } else if (type === "spot") {
    light = new THREE.SpotLight(
      color,
      intensity,
      finiteOr(descriptor.distance, 0),
      finiteOr(descriptor.angle, Math.PI / 3),
      finiteOr(descriptor.penumbra, 0),
      finiteOr(descriptor.decay, 2)
    );
  } else if (type === "rectarea") {
    light = new THREE.RectAreaLight(
      color,
      intensity,
      finiteOr(descriptor.width, 10),
      finiteOr(descriptor.height, 10)
    );
  }

  if (!light) {
    const error = new Error(`ThreeJSON light type is not available: ${type || "(empty)"}`);
    error.code = "E_LIGHT_TYPE_UNAVAILABLE";
    error.lightType = type;
    throw error;
  }

  if (type !== "ambient" && type !== "hemisphere") {
    const position = vector3(descriptor.position, { x: 0, y: 1, z: 0 });
    light.position.set(position.x, position.y, position.z);
  }

  const attachments = [];
  if ((type === "spot" || type === "directional") && descriptor.target && typeof descriptor.target === "object") {
    const target = new THREE.Object3D();
    const targetPosition = vector3(descriptor.target);
    target.position.set(targetPosition.x, targetPosition.y, targetPosition.z);
    light.target = target;
    attachments.push(target);
  } else if (type === "rectarea" && descriptor.target && typeof descriptor.target === "object") {
    const targetPosition = vector3(descriptor.target);
    light.lookAt(targetPosition.x, targetPosition.y, targetPosition.z);
  }

  return { light, attachments, type };
}

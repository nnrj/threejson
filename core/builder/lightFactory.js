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

  if (descriptor.position || (type !== "ambient" && type !== "hemisphere")) {
    const position = vector3(descriptor.position, { x: 0, y: 1, z: 0 });
    light.position.set(position.x, position.y, position.z);
  }

  light.name = String(descriptor.name || "");
  light.visible = descriptor.visible !== false;
  light.castShadow = descriptor.castShadow === true;
  if (Number.isInteger(descriptor.layers)) light.layers.mask = descriptor.layers;
  if (Array.isArray(descriptor.quaternion) && descriptor.quaternion.length === 4) light.quaternion.fromArray(descriptor.quaternion).normalize();
  if (light.shadow && descriptor.shadow) {
    const shadow = descriptor.shadow;
    for (const key of ["bias", "normalBias", "radius", "blurSamples"]) if (Number.isFinite(shadow[key])) light.shadow[key] = shadow[key];
    if (shadow.mapSize) light.shadow.mapSize.set(finiteOr(shadow.mapSize.width ?? shadow.mapSize.x, 512), finiteOr(shadow.mapSize.height ?? shadow.mapSize.y, 512));
    for (const key of ["near", "far", "left", "right", "top", "bottom", "fov", "zoom"]) if (key in light.shadow.camera && Number.isFinite(shadow.camera?.[key])) light.shadow.camera[key] = shadow.camera[key];
    light.shadow.camera.updateProjectionMatrix();
  }
  light.userData.objJson = { ...JSON.parse(JSON.stringify(descriptor)), objType: "light" };
  const attachments = [];
  if ((type === "spot" || type === "directional") && descriptor.target && typeof descriptor.target === "object") {
    const target = new THREE.Object3D();
    const targetPosition = vector3(descriptor.target);
    target.position.set(targetPosition.x, targetPosition.y, targetPosition.z);
    light.target = target;
    attachments.push(target);
  } else if (type === "rectarea" && !descriptor.quaternion && descriptor.target && typeof descriptor.target === "object") {
    const targetPosition = vector3(descriptor.target);
    light.lookAt(targetPosition.x, targetPosition.y, targetPosition.z);
  }

  return { light, attachments, type };
}

/** Resolve light relationships after authored parents/targets have been deployed. */
export function bindLightRelationships(scene) {
  if (!scene?.traverse) return;
  const objects = new Map();
  const lights = [];
  scene.traverse((object) => {
    const id = object.userData?.objJson?.threeJsonId || object.userData?.threeJsonId;
    if (id) objects.set(id, object);
    if (object.isLight && object.userData?.objJson) lights.push(object);
  });
  for (const light of lights) {
    const descriptor = light.userData.objJson;
    if (descriptor.parentThreeJsonId) {
      const parent = objects.get(descriptor.parentThreeJsonId);
      if (!parent) throw Object.assign(new Error(`Light parent not found: ${descriptor.parentThreeJsonId}`), { code: "E_LIGHT_PARENT_NOT_FOUND" });
      for (let ancestor = parent; ancestor; ancestor = ancestor.parent) if (ancestor === light) throw new Error("Light parent cycle.");
      if (light.parent !== parent) parent.add(light);
    }
    if (descriptor.targetThreeJsonId) {
      const target = objects.get(descriptor.targetThreeJsonId);
      if (!target) throw Object.assign(new Error(`Light target not found: ${descriptor.targetThreeJsonId}`), { code: "E_LIGHT_TARGET_NOT_FOUND" });
      const oldTarget = light.target;
      light.target = target;
      if (oldTarget?.parent === scene && !oldTarget.userData?.objJson) scene.remove(oldTarget);
    }
  }
  scene.updateMatrixWorld(true);
}

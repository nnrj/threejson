import * as THREE from "three";

const TONE_MAPPING = Object.freeze({
  none: THREE.NoToneMapping,
  linear: THREE.LinearToneMapping,
  reinhard: THREE.ReinhardToneMapping,
  cineon: THREE.CineonToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  acesfilmic: THREE.ACESFilmicToneMapping,
  "aces-filmic": THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping
});

const OUTPUT_COLOR_SPACE = Object.freeze({
  srgb: THREE.SRGBColorSpace,
  linear: THREE.LinearSRGBColorSpace,
  "srgb-linear": THREE.LinearSRGBColorSpace,
  none: THREE.NoColorSpace,
  "": THREE.NoColorSpace
});

const SHADOW_MAP_TYPE = Object.freeze({
  basic: THREE.BasicShadowMap,
  pcf: THREE.PCFShadowMap,
  pcfsoft: THREE.PCFSoftShadowMap,
  "pcf-soft": THREE.PCFSoftShadowMap,
  vsm: THREE.VSMShadowMap
});

function normalizeKey(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : value;
}

function resolveEnum(value, table, fallback) {
  if (Number.isInteger(value)) {
    return value;
  }
  const key = normalizeKey(value);
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : fallback;
}

export function resolveRendererToneMapping(value, fallback = THREE.NoToneMapping) {
  return resolveEnum(value, TONE_MAPPING, fallback);
}

export function resolveRendererOutputColorSpace(value, fallback = THREE.SRGBColorSpace) {
  return resolveEnum(value, OUTPUT_COLOR_SPACE, fallback);
}

export function resolveRendererShadowMapType(value, fallback = THREE.PCFShadowMap) {
  return resolveEnum(value, SHADOW_MAP_TYPE, fallback);
}

/**
 * Convert the declarative renderer block to WebGLRenderer constructor options.
 * Undefined values are omitted so Three.js keeps its own defaults.
 */
export function buildWebGLRendererConstructorOptions(canvas, descriptor = {}) {
  const result = {
    canvas,
    antialias: descriptor.antialias !== false
  };
  const optionNames = [
    "alpha",
    "depth",
    "stencil",
    "premultipliedAlpha",
    "preserveDrawingBuffer",
    "failIfMajorPerformanceCaveat",
    "powerPreference",
    "precision",
    "logarithmicDepthBuffer",
    "reversedDepthBuffer"
  ];
  for (const name of optionNames) {
    if (descriptor[name] !== undefined) {
      result[name] = descriptor[name];
    }
  }
  return result;
}

/** Apply post-construction renderer properties shared by runtime factories. */
export function applyRendererDescriptor(renderer, descriptor = {}) {
  if (!renderer) {
    return renderer;
  }
  renderer.userData = renderer.userData && typeof renderer.userData === "object" ? renderer.userData : {};
  renderer.userData.threeJsonRendererConfig = { ...descriptor };
  renderer.outputColorSpace = resolveRendererOutputColorSpace(
    descriptor.outputColorSpace,
    THREE.SRGBColorSpace
  );
  renderer.toneMapping = resolveRendererToneMapping(
    descriptor.toneMapping,
    THREE.NoToneMapping
  );
  const exposure = descriptor.toneMappingExposure ?? descriptor.exposure;
  if (Number.isFinite(Number(exposure))) {
    renderer.toneMappingExposure = Number(exposure);
  }

  const shadowDescriptor = descriptor.shadowMap && typeof descriptor.shadowMap === "object"
    ? descriptor.shadowMap
    : {};
  const shadowEnabled = shadowDescriptor.enabled ?? descriptor.shadowMapEnabled;
  if (shadowEnabled !== undefined && renderer.shadowMap) {
    renderer.shadowMap.enabled = Boolean(shadowEnabled);
  }
  const shadowType = shadowDescriptor.type ?? descriptor.shadowMapType;
  if (shadowType !== undefined && renderer.shadowMap) {
    renderer.shadowMap.type = resolveRendererShadowMapType(shadowType, renderer.shadowMap.type);
  }

  for (const name of ["autoClear", "autoClearColor", "autoClearDepth", "autoClearStencil", "sortObjects", "localClippingEnabled"]) {
    if (descriptor[name] !== undefined && name in renderer) {
      renderer[name] = Boolean(descriptor[name]);
    }
  }
  return renderer;
}

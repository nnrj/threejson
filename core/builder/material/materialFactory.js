import * as THREE from "three";

const factories = new Map();

const TYPE_ALIASES = Object.freeze({
  dynamicbox: "standard",
  meshbasicmaterial: "basic",
  meshlambertmaterial: "lambert",
  meshphongmaterial: "phong",
  meshstandardmaterial: "standard",
  meshphysicalmaterial: "physical",
  meshtoonmaterial: "toon",
  meshmatcapmaterial: "matcap",
  meshnormalmaterial: "normal"
});

const COMMON_BOOLEAN_FIELDS = [
  "transparent", "depthTest", "depthWrite", "colorWrite", "visible", "vertexColors",
  "flatShading", "wireframe", "fog", "toneMapped", "dithering", "premultipliedAlpha",
  "polygonOffset"
];
const COMMON_NUMBER_FIELDS = [
  "opacity", "alphaTest", "polygonOffsetFactor", "polygonOffsetUnits"
];
const COMMON_TEXTURE_FIELDS = [
  "map", "alphaMap", "aoMap", "lightMap", "emissiveMap", "bumpMap", "normalMap",
  "displacementMap", "envMap"
];

const RUNTIME_BOOLEAN_FIELDS = Object.freeze([
  ...COMMON_BOOLEAN_FIELDS
]);
const RUNTIME_NUMBER_FIELDS = Object.freeze([
  ...COMMON_NUMBER_FIELDS,
  "aoMapIntensity", "lightMapIntensity", "emissiveIntensity", "bumpScale",
  "displacementScale", "displacementBias", "envMapIntensity", "metalness",
  "roughness", "shininess", "anisotropy", "anisotropyRotation",
  "attenuationDistance", "clearcoat", "clearcoatRoughness", "dispersion",
  "ior", "iridescence", "iridescenceIOR", "reflectivity", "sheen",
  "sheenRoughness", "specularIntensity", "thickness", "transmission"
]);
const RUNTIME_COLOR_FIELDS = Object.freeze([
  "color", "emissive", "specular", "attenuationColor", "sheenColor", "specularColor"
]);
const RUNTIME_VECTOR2_FIELDS = Object.freeze(["normalScale", "clearcoatNormalScale"]);

function hasOwn(source, key) {
  return Boolean(source) && Object.prototype.hasOwnProperty.call(source, key);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function textureOrNull(value) {
  return value?.isTexture === true ? value : null;
}

function normalizeSide(value) {
  if (typeof value === "number") return value;
  const key = String(value || "").trim().toLowerCase();
  if (key === "double" || key === "doubleside") return THREE.DoubleSide;
  if (key === "back" || key === "backside") return THREE.BackSide;
  if (key === "front" || key === "frontside") return THREE.FrontSide;
  return undefined;
}

function normalizeBlending(value) {
  if (typeof value === "number") return value;
  const key = String(value || "").trim().toLowerCase();
  const values = {
    none: THREE.NoBlending,
    normal: THREE.NormalBlending,
    additive: THREE.AdditiveBlending,
    subtractive: THREE.SubtractiveBlending,
    multiply: THREE.MultiplyBlending,
    custom: THREE.CustomBlending
  };
  return values[key];
}

function colorValue(value) {
  if (value?.isColor) return value;
  if (typeof value === "number" || (typeof value === "string" && value.trim())) return value;
  return undefined;
}

function vector2Value(value) {
  if (value?.isVector2) return value;
  if (Array.isArray(value) && value.length >= 2) return new THREE.Vector2(Number(value[0]) || 0, Number(value[1]) || 0);
  if (value && typeof value === "object") return new THREE.Vector2(Number(value.x) || 0, Number(value.y) || 0);
  return undefined;
}

function copyDefined(target, source, booleanFields, numberFields) {
  for (const field of booleanFields) {
    if (hasOwn(source, field)) target[field] = Boolean(source[field]);
  }
  for (const field of numberFields) {
    const value = finiteNumber(source?.[field]);
    if (value !== undefined) target[field] = value;
  }
}

function buildCommonParams(descriptor = {}, options = {}) {
  const params = {};
  const color = colorValue(descriptor.color ?? options.defaultColor);
  if (color !== undefined) params.color = color;
  copyDefined(params, descriptor, COMMON_BOOLEAN_FIELDS, COMMON_NUMBER_FIELDS);
  if (!hasOwn(params, "visible") && hasOwn(options, "visible")) params.visible = Boolean(options.visible);
  if (typeof descriptor.name === "string") params.name = descriptor.name;
  const side = normalizeSide(descriptor.side);
  if (side !== undefined) params.side = side;
  const blending = normalizeBlending(descriptor.blending);
  if (blending !== undefined) params.blending = blending;
  for (const field of COMMON_TEXTURE_FIELDS) {
    const texture = textureOrNull(descriptor[field]);
    if (texture) params[field] = texture;
  }
  const normalScale = vector2Value(descriptor.normalScale);
  if (normalScale) params.normalScale = normalScale;
  for (const field of ["emissive", "specular"]) {
    const value = colorValue(descriptor[field]);
    if (value !== undefined) params[field] = value;
  }
  copyDefined(params, descriptor, [], [
    "aoMapIntensity", "lightMapIntensity", "emissiveIntensity", "bumpScale",
    "displacementScale", "displacementBias", "envMapRotation"
  ]);
  return params;
}

function buildStandardParams(descriptor, options) {
  const params = buildCommonParams(descriptor, options);
  copyDefined(params, descriptor, [], ["metalness", "roughness", "envMapIntensity"]);
  for (const field of ["roughnessMap", "metalnessMap"]) {
    const texture = textureOrNull(descriptor[field]);
    if (texture) params[field] = texture;
  }
  return params;
}

function buildPhysicalParams(descriptor, options) {
  const params = buildStandardParams(descriptor, options);
  copyDefined(params, descriptor, [], [
    "anisotropy", "anisotropyRotation", "attenuationDistance", "clearcoat",
    "clearcoatRoughness", "dispersion", "ior", "iridescence", "iridescenceIOR",
    "reflectivity", "sheen", "sheenRoughness", "specularIntensity", "thickness",
    "transmission"
  ]);
  for (const field of ["attenuationColor", "sheenColor", "specularColor"]) {
    const value = colorValue(descriptor[field]);
    if (value !== undefined) params[field] = value;
  }
  if (Array.isArray(descriptor.iridescenceThicknessRange) && descriptor.iridescenceThicknessRange.length >= 2) {
    params.iridescenceThicknessRange = [
      finiteNumber(descriptor.iridescenceThicknessRange[0]) ?? 100,
      finiteNumber(descriptor.iridescenceThicknessRange[1]) ?? 400
    ];
  }
  const clearcoatNormalScale = vector2Value(descriptor.clearcoatNormalScale);
  if (clearcoatNormalScale) params.clearcoatNormalScale = clearcoatNormalScale;
  for (const field of [
    "anisotropyMap", "clearcoatMap", "clearcoatNormalMap", "clearcoatRoughnessMap",
    "iridescenceMap", "iridescenceThicknessMap", "sheenColorMap", "sheenRoughnessMap",
    "specularColorMap", "specularIntensityMap", "thicknessMap", "transmissionMap"
  ]) {
    const texture = textureOrNull(descriptor[field]);
    if (texture) params[field] = texture;
  }
  return params;
}

export function normalizeMaterialType(type) {
  const key = typeof type === "string" ? type.trim().toLowerCase() : "";
  return TYPE_ALIASES[key] || key;
}

export function inferMaterialType(descriptor = {}, fallback = "phong") {
  const explicit = normalizeMaterialType(descriptor.type);
  if (explicit) return explicit;
  const physicalFields = [
    "clearcoat", "transmission", "ior", "thickness", "sheen", "iridescence",
    "dispersion", "anisotropy", "attenuationDistance"
  ];
  if (physicalFields.some((field) => hasOwn(descriptor, field))) return "physical";
  const standardFields = [
    "metalness", "roughness", "normalMap", "roughnessMap", "metalnessMap", "aoMap",
    "emissiveMap", "bumpMap", "displacementMap"
  ];
  if (standardFields.some((field) => hasOwn(descriptor, field))) return "standard";
  return normalizeMaterialType(fallback) || "phong";
}

export function registerMaterialFactory(type, factory) {
  const id = normalizeMaterialType(type);
  if (!id || typeof factory !== "function") {
    throw new Error("[materialFactory] type and factory are required");
  }
  factories.set(id, factory);
}

export function unregisterMaterialFactory(type) {
  return factories.delete(normalizeMaterialType(type));
}

export function getMaterialFactory(type) {
  return factories.get(normalizeMaterialType(type)) || null;
}

export function createMaterialFromDescriptor(descriptor = {}, options = {}) {
  const source = descriptor && typeof descriptor === "object" ? descriptor : {};
  const type = inferMaterialType(source, options.fallbackType || "phong");
  const factory = getMaterialFactory(type);
  if (!factory) {
    const error = new Error(`ThreeJSON material type is not registered: ${type}`);
    error.code = "E_MATERIAL_TYPE_UNAVAILABLE";
    error.materialType = type;
    throw error;
  }
  const material = factory(source, options);
  if (!material?.isMaterial) {
    throw new Error(`[materialFactory] ${type} factory returned no THREE.Material`);
  }
  material.userData = { ...(material.userData || {}), threeJsonMaterialType: type };
  return material;
}

/**
 * Apply non-resource material fields to an existing Three.js material. This is
 * deliberately shared by the command/runtime mutation path and the material
 * factory so PhysicalMaterial fields do not silently disappear after creation.
 * Changing `type` still requires object redeployment.
 *
 * @param {import("three").Material} material
 * @param {object} descriptor
 * @returns {import("three").Material}
 */
export function applyMaterialDescriptorProperties(material, descriptor = {}) {
  if (!material?.isMaterial || !descriptor || typeof descriptor !== "object") return material;
  for (const field of RUNTIME_BOOLEAN_FIELDS) {
    if (hasOwn(descriptor, field) && field in material) material[field] = Boolean(descriptor[field]);
  }
  for (const field of RUNTIME_NUMBER_FIELDS) {
    const value = finiteNumber(descriptor[field]);
    if (value !== undefined && field in material) material[field] = value;
  }
  for (const field of RUNTIME_COLOR_FIELDS) {
    if (hasOwn(descriptor, field) && material[field]?.set) {
      const value = colorValue(descriptor[field]);
      if (value !== undefined) material[field].set(value);
    }
  }
  for (const field of RUNTIME_VECTOR2_FIELDS) {
    if (!hasOwn(descriptor, field) || !material[field]?.copy) continue;
    const value = vector2Value(descriptor[field]);
    if (value) material[field].copy(value);
  }
  if (
    hasOwn(descriptor, "iridescenceThicknessRange")
    && Array.isArray(descriptor.iridescenceThicknessRange)
    && descriptor.iridescenceThicknessRange.length >= 2
    && "iridescenceThicknessRange" in material
  ) {
    material.iridescenceThicknessRange = [
      finiteNumber(descriptor.iridescenceThicknessRange[0]) ?? 100,
      finiteNumber(descriptor.iridescenceThicknessRange[1]) ?? 400
    ];
  }
  if (hasOwn(descriptor, "side") && "side" in material) {
    const side = normalizeSide(descriptor.side);
    if (side !== undefined) material.side = side;
  }
  if (hasOwn(descriptor, "blending") && "blending" in material) {
    const blending = normalizeBlending(descriptor.blending);
    if (blending !== undefined) material.blending = blending;
  }
  material.needsUpdate = true;
  return material;
}

function registerClassicMaterialFactories() {
  registerMaterialFactory("basic", (descriptor, options) => new THREE.MeshBasicMaterial(buildCommonParams(descriptor, options)));
  registerMaterialFactory("lambert", (descriptor, options) => new THREE.MeshLambertMaterial(buildCommonParams(descriptor, options)));
  registerMaterialFactory("phong", (descriptor, options) => {
    const params = buildCommonParams(descriptor, options);
    copyDefined(params, descriptor, [], ["shininess"]);
    return new THREE.MeshPhongMaterial(params);
  });
  registerMaterialFactory("standard", (descriptor, options) => new THREE.MeshStandardMaterial(buildStandardParams(descriptor, options)));
  registerMaterialFactory("physical", (descriptor, options) => new THREE.MeshPhysicalMaterial(buildPhysicalParams(descriptor, options)));
  registerMaterialFactory("toon", (descriptor, options) => {
    const params = buildCommonParams(descriptor, options);
    const gradientMap = textureOrNull(descriptor.gradientMap);
    if (gradientMap) params.gradientMap = gradientMap;
    return new THREE.MeshToonMaterial(params);
  });
  registerMaterialFactory("matcap", (descriptor, options) => {
    const params = buildCommonParams(descriptor, options);
    const matcap = textureOrNull(descriptor.matcap);
    if (matcap) params.matcap = matcap;
    return new THREE.MeshMatcapMaterial(params);
  });
  registerMaterialFactory("normal", (descriptor, options) => {
    const params = buildCommonParams({ ...descriptor, color: undefined }, options);
    delete params.color;
    return new THREE.MeshNormalMaterial(params);
  });
}

registerClassicMaterialFactories();

export function _resetMaterialFactoriesForTests() {
  factories.clear();
  registerClassicMaterialFactories();
}

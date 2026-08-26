import * as WEBGPU from "three/webgpu";
import * as TSL from "three/tsl";
import { compileTslGraph } from "./tslGraph.js";

const presets = new Map();
const preparedCodeFactories = new Map();
const MATERIAL_TEXTURE_FIELDS = [
  "map", "alphaMap", "aoMap", "lightMap", "emissiveMap", "bumpMap", "normalMap",
  "displacementMap", "envMap", "roughnessMap", "metalnessMap", "specularMap",
  "gradientMap", "matcap", "anisotropyMap",
  "clearcoatMap", "clearcoatNormalMap", "clearcoatRoughnessMap", "iridescenceMap",
  "iridescenceThicknessMap", "sheenColorMap", "sheenRoughnessMap", "specularColorMap",
  "specularIntensityMap", "thicknessMap", "transmissionMap"
];

export function registerTslPreset(id, factory) {
  const key = String(id || "").trim();
  if (!key || typeof factory !== "function") throw new Error("[tslPreset] id and factory are required");
  presets.set(key, factory);
}
export function getTslPreset(id) { return presets.get(String(id || "").trim()) ?? null; }
export function registerPreparedTslCode(sourceKey, factory) { preparedCodeFactories.set(sourceKey, factory); }
export function unregisterPreparedTslCode(sourceKey) { return preparedCodeFactories.delete(sourceKey); }

function baseMaterial(type) {
  const key = String(type || "standard").toLowerCase();
  if (key === "basic") return new WEBGPU.MeshBasicNodeMaterial();
  if (key === "lambert") return new WEBGPU.MeshLambertNodeMaterial();
  if (key === "physical") return new WEBGPU.MeshPhysicalNodeMaterial();
  if (key === "phong") return new WEBGPU.MeshPhongNodeMaterial();
  if (key === "toon") return new WEBGPU.MeshToonNodeMaterial();
  if (key === "matcap") return new WEBGPU.MeshMatcapNodeMaterial();
  if (key === "normal") return new WEBGPU.MeshNormalNodeMaterial();
  return new WEBGPU.MeshStandardNodeMaterial();
}

function inheritOriginalMaterial(material, original, mode) {
  if (!original?.isMaterial || mode === false || mode === "none") return;
  for (const field of MATERIAL_TEXTURE_FIELDS) {
    if (field in material && original[field]?.isTexture === true) material[field] = original[field];
  }
  if (mode === "textures") return;
  for (const field of [
    "roughness", "metalness", "opacity", "clearcoat", "clearcoatRoughness",
    "transmission", "ior", "thickness", "attenuationDistance", "sheen",
    "sheenRoughness", "iridescence", "iridescenceIOR", "anisotropy",
    "anisotropyRotation", "dispersion", "reflectivity", "specularIntensity",
    "emissiveIntensity", "aoMapIntensity", "lightMapIntensity", "bumpScale",
    "displacementScale", "displacementBias", "envMapIntensity", "alphaTest"
  ]) {
    if (field in material && Number.isFinite(Number(original[field]))) material[field] = Number(original[field]);
  }
  for (const field of [
    "transparent", "depthTest", "depthWrite", "colorWrite", "visible", "vertexColors",
    "flatShading", "wireframe", "fog", "toneMapped", "dithering", "premultipliedAlpha"
  ]) {
    if (field in material && original[field] !== undefined) material[field] = Boolean(original[field]);
  }
  for (const field of ["color", "emissive", "attenuationColor", "sheenColor", "specularColor"]) {
    if (material[field]?.copy && original[field]?.isColor) material[field].copy(original[field]);
  }
  for (const field of ["normalScale", "clearcoatNormalScale"]) {
    if (material[field]?.copy && original[field]?.isVector2) material[field].copy(original[field]);
  }
  if ("side" in material && Number.isInteger(original.side)) material.side = original.side;
  if ("blending" in material && Number.isInteger(original.blending)) material.blending = original.blending;
}

function applyClassicFields(material, descriptor) {
  for (const field of [
    "roughness", "metalness", "opacity", "clearcoat", "clearcoatRoughness",
    "transmission", "ior", "thickness", "attenuationDistance", "sheen",
    "sheenRoughness", "iridescence", "iridescenceIOR", "anisotropy",
    "anisotropyRotation", "dispersion", "reflectivity", "specularIntensity"
  ]) {
    if (Number.isFinite(Number(descriptor[field])) && field in material) material[field] = Number(descriptor[field]);
  }
  for (const field of ["color", "attenuationColor", "sheenColor", "specularColor"]) {
    if (descriptor[field] !== undefined && material[field]?.set) material[field].set(descriptor[field]);
  }
  if (Array.isArray(descriptor.iridescenceThicknessRange) && descriptor.iridescenceThicknessRange.length >= 2 && "iridescenceThicknessRange" in material) {
    material.iridescenceThicknessRange = descriptor.iridescenceThicknessRange.slice(0, 2).map(Number);
  }
  if (descriptor.clearcoatNormalScale && material.clearcoatNormalScale?.set) {
    const value = descriptor.clearcoatNormalScale;
    material.clearcoatNormalScale.set(Number(value.x ?? value[0]) || 0, Number(value.y ?? value[1]) || 0);
  }
  for (const field of MATERIAL_TEXTURE_FIELDS) {
    if (descriptor[field]?.isTexture === true && field in material) material[field] = descriptor[field];
  }
  if (descriptor.transparent !== undefined) material.transparent = Boolean(descriptor.transparent);
  for (const field of [
    "depthTest", "depthWrite", "colorWrite", "visible", "vertexColors", "flatShading",
    "wireframe", "fog", "toneMapped", "dithering", "premultipliedAlpha"
  ]) {
    if (descriptor[field] !== undefined && field in material) material[field] = Boolean(descriptor[field]);
  }
  if (typeof descriptor.name === "string") material.name = descriptor.name;
  if (Number.isFinite(Number(descriptor.alphaTest))) material.alphaTest = Number(descriptor.alphaTest);
  const side = String(descriptor.side || "").trim().toLowerCase();
  if (side === "double" || side === "doubleside") material.side = WEBGPU.DoubleSide;
  else if (side === "back" || side === "backside") material.side = WEBGPU.BackSide;
  else if (side === "front" || side === "frontside") material.side = WEBGPU.FrontSide;
  else if (Number.isInteger(descriptor.side)) material.side = descriptor.side;
}

function applyOutputs(material, outputs) {
  const aliases = {
    color: "colorNode", baseColor: "colorNode", opacity: "opacityNode", emissive: "emissiveNode",
    roughness: "roughnessNode", metalness: "metalnessNode", normal: "normalNode", position: "positionNode",
    output: "outputNode", depth: "depthNode", shadow: "shadowNode", lights: "lightsNode",
    environment: "envNode", ambientOcclusion: "aoNode", backdrop: "backdropNode",
    backdropAlpha: "backdropAlphaNode", alphaTest: "alphaTestNode"
  };
  for (const [name, node] of Object.entries(outputs || {})) {
    const property = aliases[name] || (name.endsWith("Node") ? name : `${name}Node`);
    if (["constructor", "prototype", "__proto__"].includes(property) || !(property in material)) {
      const error = new Error(`[tslMaterial] output "${name}" does not map to ${material.type}`);
      error.code = "E_TSL_MATERIAL_OUTPUT_UNAVAILABLE";
      error.output = name;
      error.property = property;
      throw error;
    }
    material[property] = node;
  }
}

function finiteParam(params, name, fallback) {
  const value = Number(params?.[name]);
  if (!Number.isFinite(value)) return fallback;
  return value;
}

export function createTslMaterialFromDescriptor(descriptor = {}, context = {}) {
  const tsl = descriptor.tsl && typeof descriptor.tsl === "object" ? descriptor.tsl : {};
  const kind = String(tsl.kind || "preset").trim().toLowerCase();
  let material = baseMaterial(descriptor.base);
  const inheritMode = descriptor.inheritOriginal
    ?? descriptor.inheritOriginalMaterial
    ?? context.binding?.inheritOriginal
    ?? false;
  inheritOriginalMaterial(material, context.originalMaterial, inheritMode);
  applyClassicFields(material, descriptor);
  let outputs;
  if (kind === "preset") {
    const id = tsl.preset ?? tsl.id ?? tsl.source?.id;
    const preset = getTslPreset(id);
    if (!preset) throw new Error(`[tslMaterial] unknown preset: ${String(id || "")}`);
    outputs = preset(tsl.params || {}, { ...context, descriptor, material, TSL, WEBGPU });
  } else if (kind === "graph") {
    outputs = compileTslGraph(tsl, context);
  } else if (kind === "code") {
    const sourceKey = typeof tsl.source?.url === "string" ? `url:${tsl.source.url.trim()}` : `inline:${String(tsl.source?.inline || "")}`;
    const factory = preparedCodeFactories.get(sourceKey);
    if (!factory) throw Object.assign(
      new Error("TSL code was not prepared; import threejson/tsl-code and verify the host execution policy"),
      { code: "E_TSL_CODE_NOT_PREPARED" }
    );
    const result = factory(tsl.params || {}, { ...context, descriptor, material, TSL, WEBGPU });
    if (result?.isMaterial === true) {
      material = result;
      inheritOriginalMaterial(material, context.originalMaterial, inheritMode);
      applyClassicFields(material, descriptor);
      outputs = null;
    } else if (result?.isNode === true) {
      outputs = { color: result };
    } else if (result === undefined || (result && typeof result === "object")) {
      // Returning undefined lets a code factory mutate context.material directly.
      outputs = result;
    } else {
      const error = new Error(
        "TSL code factory must return a NodeMaterial, a TSL node, an output-node map, or undefined"
      );
      error.code = "E_TSL_CODE_RESULT_INVALID";
      throw error;
    }
  } else {
    throw new Error(`[tslMaterial] unsupported kind: ${kind}`);
  }
  if (outputs) applyOutputs(material, outputs);
  material.userData = { ...(material.userData || {}), threeJsonTsl: { kind, graphVersion: tsl.graphVersion ?? tsl.source?.inline?.graphVersion } };
  material.needsUpdate = true;
  return material;
}

registerTslPreset("solid", (params) => ({ color: TSL.color(params.color || "#ffffff") }));
registerTslPreset("uv-gradient", (params) => ({
  color: TSL.mix(TSL.color(params.colorA || "#2563eb"), TSL.color(params.colorB || "#f97316"), TSL.uv().y)
}));
registerTslPreset("pulse", (params) => ({
  color: TSL.color(params.color || "#62d8ff").mul(TSL.sin(TSL.time.mul(finiteParam(params, "speed", 2))).mul(0.5).add(0.5))
}));

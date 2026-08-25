import * as WEBGPU from "three/webgpu";
import * as TSL from "three/tsl";
import { compileTslGraph } from "./tslGraph.js";

const presets = new Map();
const preparedCodeFactories = new Map();

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
  if (key === "physical") return new WEBGPU.MeshPhysicalNodeMaterial();
  if (key === "phong") return new WEBGPU.MeshPhongNodeMaterial();
  if (key === "toon") return new WEBGPU.MeshToonNodeMaterial();
  return new WEBGPU.MeshStandardNodeMaterial();
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
  if (descriptor.transparent !== undefined) material.transparent = Boolean(descriptor.transparent);
  const side = String(descriptor.side || "").trim().toLowerCase();
  if (side === "double" || side === "doubleside") material.side = WEBGPU.DoubleSide;
  else if (side === "back" || side === "backside") material.side = WEBGPU.BackSide;
  else if (side === "front" || side === "frontside") material.side = WEBGPU.FrontSide;
  else if (Number.isInteger(descriptor.side)) material.side = descriptor.side;
}

function applyOutputs(material, outputs) {
  const mapping = {
    color: "colorNode", baseColor: "colorNode", opacity: "opacityNode", emissive: "emissiveNode",
    roughness: "roughnessNode", metalness: "metalnessNode", normal: "normalNode", position: "positionNode"
  };
  for (const [name, node] of Object.entries(outputs || {})) if (mapping[name]) material[mapping[name]] = node;
}

export function createTslMaterialFromDescriptor(descriptor = {}, context = {}) {
  const tsl = descriptor.tsl && typeof descriptor.tsl === "object" ? descriptor.tsl : {};
  const kind = String(tsl.kind || "preset").trim().toLowerCase();
  const material = baseMaterial(descriptor.base);
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
    if (!factory) throw Object.assign(new Error("TSL code was not prepared and authorized by the host"), { code: "E_TSL_CODE_NOT_AUTHORIZED" });
    outputs = factory(tsl.params || {}, { ...context, descriptor, material, TSL, WEBGPU });
  } else {
    throw new Error(`[tslMaterial] unsupported kind: ${kind}`);
  }
  applyOutputs(material, outputs);
  material.userData = { ...(material.userData || {}), threeJsonTsl: { kind, graphVersion: tsl.graphVersion ?? tsl.source?.inline?.graphVersion } };
  material.needsUpdate = true;
  return material;
}

registerTslPreset("solid", (params) => ({ color: TSL.color(params.color || "#ffffff") }));
registerTslPreset("uv-gradient", (params) => ({
  color: TSL.mix(TSL.color(params.colorA || "#2563eb"), TSL.color(params.colorB || "#f97316"), TSL.uv().y)
}));
registerTslPreset("pulse", (params) => ({
  color: TSL.color(params.color || "#62d8ff").mul(TSL.sin(TSL.time.mul(Number(params.speed) || 2)).mul(0.5).add(0.5))
}));

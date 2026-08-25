import * as THREE from "three";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { FXAAShader } from "three/examples/jsm/shaders/FXAAShader.js";
import { registerPassTypeFactory } from "../../handler/postProcessPassTypeRegistry.js";
import { trackDisposableResource } from "../../handler/trackedResourceRegistry.js";
import { registerSceneCapability } from "../../capabilities/sceneCapabilityManifest.js";
import { resolveShaderPassPreset } from "./shaderPassPresetRegistry.js";

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function resolution(ctx) {
  const renderer = ctx?.renderer;
  const canvas = renderer?.domElement;
  const width = Math.max(1, finiteOr(canvas?.clientWidth || canvas?.width, 1));
  const height = Math.max(1, finiteOr(canvas?.clientHeight || canvas?.height, 1));
  const pixelRatio = Math.max(1, finiteOr(renderer?.getPixelRatio?.(), 1));
  return { width, height, pixelRatio };
}

function applyCommon(pass, record = {}) {
  if (record.enabled !== undefined) pass.enabled = Boolean(record.enabled);
  if (record.renderToScreen !== undefined) pass.renderToScreen = Boolean(record.renderToScreen);
  return trackDisposableResource(pass);
}

export function createUnrealBloomPassFromRecord(record = {}, ctx = {}) {
  const { width, height } = resolution(ctx);
  const pass = new UnrealBloomPass(
    new THREE.Vector2(width, height),
    finiteOr(record.strength, 1),
    finiteOr(record.radius, 0.4),
    finiteOr(record.threshold, 0.85)
  );
  return applyCommon(pass, record);
}

export function createFxaaPassFromRecord(record = {}, ctx = {}) {
  const { width, height, pixelRatio } = resolution(ctx);
  const pass = new ShaderPass(FXAAShader);
  const uniform = pass.material?.uniforms?.resolution || pass.uniforms?.resolution;
  pass.setSize = (nextWidth, nextHeight) => {
    const safeWidth = Math.max(1, finiteOr(nextWidth, 1));
    const safeHeight = Math.max(1, finiteOr(nextHeight, 1));
    uniform?.value?.set?.(1 / safeWidth, 1 / safeHeight);
  };
  pass.setSize(width * pixelRatio, height * pixelRatio);
  return applyCommon(pass, record);
}

export function createSmaaPassFromRecord(record = {}, ctx = {}) {
  const { width, height, pixelRatio } = resolution(ctx);
  return applyCommon(new SMAAPass(width * pixelRatio, height * pixelRatio), record);
}

function assignUniformValue(uniform, value) {
  if (!uniform) return;
  if (uniform.value?.isColor && (typeof value === "string" || typeof value === "number")) {
    uniform.value.set(value);
  } else if (uniform.value?.set && Array.isArray(value)) {
    uniform.value.set(...value);
  } else {
    uniform.value = value;
  }
}

export function createShaderPresetPassFromRecord(record = {}, ctx = {}) {
  const presetId = record.shaderPreset ?? record.preset;
  const shader = resolveShaderPassPreset(presetId, record, ctx);
  if (!shader) {
    throw new Error(`[pass:shader] unknown registered shaderPreset: ${String(presetId || "")}`);
  }
  const pass = new ShaderPass(shader, record.textureID);
  const overrides = record.uniforms && typeof record.uniforms === "object" ? record.uniforms : {};
  for (const [name, value] of Object.entries(overrides)) {
    assignUniformValue(pass.material?.uniforms?.[name] || pass.uniforms?.[name], value);
  }
  return applyCommon(pass, record);
}

let registered = false;

export function ensureWebglAdvancedPassesRegistered() {
  if (registered) return;
  registerPassTypeFactory("unrealbloom", createUnrealBloomPassFromRecord);
  registerPassTypeFactory("fxaa", createFxaaPassFromRecord);
  registerPassTypeFactory("smaa", createSmaaPassFromRecord);
  registerPassTypeFactory("shader", createShaderPresetPassFromRecord);
  registerPassTypeFactory("shaderpreset", createShaderPresetPassFromRecord);
  for (const id of ["unrealBloom", "fxaa", "smaa", "shaderPreset"]) {
    registerSceneCapability("passes", id, {
      status: "stable",
      rendererBackends: ["webgl"],
      lazy: true,
      asyncRuntime: true,
      activation: "descriptor",
      entry: "threejson/postprocessing-webgl"
    });
  }
  registered = true;
}

ensureWebglAdvancedPassesRegistered();

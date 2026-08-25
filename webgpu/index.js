import * as WEBGPU from "three/webgpu";
import { applyRendererDescriptor, buildWebGLRendererConstructorOptions } from "../core/handler/rendererConfig.js";
import { registerRendererBackend } from "../core/handler/rendererBackendRegistry.js";
import { registerMaterialFactory } from "../core/builder/material/materialFactory.js";
import { registerSceneCapability } from "../core/capabilities/sceneCapabilityManifest.js";
import { registerSceneCapabilityPreparer } from "../core/capabilities/scenePreparationRegistry.js";
import { createTslMaterialFromDescriptor, registerTslPreset, getTslPreset } from "./tslMaterial.js";
import { compileTslGraph, prepareTslGraphsForPayload, TslGraphError } from "./tslGraph.js";
import { WebgpuRenderPipelineAdapter } from "./webgpuPostProcessing.js";
import { registerWebgpuParticleBackend, deployParticleWebgpuEmitter, buildWebgpuParticleInitialArrays } from "./particleWebgpuCompute.js";
import { registerRectAreaLightSupportInitializer } from "../core/builder/lightFactory.js";
import { ensureRectAreaLightWebgpuInitialized } from "./rectAreaLightWebgpu.js";

export const THREEJSON_WEBGPU_SUPPORTED_REVISION = "184";

function assertRevision() {
  if (String(WEBGPU.REVISION) !== THREEJSON_WEBGPU_SUPPORTED_REVISION) {
    const error = new Error(`ThreeJSON WebGPU preview supports Three.js r${THREEJSON_WEBGPU_SUPPORTED_REVISION}; active revision is r${WEBGPU.REVISION}`);
    error.code = "E_WEBGPU_THREE_REVISION_UNSUPPORTED"; throw error;
  }
}

async function createWebgpuRenderer({ canvas, descriptor, width, height, scene, camera }) {
  assertRevision();
  const options = buildWebGLRendererConstructorOptions(canvas, descriptor);
  delete options.logarithmicDepthBuffer;
  const renderer = new WEBGPU.WebGPURenderer({ ...options, forceWebGL: descriptor.forceWebGL === true });
  renderer.__threeJsonBackend = "webgpu";
  applyRendererDescriptor(renderer, descriptor);
  renderer.setPixelRatio((typeof window !== "undefined" ? window.devicePixelRatio : 1) * Number(descriptor.ratioRate || 1));
  renderer.setSize(width, height, false);
  await renderer.init();
  return { renderer, composer: new WebgpuRenderPipelineAdapter(renderer, scene, camera) };
}

let registered = false;
export function registerThreeJsonWebgpuPreview() {
  if (registered) return;
  registerRendererBackend("webgpu", {
    async: true,
    revision: THREEJSON_WEBGPU_SUPPORTED_REVISION,
    matchesRenderer: (renderer) => renderer?.isWebGPURenderer === true,
    ownsPostProcessing: true,
    resolveFallback: ({ policy }) => policy === "fallback-webgl" ? "webgl" : null,
    createRenderer: createWebgpuRenderer
  });
  registerMaterialFactory("tsl", createTslMaterialFromDescriptor);
  registerSceneCapability("rendererBackends", "webgpu", { status: "preview", async: true, entry: "threejson/webgpu", revision: THREEJSON_WEBGPU_SUPPORTED_REVISION });
  registerSceneCapability("materials", "tsl", { status: "preview", rendererBackends: ["webgpu"], modes: ["preset","graph","code"] });
  registerSceneCapability("passes", "render", { status: "preview", rendererBackends: ["webgl","webgpu"] });
  registerSceneCapability("passes", "output", { status: "preview", rendererBackends: ["webgl","webgpu"] });
  registerSceneCapability("passes", "bloom", { status: "preview", rendererBackends: ["webgpu"] });
  registerSceneCapability("objects", "pass", { status: "stable", rendererBackends: ["webgl", "webgpu"] });
  registerSceneCapabilityPreparer("webgpu-tsl-graphs", prepareTslGraphsForPayload);
  registerRectAreaLightSupportInitializer("webgpu", ensureRectAreaLightWebgpuInitialized);
  registerWebgpuParticleBackend();
  registerSceneCapability("particleBackends", "webgpu-compute", { status: "preview", rendererBackends: ["webgpu"], entry: "threejson/webgpu" });
  registerSceneCapability("objects", "particleEmitter", { status: "stable", rendererBackends: ["webgl", "webgpu"] });
  registered = true;
}

registerThreeJsonWebgpuPreview();

export { createTslMaterialFromDescriptor, registerTslPreset, getTslPreset, compileTslGraph, prepareTslGraphsForPayload, TslGraphError, WebgpuRenderPipelineAdapter, deployParticleWebgpuEmitter, buildWebgpuParticleInitialArrays };

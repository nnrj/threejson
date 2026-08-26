import * as WEBGPU from "three/webgpu";
import { applyRendererDescriptor, buildWebGLRendererConstructorOptions } from "../core/handler/rendererConfig.js";
import { registerRendererBackend } from "../core/handler/rendererBackendRegistry.js";
import { registerMaterialFactory } from "../core/builder/material/materialFactory.js";
import { registerSceneCapability } from "../core/capabilities/sceneCapabilityManifest.js";
import { registerSceneCapabilityPreparer } from "../core/capabilities/scenePreparationRegistry.js";
import { createTslMaterialFromDescriptor, registerTslPreset, getTslPreset } from "./tslMaterial.js";
import {
  compileTslGraph,
  prepareTslGraphsForPayload,
  registerTslGraphNode,
  unregisterTslGraphNode,
  TslGraphError
} from "./tslGraph.js";
import { WebgpuRenderPipelineAdapter } from "./webgpuPostProcessing.js";
import { registerWebgpuParticleBackend, deployParticleWebgpuEmitter, buildWebgpuParticleInitialArrays } from "./particleWebgpuCompute.js";
import { registerRectAreaLightSupportInitializer } from "../core/builder/lightFactory.js";
import { log } from "../core/util/logger.js";
import { ensureRectAreaLightWebgpuInitialized } from "./rectAreaLightWebgpu.js";

export const THREEJSON_WEBGPU_TESTED_REVISION = "184";
// Kept as a descriptive alias for consumers that already display the tested adapter revision.
export const THREEJSON_WEBGPU_SUPPORTED_REVISION = THREEJSON_WEBGPU_TESTED_REVISION;
export const WEBGPU_REVISION_POLICIES = Object.freeze({
  BEST_EFFORT: "best-effort",
  STRICT: "strict"
});

let warnedRevisionPair = "";

/**
 * Report the adapter's tested Three.js revision without turning that test matrix into an
 * engine-wide capability ban. Hosts that need a certified combination can opt into strict.
 */
export function checkWebgpuRevisionCompatibility({
  actualRevision = WEBGPU.REVISION,
  policy = WEBGPU_REVISION_POLICIES.BEST_EFFORT
} = {}) {
  const actual = String(actualRevision ?? "unknown");
  const normalizedPolicy = String(policy || WEBGPU_REVISION_POLICIES.BEST_EFFORT).trim().toLowerCase();
  if (!Object.values(WEBGPU_REVISION_POLICIES).includes(normalizedPolicy)) {
    const error = new Error(`Unknown WebGPU revisionPolicy: ${normalizedPolicy}`);
    error.code = "E_WEBGPU_REVISION_POLICY_INVALID";
    throw error;
  }
  const tested = THREEJSON_WEBGPU_TESTED_REVISION;
  if (actual === tested) {
    return { compatible: true, testedRevision: tested, actualRevision: actual, policy: normalizedPolicy };
  }
  const message = `ThreeJSON WebGPU was tested with Three.js r${tested}; active revision is r${actual}`;
  if (normalizedPolicy === WEBGPU_REVISION_POLICIES.STRICT) {
    const error = new Error(message);
    error.code = "E_WEBGPU_THREE_REVISION_UNSUPPORTED";
    error.testedRevision = tested;
    error.actualRevision = actual;
    throw error;
  }
  const pair = `${tested}:${actual}`;
  if (warnedRevisionPair !== pair) {
    warnedRevisionPair = pair;
    log.warn(`[webgpu] ${message}; continuing in best-effort mode.`);
  }
  return { compatible: false, testedRevision: tested, actualRevision: actual, policy: normalizedPolicy };
}

async function createWebgpuRenderer({ canvas, descriptor, width, height, scene, camera }) {
  checkWebgpuRevisionCompatibility({ policy: descriptor.revisionPolicy });
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
    testedRevision: THREEJSON_WEBGPU_TESTED_REVISION,
    revisionPolicy: WEBGPU_REVISION_POLICIES.BEST_EFFORT,
    matchesRenderer: (renderer) => renderer?.isWebGPURenderer === true,
    ownsPostProcessing: true,
    resolveFallback: ({ policy }) => policy === "fallback-webgl" ? "webgl" : null,
    createRenderer: createWebgpuRenderer
  });
  registerMaterialFactory("tsl", createTslMaterialFromDescriptor);
  registerSceneCapability("rendererBackends", "webgpu", {
    status: "preview",
    async: true,
    entry: "threejson/webgpu",
    testedRevision: THREEJSON_WEBGPU_TESTED_REVISION,
    revisionPolicy: WEBGPU_REVISION_POLICIES.BEST_EFFORT
  });
  registerSceneCapability("materials", "tsl", {
    status: "preview",
    rendererBackends: ["webgpu"],
    modes: ["preset", "graph"],
    entry: "threejson/webgpu"
  });
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

export {
  createTslMaterialFromDescriptor,
  registerTslPreset,
  getTslPreset,
  compileTslGraph,
  prepareTslGraphsForPayload,
  registerTslGraphNode,
  unregisterTslGraphNode,
  TslGraphError,
  WebgpuRenderPipelineAdapter,
  deployParticleWebgpuEmitter,
  buildWebgpuParticleInitialArrays
};

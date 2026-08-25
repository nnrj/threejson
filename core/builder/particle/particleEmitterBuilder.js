import { deployParticleGpuEmitter } from "./particleGpuCompute.js";
import { deployParticleCpuEmitter } from "./particleCpuSimulation.js";
import { normalizeParticleEmitterV2 } from "./particleV2Descriptor.js";
import { tryDeployParticleSimulationBackend } from "./particleSimulationBackendRegistry.js";

function resolveSimulationMode(record = {}) {
  return normalizeParticleEmitterV2(record).simulation.backend;
}

function canUseGpuCompute(ctx = {}) {
  return ctx?.renderer?.capabilities?.isWebGL2 === true;
}

export function deployParticleEmitterCore(record, scene, ctx = {}) {
  if (!record || !scene) {
    return null;
  }
  const requested = resolveSimulationMode(record);
  const optionalResult = tryDeployParticleSimulationBackend(requested, record, scene, ctx);
  if (optionalResult !== undefined) {
    return optionalResult;
  }
  if (requested === "webgpu-compute") {
    throw Object.assign(new Error("particle simulation webgpu-compute requires threejson/webgpu"), { code: "E_PARTICLE_BACKEND_UNAVAILABLE" });
  }
  if (requested === "webgl-compute") {
    const renderer = ctx?.renderer ?? null;
    if (!canUseGpuCompute(ctx)) {
      throw Object.assign(new Error("particle simulation webgl-compute requires a WebGL2 renderer"), {
        code: "E_PARTICLE_WEBGL2_REQUIRED"
      });
    }
    const gpuPoints = deployParticleGpuEmitter(record, scene, renderer, ctx);
    if (gpuPoints) return gpuPoints;
    throw Object.assign(new Error("particle simulation webgl-compute failed to initialize"), {
      code: "E_PARTICLE_BACKEND_INIT_FAILED"
    });
  }
  if (requested === "cpu") return deployParticleCpuEmitter(record, scene, ctx);
  throw Object.assign(new Error(`particle simulation backend is not registered: ${requested}`), {
    code: "E_PARTICLE_BACKEND_UNAVAILABLE",
    backend: requested
  });
}

export function deployParticleEmitter(record, scene, ctx = {}) {
  if (!record || !scene) {
    return null;
  }
  return deployParticleEmitterCore(record, scene, ctx);
}


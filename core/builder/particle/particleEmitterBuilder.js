import { createPoints } from "../pointsBuilder.js";
import { log } from "../../util/logger.js";
import { PARTICLE_EMITTER_DEFAULT_OPACITY } from "../../theme/runtimeVisualDefaults.js";
import { deployParticleGpuEmitter } from "./particleGpuCompute.js";
import { hasPointsMotion } from "./particleComputeUtil.js";
import { tryDeployParticleEmitterByProvider } from "./particleProviderRegistry.js";

function hasFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function toVector3(value, fallback = { x: 0, y: 1, z: 0 }) {
  const src = value && typeof value === "object" ? value : {};
  return {
    x: hasFiniteNumber(src.x) ? Number(src.x) : fallback.x,
    y: hasFiniteNumber(src.y) ? Number(src.y) : fallback.y,
    z: hasFiniteNumber(src.z) ? Number(src.z) : fallback.z
  };
}

function vectorLength(v) {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function normalizeDirection(v) {
  const len = vectorLength(v);
  if (len <= 1e-6) {
    return { x: 0, y: 1, z: 0 };
  }
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function resolveSimulationMode(record = {}) {
  const raw = typeof record.simulation === "string" ? record.simulation.trim().toLowerCase() : "";
  return raw === "gpucompute" ? "gpuCompute" : "cpu";
}

function canUseGpuCompute(ctx = {}) {
  const renderer = ctx?.renderer ?? null;
  if (renderer?.capabilities?.isWebGL2) {
    return true;
  }
  if (typeof window !== "undefined" && typeof window.WebGL2RenderingContext !== "undefined") {
    return true;
  }
  return false;
}

function resolvePointsMotion(record = {}) {
  if (hasPointsMotion(record.motion)) {
    return record.motion;
  }
  return resolveEmitterMotion(record);
}

function resolveEmitterMotion(record = {}) {
  const emitter = record.emitter && typeof record.emitter === "object" ? record.emitter : {};
  const velocity = toVector3(
    emitter.velocity && typeof emitter.velocity === "object" ? emitter.velocity : record.velocity,
    { x: 0, y: 1, z: 0 }
  );
  const speedFromVelocity = vectorLength(velocity);
  const speed = hasFiniteNumber(emitter.speed)
    ? Number(emitter.speed)
    : hasFiniteNumber(record.speed)
      ? Number(record.speed)
      : speedFromVelocity > 0
        ? speedFromVelocity
        : 1.5;
  return {
    type: "drift",
    speed,
    direction: normalizeDirection(velocity),
    wrap: emitter.wrap !== false
  };
}

function buildPointsRecord(record = {}, ctx = {}, simulation = "cpu") {
  const geometry = record.geometry && typeof record.geometry === "object" ? record.geometry : {};
  const bounds = record.bounds && typeof record.bounds === "object"
    ? record.bounds
    : {
      width: geometry.width,
      height: geometry.height,
      depth: geometry.depth
    };
  const pointsRecord = {
    ...record,
    objType: "points",
    name: record.name || "particle-emitter",
    count: hasFiniteNumber(record.count) ? Number(record.count) : 1000,
    bounds,
    material: record.material && typeof record.material === "object"
      ? { ...record.material }
      : {
        color: "#ffffff",
        size: 2,
        transparent: true,
        opacity: PARTICLE_EMITTER_DEFAULT_OPACITY,
        blending: "additive",
        depthWrite: false
      },
    motion: resolvePointsMotion(record)
  };
  pointsRecord.userData = {
    ...(record.userData && typeof record.userData === "object" ? record.userData : {}),
    particleEmitter: {
      simulation,
      requestedSimulation: resolveSimulationMode(record)
    }
  };
  return pointsRecord;
}

export function deployParticleEmitterCore(record, scene, ctx = {}) {
  if (!record || !scene) {
    return null;
  }
  const requested = resolveSimulationMode(record);
  if (requested === "gpuCompute") {
    const renderer = ctx?.renderer ?? null;
    if (!canUseGpuCompute(ctx)) {
      log.warn("[particleEmitter] simulation=gpuCompute unavailable in this environment, fell back to cpu");
    } else {
      const gpuPoints = deployParticleGpuEmitter(record, scene, renderer, ctx);
      if (gpuPoints) {
        return gpuPoints;
      }
      log.warn("[particleEmitter] gpuCompute init failed, fell back to cpu");
    }
  }
  return createPoints(buildPointsRecord(record, ctx, "cpu"), scene);
}

export function deployParticleEmitter(record, scene, ctx = {}) {
  if (!record || !scene) {
    return null;
  }
  const providerResult = tryDeployParticleEmitterByProvider(record, scene, ctx);
  if (providerResult !== undefined) {
    return providerResult;
  }
  return deployParticleEmitterCore(record, scene, ctx);
}


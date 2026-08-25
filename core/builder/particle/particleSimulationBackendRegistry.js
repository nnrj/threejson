import { resolveRuntimeContext } from "../../runtime/runtimeContext.js";

const simulationBackends = new Map();

function normalizeBackend(value) {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/[_\s]/g, "-") : "";
}

/** Register an optional particle simulation backend without importing it from core. */
export function registerParticleSimulationBackend(id, deploy) {
  const key = normalizeBackend(id);
  if (!key || typeof deploy !== "function") {
    throw new TypeError("registerParticleSimulationBackend requires an id and deploy function");
  }
  simulationBackends.set(key, deploy);
}

export function unregisterParticleSimulationBackend(id) {
  return simulationBackends.delete(normalizeBackend(id));
}

export function getParticleSimulationBackend(id) {
  return simulationBackends.get(normalizeBackend(id)) ?? null;
}

export function tryDeployParticleSimulationBackend(id, record, scene, ctx = {}) {
  const deploy = getParticleSimulationBackend(id);
  return deploy ? deploy(record, scene, ctx) : undefined;
}

/**
 * Per-runtime lifecycle store for optional simulation implementations. The store
 * only knows update/dispose callbacks; WebGPU and future backends stay outside
 * the default dependency graph.
 */
export function createParticleSimulationExtensionStore() {
  const entries = new Map();

  function unregister(target) {
    const entry = entries.get(target);
    if (!entry) return;
    target?.removeEventListener?.("removed", entry.onRemoved);
    entries.delete(target);
    entry.dispose?.();
  }

  function register(target, lifecycle = {}) {
    if (!target) throw new TypeError("particle simulation lifecycle target is required");
    unregister(target);
    const entry = {
      update: typeof lifecycle.update === "function" ? lifecycle.update : null,
      dispose: typeof lifecycle.dispose === "function" ? lifecycle.dispose : null,
      onRemoved: () => unregister(target)
    };
    entries.set(target, entry);
    target.addEventListener?.("removed", entry.onRemoved);
    return () => unregister(target);
  }

  function update(deltaSeconds) {
    if (!(deltaSeconds > 0)) return;
    for (const [target, entry] of [...entries]) {
      if (!target?.parent) {
        unregister(target);
        continue;
      }
      entry.update?.(deltaSeconds);
    }
  }

  function dispose() {
    for (const target of [...entries.keys()]) unregister(target);
  }

  return { register, unregister, update, dispose };
}

function resolveStore(scope) {
  return resolveRuntimeContext(scope).particleSimulationExtension;
}

export function registerParticleSimulationLifecycle(target, lifecycle, scope) {
  return resolveStore(scope ?? target).register(target, lifecycle);
}

export function updateParticleSimulationExtensions(deltaSeconds, scope) {
  return resolveStore(scope).update(deltaSeconds);
}

export function _clearParticleSimulationBackendsForTests() {
  simulationBackends.clear();
}

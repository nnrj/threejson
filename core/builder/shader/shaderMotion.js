/**
 * ShaderMaterial per-frame update: unified time / deltaTime and preset.updateUniforms call.
 *
 * Registered targets and the shared elapsed clock live inside `createShaderMotionStore()`
 * instances, one per RuntimeContext (see core/runtime/runtimeContext.js), so each canvas's
 * render loop only advances its own shader materials. `trackShaderMaterial` auto-resolves
 * its scope from `mesh` (walks up to the attached scene); `updateShaderMotion` reads
 * `ctx.scene` (already passed by the per-canvas animation driver). Omitting either
 * preserves today's shared-global behavior.
 */

import { getShaderPreset } from "./shaderPresetRegistry.js";
import { resolveRuntimeContext } from "../../runtime/runtimeContext.js";

export function createShaderMotionStore() {
  /** @type {WeakMap<import("three").ShaderMaterial, { presetId: string, mesh: import("three").Mesh|null, elapsed: number }>} */
  const motionStateMap = new WeakMap();
  /** @type {Set<import("three").ShaderMaterial>} */
  const motionTargets = new Set();
  let globalElapsed = 0;

  function disposeShaderMotion(material) {
    if (!material) {
      return;
    }
    const state = motionStateMap.get(material);
    if (state?.presetId) {
      const preset = getShaderPreset(state.presetId);
      preset?.dispose?.(material);
    }
    motionStateMap.delete(material);
    motionTargets.delete(material);
  }

  function trackShaderMaterial(material, presetId, mesh = null) {
    if (!material || !presetId) {
      return;
    }
    motionStateMap.set(material, {
      presetId: String(presetId),
      mesh,
      elapsed: 0
    });
    motionTargets.add(material);
    if (mesh && !mesh.userData._shaderMotionRemovedBound) {
      mesh.userData._shaderMotionRemovedBound = true;
      mesh.addEventListener("removed", () => {
        disposeShaderMotion(material);
      });
    }
  }

  function updateShaderMotion(deltaSeconds, ctx = {}) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0 || motionTargets.size === 0) {
      return;
    }
    globalElapsed += deltaSeconds;
    for (const material of motionTargets) {
      if (!material) {
        disposeShaderMotion(material);
        continue;
      }
      const state = motionStateMap.get(material);
      if (!state) {
        disposeShaderMotion(material);
        continue;
      }
      state.elapsed += deltaSeconds;
      const uniforms = material.uniforms;
      if (uniforms?.time) {
        uniforms.time.value = state.elapsed;
      }
      if (uniforms?.deltaTime) {
        uniforms.deltaTime.value = deltaSeconds;
      }
      if (uniforms?.globalTime) {
        uniforms.globalTime.value = globalElapsed;
      }
      const preset = getShaderPreset(state.presetId);
      preset?.updateUniforms?.(material, {
        ...ctx,
        deltaSeconds,
        elapsed: state.elapsed,
        globalElapsed,
        mesh: state.mesh,
        presetId: state.presetId
      });
    }
  }

  function reset() {
    globalElapsed = 0;
    for (const material of motionTargets) {
      motionStateMap.delete(material);
    }
    motionTargets.clear();
  }

  return { trackShaderMaterial, disposeShaderMotion, updateShaderMotion, dispose: reset, reset };
}

function resolveStore(runtimeScope) {
  return resolveRuntimeContext(runtimeScope).shaderMotion;
}

/**
 * @param {import("three").ShaderMaterial} material
 * @param {string} presetId
 * @param {import("three").Mesh|null} [mesh]
 * @param {*} [runtimeScope]
 */
export function trackShaderMaterial(material, presetId, mesh = null, runtimeScope) {
  return resolveStore(runtimeScope ?? mesh).trackShaderMaterial(material, presetId, mesh);
}

/**
 * @param {import("three").ShaderMaterial} material
 * @param {*} [runtimeScope]
 */
export function disposeShaderMotion(material, runtimeScope) {
  return resolveStore(runtimeScope).disposeShaderMotion(material);
}

/**
 * @param {number} deltaSeconds
 * @param {object} [ctx={}]
 */
export function updateShaderMotion(deltaSeconds, ctx = {}) {
  return resolveStore(ctx?.scene ?? ctx?.runtimeScope).updateShaderMotion(deltaSeconds, ctx);
}

/** For unit tests only */
export function _resetShaderMotionForTests(runtimeScope) {
  resolveStore(runtimeScope).reset();
}

/**
 * ShaderMaterial per-frame update: unified time / deltaTime and preset.updateUniforms call.
 */

import { getShaderPreset } from "./shaderPresetRegistry.js";

/** @type {WeakMap<import("three").ShaderMaterial, { presetId: string, mesh: import("three").Mesh|null, elapsed: number }>} */
const motionStateMap = new WeakMap();

/** @type {Set<import("three").ShaderMaterial>} */
const motionTargets = new Set();

let globalElapsed = 0;

/**
 * @param {import("three").ShaderMaterial} material
 * @param {string} presetId
 * @param {import("three").Mesh|null} [mesh]
 */
export function trackShaderMaterial(material, presetId, mesh = null) {
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

/**
 * @param {import("three").ShaderMaterial} material
 */
export function disposeShaderMotion(material) {
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

/**
 * @param {number} deltaSeconds
 * @param {object} [ctx={}]
 */
export function updateShaderMotion(deltaSeconds, ctx = {}) {
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

/** For unit tests only */
export function _resetShaderMotionForTests() {
  globalElapsed = 0;
  for (const material of motionTargets) {
    motionStateMap.delete(material);
  }
  motionTargets.clear();
}

import { timelineError } from "./schema.js";
import { sampleParticleSourcePositions } from "../builder/particle/particleSourceSampler.js";
import { sampleTimelineWindow } from "./signals.js";
import { sampleCurveDescriptor } from "../builder/curve/curveFactory.js";
import * as THREE from "three";

const random = (index, seed) => { let n = Math.imul(index + 1, 374761393) ^ (seed | 0); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967295; };

// Pure, host-registered position operators. No scene string eval or GPU import.
const operators = new Map([
  ["wave", ({ x, y, z, time, params }) => [x, y + Math.sin(x*(params.frequency??1) + time*(params.speed??1))*(params.amplitude??1), z]],
  ["swirl", ({ x, y, z, time, params }) => { const angle = time*(params.speed??1) + y*(params.twist??.2), c = Math.cos(angle), s = Math.sin(angle); return [x*c-z*s, y, x*s+z*c]; }],
  ["orbit", ({ x, y, z, time, params }) => { const a = time*(params.speed??1); return [x+Math.cos(a)*(params.radius??1), y, z+Math.sin(a)*(params.radius??1)]; }],
  ["morph", ({ x, y, z, progress, index, destination }) => { const o = index*3; return [x+(destination[o]-x)*progress, y+(destination[o+1]-y)*progress, z+(destination[o+2]-z)*progress]; }],
  ["scatter", ({ x, y, z, progress, index, params }) => {
    const seed = params.seed ?? 1, distance = (params.distance ?? 5) * progress;
    return [x + (random(index * 3, seed) * 2 - 1) * distance, y + (random(index * 3 + 1, seed) * 2 - 1) * distance, z + (random(index * 3 + 2, seed) * 2 - 1) * distance];
  }],
  ["wavefront", ({ x, y, z, time, params }) => {
    const r = Math.hypot(x, z), d = r - time * (params.speed ?? 2);
    return [x, y + Math.sin(d * (params.frequency ?? 4)) * Math.exp(-d * d / (params.width ?? 2) ** 2) * (params.amplitude ?? 1), z];
  }],
  ["flow", ({ x, y, z, time, index, count, params, flow }) => {
    const phase = time * (params.speed ?? .1) + index / Math.max(1, count - 1) * (params.length ?? 1) + (params.phase ?? 0);
    const u = ((phase % 1) + 1) % 1 * (flow.length / 3 - 1), i = Math.floor(u), t = u - i, spread = params.spread ?? 0;
    return [x, y, z].map((value, axis) => flow[i * 3 + axis] * (1 - t) + flow[(i + 1) * 3 + axis] * t + value * spread);
  }]
]);
export function registerParticleMotionOperator(id, evaluate) {
  if (!id || typeof evaluate !== "function") throw new TypeError("Motion operator requires an ID and evaluate function.");
  operators.set(id, evaluate); return () => { if (operators.get(id) === evaluate) operators.delete(id); };
}
export function getParticleMotionOperators() { return [...operators.keys()]; }
/** Deterministic spatial pairing avoids random long crossing trajectories.
 * Sorting on the dominant axis is O(n log n), not quadratic nearest-neighbour.
 * It is a correspondence heuristic, not an optimal transport claim.
 */
export function matchParticlePositions(source, destination, mode = "spatial") {
  if (source.length !== destination.length) throw new RangeError("Particle targets must have equal counts.");
  if (mode === "index") return destination;
  if (mode !== "spatial") throw new TypeError(`Unknown particle matching: ${mode}`);
  const count = source.length / 3, range = [0, 1, 2].map(axis => {
    let min = Infinity, max = -Infinity;
    for (let i = axis; i < source.length; i += 3) { min = Math.min(min, source[i]); max = Math.max(max, source[i]); }
    return max - min;
  }), axis = range.indexOf(Math.max(...range));
  const order = (array) => Array.from({ length: count }, (_, i) => i).sort((a, b) => array[a * 3 + axis] - array[b * 3 + axis] || array[a * 3 + (axis + 1) % 3] - array[b * 3 + (axis + 1) % 3] || a - b);
  const from = order(source), to = order(destination), result = new Float32Array(destination.length);
  for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) result[from[i] * 3 + k] = destination[to[i] * 3 + k];
  return result;
}
export async function prepareParticleEffects(runtime, effects = [], options = {}) {
  const bindings = [], sources = new Map();
  for (const effect of effects) {
    options.signal?.throwIfAborted();
    if (effect.enabled === false) continue;
    let object;
    runtime.scene.traverse((candidate) => { if ((candidate.userData?.threeJsonId || candidate.userData?.objJson?.threeJsonId) === effect.target) object = candidate; });
    const attr = object?.geometry?.getAttribute("particlePosition") || object?.geometry?.getAttribute("position");
    if (!attr || object.material?.uniforms?.texturePosition) throw timelineError("PARTICLE_EFFECT_TARGET_UNAVAILABLE", `Motion effect requires a CPU position attribute: ${effect.target}`);
    if (!sources.has(attr)) sources.set(attr, attr.array.slice());
    const operator = operators.get(effect.operator);
    if (!operator) throw timelineError("PARTICLE_EFFECT_OPERATOR_MISSING", `Unknown motion operator: ${effect.operator}`);
    let destination;
    if (effect.operator === "morph") {
      if (!effect.params?.source) throw timelineError("PARTICLE_EFFECT_SOURCE_MISSING", "Morph needs params.source, using the normal Particle V2 source descriptor.");
      const source = effect.params.source;
      if (["textmask", "imagemask"].includes(String(source.type).toLowerCase())) (await import("../builder/particle/particlesRaster.js")).ensureParticlesRasterRegistered();
      destination = await sampleParticleSourcePositions(source, attr.count, { seed: effect.params.seed ?? 1, resolveMesh: (id) => { let result; runtime.scene.traverse((node) => { if (node.userData?.objJson?.threeJsonId === id) result = node; }); return result; } });
      destination = matchParticlePositions(attr.array, destination, effect.params.matching ?? "spatial");
    }
    const scatter = effect.operator === "scatter" ? Float32Array.from({ length: attr.count * 3 }, (_, i) => random(i, effect.params?.seed ?? 1) * 2 - 1) : undefined;
    let flow;
    if (effect.operator === "flow") {
      const samples = effect.params?.samples ?? 257;
      if (!Number.isSafeInteger(samples) || samples < 2 || !effect.params?.path) throw timelineError("PARTICLE_FLOW_PATH_INVALID", "Flow needs params.path and samples >= 2.");
      flow = sampleCurveDescriptor(effect.params.path, samples, THREE);
    }
    bindings.push({ effect, object, attr, operator, destination, scatter, flow });
  }
  const gpu = [];
  try {
    for (const object of new Set(bindings.filter(b => b.effect.backend === "webgl").map(b => b.object))) {
      const group = bindings.filter(b => b.object === object);
      if (group.some(b => b.effect.backend !== "webgl")) throw timelineError("PARTICLE_EFFECT_MIXED_BACKENDS", "Effects on one particle target must use the same backend, preserving operator order.");
      const { createWebglParticleEffects } = await import("./particleEffectsWebgl.js");
      gpu.push(createWebglParticleEffects(group, { maxTextureSize: runtime.renderer?.capabilities?.maxTextureSize }));
      group.forEach(b => { b.gpu = true; sources.delete(b.attr); });
    }
  } catch (error) { gpu.forEach(item => item.dispose()); throw error; }
  const initial = new Map([...sources].map(([attr, array]) => [attr, array.slice()]));
  const culling = new Map(bindings.map(({ object }) => [object, object.frustumCulled]));
  return {
    bindTimeline(timeline) { for (const binding of bindings) binding.effect = timeline.effects.find(item => item.id === binding.effect.id) || binding.effect; },
    dispose() { gpu.forEach(item => item.dispose()); for (const [object, value] of culling) object.frustumCulled = value; for (const [attr, array] of sources) { attr.array.set(array); attr.needsUpdate = true; } },
    reset() { for (const [attr, array] of initial) { sources.get(attr).set(array); attr.array.set(array); } },
    // Effects are post-simulation transforms. Restore simulated positions before
    // the next physics step so exported output fps cannot feed back into forces.
    restore() { for (const [attr, original] of sources) attr.array.set(original); },
    evaluateAt(time) {
    for (const [attr, original] of sources) original.set(attr.array);
    for (const binding of bindings) {
      const { effect, object, attr, operator, destination, flow } = binding;
      object.frustumCulled = false;
      if (binding.gpu) continue;
      const window = sampleTimelineWindow(effect, time);
      if (!window) { attr.needsUpdate = true; continue; }
      const elapsed = window.time, progress = effect.duration === undefined ? Math.min(1, elapsed) : window.progress;
      for (let index = 0; index < attr.count; index++) {
        const o = index*3;
        const stagger = Math.max(0, Math.min(.999999, effect.stagger ?? 0)), p = Math.max(0, Math.min(1, (progress - stagger * index / Math.max(1, attr.count - 1)) / (1 - stagger)));
        const result = operator({ x: attr.array[o], y: attr.array[o+1], z: attr.array[o+2], index, count: attr.count, time: elapsed, progress: effect.easing === "smoothstep" ? p*p*(3-2*p) : p, params: effect.params || {}, destination, flow });
        if (!Array.isArray(result) || result.length !== 3 || !result.every(Number.isFinite)) throw timelineError("PARTICLE_EFFECT_INVALID_RESULT", `Motion operator ${effect.operator} returned an invalid position.`);
        attr.setXYZ(index, ...result);
      }
      attr.needsUpdate = true; object.frustumCulled = false;
    }
    gpu.forEach(item => item.evaluateAt(time));
  } };
}

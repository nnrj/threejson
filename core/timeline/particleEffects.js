import { timelineError } from "./schema.js";
import { sampleParticleSourcePositions } from "../builder/particle/particleSourceSampler.js";

// Pure, host-registered position operators. No scene string eval or GPU import.
const operators = new Map([
  ["wave", ({ x, y, z, time, params }) => [x, y + Math.sin(x*(params.frequency??1) + time*(params.speed??1))*(params.amplitude??1), z]],
  ["swirl", ({ x, y, z, time, params }) => { const angle = time*(params.speed??1) + y*(params.twist??.2), c = Math.cos(angle), s = Math.sin(angle); return [x*c-z*s, y, x*s+z*c]; }],
  ["orbit", ({ x, y, z, time, params }) => { const a = time*(params.speed??1); return [x+Math.cos(a)*(params.radius??1), y, z+Math.sin(a)*(params.radius??1)]; }],
  ["morph", ({ x, y, z, progress, index, destination }) => { const o = index*3; return [x+(destination[o]-x)*progress, y+(destination[o+1]-y)*progress, z+(destination[o+2]-z)*progress]; }]
]);
export function registerParticleMotionOperator(id, evaluate) {
  if (!id || typeof evaluate !== "function") throw new TypeError("Motion operator requires an ID and evaluate function.");
  operators.set(id, evaluate); return () => { if (operators.get(id) === evaluate) operators.delete(id); };
}
export function getParticleMotionOperators() { return [...operators.keys()]; }
export async function prepareParticleEffects(runtime, effects = []) {
  const bindings = [], sources = new Map();
  for (const effect of effects) {
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
    }
    bindings.push({ effect, object, attr, operator, destination });
  }
  const initial = new Map([...sources].map(([attr, array]) => [attr, array.slice()]));
  return {
    reset() { for (const [attr, array] of initial) { sources.get(attr).set(array); attr.array.set(array); } },
    // Effects are post-simulation transforms. Restore simulated positions before
    // the next physics step so exported output fps cannot feed back into forces.
    restore() { for (const [attr, original] of sources) attr.array.set(original); },
    evaluateAt(time) {
    for (const [attr, original] of sources) original.set(attr.array);
    for (const { effect, object, attr, operator, destination } of bindings) {
      const elapsed = Math.max(0, time-(effect.start||0)), progress = Math.min(1, elapsed/(effect.duration||1));
      if (effect.enabled === false || time < (effect.start || 0)) { attr.needsUpdate = true; continue; }
      for (let index = 0; index < attr.count; index++) {
        const o = index*3;
        const result = operator({ x: attr.array[o], y: attr.array[o+1], z: attr.array[o+2], index, count: attr.count, time: elapsed, progress, params: effect.params || {}, destination });
        if (!Array.isArray(result) || result.length !== 3 || !result.every(Number.isFinite)) throw timelineError("PARTICLE_EFFECT_INVALID_RESULT", `Motion operator ${effect.operator} returned an invalid position.`);
        attr.setXYZ(index, ...result);
      }
      attr.needsUpdate = true; object.frustumCulled = false;
    }
  } };
}

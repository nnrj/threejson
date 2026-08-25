import * as THREE from "three";
import { loadingManager } from "../../cache/loading.js";
import { resolvePublicAssetUrl } from "../../util/assetsBase.js";
import { trackDisposableResource } from "../../handler/trackedResourceRegistry.js";
import { registerObject, getObjectByThreeJsonId } from "../../handler/objectRegistry.js";
import { setUserDataObjJson } from "../../handler/objectDescriptorAttach.js";
import { applyVisibilityFromDescriptor } from "../../util/util.js";
import { resolvePosition, resolveRotation, resolveScale } from "../../util/vectorValue.js";
import { resolveRuntimeContext } from "../../runtime/runtimeContext.js";
import { buildParticleEmitterWorldMatrix, createSeededRandom, sampleParticleSourcePositions } from "./particleSourceSampler.js";
import { assertParticleCountWithinBudget, normalizeParticleEmitterV2, sampleRange } from "./particleV2Descriptor.js";
import { normalizeParticleLifecycleFrames, sampleParticleLifecycleSegment } from "./particleLifecycle.js";

const VERTEX = /* glsl */`
attribute float particleSize;
attribute float particleOpacity;
attribute float particleRotation;
attribute float particleProgress;
varying vec3 vParticleColor;
varying float vParticleOpacity;
varying float vParticleRotation;
varying float vParticleProgress;
uniform bool sizeAttenuation;
void main(){
  vParticleColor=color;
  vParticleOpacity=particleOpacity;
  vParticleRotation=particleRotation;
  vParticleProgress=particleProgress;
  vec4 mvPosition=modelViewMatrix*vec4(position,1.0);
  gl_Position=projectionMatrix*mvPosition;
  gl_PointSize=sizeAttenuation?particleSize*(300.0/max(-mvPosition.z,1.0)):particleSize;
}`;
const FRAGMENT = /* glsl */`
uniform sampler2D spriteMap;
uniform bool useSpriteMap;
uniform vec2 atlasGrid;
uniform float atlasFrameStart;
uniform float atlasFrameEnd;
varying vec3 vParticleColor;
varying float vParticleOpacity;
varying float vParticleRotation;
varying float vParticleProgress;
void main(){
  vec2 centered=gl_PointCoord-vec2(0.5);
  float c=cos(vParticleRotation),s=sin(vParticleRotation);
  centered=mat2(c,-s,s,c)*centered;
  if(!useSpriteMap && length(centered)>0.5) discard;
  vec2 sampleUv=centered+vec2(0.5);
  float frame=floor(mix(atlasFrameStart,atlasFrameEnd,vParticleProgress)+0.5);
  vec2 cell=vec2(mod(frame,atlasGrid.x),atlasGrid.y-1.0-floor(frame/atlasGrid.x));
  sampleUv=(sampleUv+cell)/atlasGrid;
  vec4 sampleColor=useSpriteMap?texture2D(spriteMap,sampleUv):vec4(1.0);
  gl_FragColor=vec4(vParticleColor,vParticleOpacity)*sampleColor;
  if(gl_FragColor.a<=0.001) discard;
}`;

const BILLBOARD_VERTEX = /* glsl */`
attribute vec3 particlePosition;
attribute vec3 color;
attribute float particleSize;
attribute float particleOpacity;
attribute float particleRotation;
attribute float particleProgress;
varying vec2 vParticleUv;
varying vec3 vParticleColor;
varying float vParticleOpacity;
varying float vParticleProgress;
uniform bool sizeAttenuation;
void main(){
  vParticleUv=uv;
  vParticleColor=color;
  vParticleOpacity=particleOpacity;
  vParticleProgress=particleProgress;
  vec2 corner=position.xy;
  float c=cos(particleRotation),s=sin(particleRotation);
  corner=mat2(c,-s,s,c)*corner;
  vec4 mvPosition=modelViewMatrix*vec4(particlePosition,1.0);
  float scale=sizeAttenuation?particleSize:particleSize*max(-mvPosition.z,1.0)/300.0;
  mvPosition.xy+=corner*scale;
  gl_Position=projectionMatrix*mvPosition;
}`;
const BILLBOARD_FRAGMENT = /* glsl */`
uniform sampler2D spriteMap;
uniform bool useSpriteMap;
uniform vec2 atlasGrid;
uniform float atlasFrameStart;
uniform float atlasFrameEnd;
varying vec2 vParticleUv;
varying vec3 vParticleColor;
varying float vParticleOpacity;
varying float vParticleProgress;
void main(){
  vec2 centered=vParticleUv-vec2(0.5);
  if(!useSpriteMap&&length(centered)>0.5)discard;
  float frame=floor(mix(atlasFrameStart,atlasFrameEnd,vParticleProgress)+0.5);
  vec2 cell=vec2(mod(frame,atlasGrid.x),atlasGrid.y-1.0-floor(frame/atlasGrid.x));
  vec2 sampleUv=(vParticleUv+cell)/atlasGrid;
  vec4 sampleColor=useSpriteMap?texture2D(spriteMap,sampleUv):vec4(1.0);
  gl_FragColor=vec4(vParticleColor,vParticleOpacity)*sampleColor;
  if(gl_FragColor.a<=0.001)discard;
}`;

function finite(value, fallback) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function vector(value, fallback = { x: 0, y: 0, z: 0 }) {
  return { x: finite(value?.x, fallback.x), y: finite(value?.y, fallback.y), z: finite(value?.z, fallback.z) };
}
function blending(value) {
  return ({ additive: THREE.AdditiveBlending, subtractive: THREE.SubtractiveBlending, multiply: THREE.MultiplyBlending })[value]
    ?? THREE.NormalBlending;
}
function atlasInfo(descriptor) {
  const atlas = descriptor.render.sprite?.atlas ?? descriptor.particle.atlas ?? descriptor.render.atlas ?? {};
  const columns = Math.max(1, Math.floor(finite(atlas.columns, 1)));
  const rows = Math.max(1, Math.floor(finite(atlas.rows, 1)));
  return { columns, rows, start: Math.max(0, finite(atlas.startFrame ?? atlas.frame, 0)), end: Math.max(0, finite(atlas.endFrame ?? atlas.frame, 0)) };
}
function particleUniforms(descriptor) {
  const atlas = atlasInfo(descriptor);
  return {
    spriteMap: { value: null }, useSpriteMap: { value: false }, sizeAttenuation: { value: descriptor.render.sizeAttenuation },
    atlasGrid: { value: new THREE.Vector2(atlas.columns, atlas.rows) }, atlasFrameStart: { value: atlas.start }, atlasFrameEnd: { value: atlas.end }
  };
}
function applyTransform(object, record) {
  const p = resolvePosition(record.position); const r = resolveRotation(record.rotation); const s = resolveScale(record.scale);
  object.position.set(p.x, p.y, p.z); object.rotation.set(r.x, r.y, r.z); object.scale.set(s.x, s.y, s.z);
  applyVisibilityFromDescriptor(object, record);
}
function numberCurve(frames, t) { const [a, b, p] = sampleParticleLifecycleSegment(frames, t); return finite(a.value, 0) + (finite(b.value, 0) - finite(a.value, 0)) * p; }
function colorCurve(frames, t, target) { const [a, b, p] = sampleParticleLifecycleSegment(frames, t); target.set(a.value ?? "#ffffff").lerp(new THREE.Color(b.value ?? a.value ?? "#ffffff"), p); return target; }

function velocityRange(value) {
  if (value && typeof value === "object" && (value.min || value.max)) {
    return { min: vector(value.min), max: vector(value.max, vector(value.min)) };
  }
  const exact = vector(value);
  return { min: exact, max: exact };
}
function resetParticle(state, index, age = 0) {
  const o = index * 3;
  state.positions[o] = state.origins[o]; state.positions[o + 1] = state.origins[o + 1]; state.positions[o + 2] = state.origins[o + 2];
  state.velocities[o] = state.initialVelocities[o]; state.velocities[o + 1] = state.initialVelocities[o + 1]; state.velocities[o + 2] = state.initialVelocities[o + 2];
  state.ages[index] = age; state.alive[index] = age >= 0 ? 1 : 0;
  state.rotations[index] = state.initialRotations[index];
}
function boundaryExtents(source, boundary) {
  const half = {
    x: finite(boundary.width ?? source.width, 100) / 2,
    y: finite(boundary.height ?? source.height, 100) / 2,
    z: finite(boundary.depth ?? source.depth, 100) / 2
  };
  return {
    min: vector(boundary.min, { x: -half.x, y: -half.y, z: -half.z }),
    max: vector(boundary.max, half)
  };
}

function buildState(descriptor, positions, random) {
  const count = descriptor.emission.count;
  const velocities = new Float32Array(count * 3);
  const velocity = velocityRange(descriptor.particle.velocity);
  const ages = new Float32Array(count); const lifetimes = new Float32Array(count); const alive = new Uint8Array(count);
  const rotations = new Float32Array(count); const angularVelocities = new Float32Array(count);
  const rate = descriptor.emission.rate > 0 ? descriptor.emission.rate : count / Math.max(descriptor.emission.duration, 1);
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    for (const [axis, offset] of [["x", 0], ["y", 1], ["z", 2]]) velocities[o + offset] = velocity.min[axis] + (velocity.max[axis] - velocity.min[axis]) * random();
    lifetimes[i] = sampleRange(descriptor.particle.lifetime, random);
    const delay = descriptor.emission.mode === "continuous" ? i / Math.max(rate, 1e-9) : 0;
    ages[i] = -delay; alive[i] = delay === 0 ? 1 : 0;
    rotations[i] = sampleRange(descriptor.particle.rotation, random);
    angularVelocities[i] = sampleRange(descriptor.particle.angularVelocity, random);
  }
  return {
    descriptor, count, origins: new Float32Array(positions), positions: new Float32Array(positions),
    initialVelocities: new Float32Array(velocities), velocities, ages, lifetimes, alive,
    rotations, initialRotations: new Float32Array(rotations), angularVelocities,
    elapsed: 0, boundary: boundaryExtents(descriptor.source, descriptor.simulation.boundary), tempColor: new THREE.Color()
  };
}

function buildPoints(descriptor, state) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(state.positions, 3));
  const colors = new Float32Array(state.count * 3); const sizes = new Float32Array(state.count); const opacities = new Float32Array(state.count);
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("particleSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("particleOpacity", new THREE.BufferAttribute(opacities, 1));
  geometry.setAttribute("particleRotation", new THREE.BufferAttribute(state.rotations, 1));
  geometry.setAttribute("particleProgress", new THREE.BufferAttribute(new Float32Array(state.count), 1));
  const material = new THREE.ShaderMaterial({
    uniforms: particleUniforms(descriptor),
    vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: descriptor.render.transparent,
    depthWrite: descriptor.render.depthWrite, depthTest: descriptor.render.depthTest,
    blending: blending(descriptor.render.blending), vertexColors: true
  });
  trackDisposableResource([geometry, material]);
  const points = new THREE.Points(geometry, material); points.frustumCulled = descriptor.render.frustumCulled === true;
  trackDisposableResource(points);
  return points;
}

function buildBillboards(descriptor, state) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0
  ], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geometry.setAttribute("particlePosition", new THREE.InstancedBufferAttribute(state.positions, 3));
  geometry.setAttribute("color", new THREE.InstancedBufferAttribute(new Float32Array(state.count * 3), 3));
  geometry.setAttribute("particleSize", new THREE.InstancedBufferAttribute(new Float32Array(state.count), 1));
  geometry.setAttribute("particleOpacity", new THREE.InstancedBufferAttribute(new Float32Array(state.count), 1));
  geometry.setAttribute("particleRotation", new THREE.InstancedBufferAttribute(state.rotations, 1));
  geometry.setAttribute("particleProgress", new THREE.InstancedBufferAttribute(new Float32Array(state.count), 1));
  geometry.instanceCount = state.count;
  const material = new THREE.ShaderMaterial({
    uniforms: particleUniforms(descriptor),
    vertexShader: BILLBOARD_VERTEX,
    fragmentShader: BILLBOARD_FRAGMENT,
    transparent: descriptor.render.transparent,
    depthWrite: descriptor.render.depthWrite,
    depthTest: descriptor.render.depthTest,
    blending: blending(descriptor.render.blending),
    vertexColors: true
  });
  trackDisposableResource([geometry, material]);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = descriptor.render.frustumCulled === true;
  trackDisposableResource(mesh);
  return mesh;
}

function buildRenderable(descriptor, state) {
  state.positionAttributeName = descriptor.render.type === "billboard" ? "particlePosition" : "position";
  return descriptor.render.type === "billboard" ? buildBillboards(descriptor, state) : buildPoints(descriptor, state);
}

function updateAttributes(state) {
  const { descriptor, points } = state;
  const colorFrames = normalizeParticleLifecycleFrames(descriptor.particle.colorOverLife ?? descriptor.render.colorOverLife, descriptor.render.color);
  const sizeFrames = normalizeParticleLifecycleFrames(descriptor.particle.sizeOverLife ?? descriptor.render.sizeOverLife, descriptor.render.size);
  const opacityFrames = normalizeParticleLifecycleFrames(descriptor.particle.opacityOverLife ?? descriptor.render.opacityOverLife, descriptor.render.opacity);
  const colorAttr = points.geometry.getAttribute("color"); const sizeAttr = points.geometry.getAttribute("particleSize"); const opacityAttr = points.geometry.getAttribute("particleOpacity");
  const progressAttr = points.geometry.getAttribute("particleProgress");
  for (let i = 0; i < state.count; i++) {
    const lifetime = state.lifetimes[i]; const progress = Number.isFinite(lifetime) && lifetime > 0 ? Math.max(0, Math.min(1, state.ages[i] / lifetime)) : 0;
    colorCurve(colorFrames, progress, state.tempColor);
    colorAttr.setXYZ(i, state.tempColor.r, state.tempColor.g, state.tempColor.b);
    sizeAttr.setX(i, state.alive[i] ? numberCurve(sizeFrames, progress) : 0);
    opacityAttr.setX(i, state.alive[i] ? numberCurve(opacityFrames, progress) : 0);
    progressAttr.setX(i, progress);
  }
  colorAttr.needsUpdate = true; sizeAttr.needsUpdate = true; opacityAttr.needsUpdate = true; progressAttr.needsUpdate = true;
  points.geometry.getAttribute("particleRotation").needsUpdate = true;
}

function simulate(state, delta) {
  const { descriptor } = state; state.elapsed += delta;
  const acceleration = {
    x: descriptor.simulation.gravity.x + descriptor.simulation.acceleration.x + descriptor.particle.acceleration.x,
    y: descriptor.simulation.gravity.y + descriptor.simulation.acceleration.y + descriptor.particle.acceleration.y,
    z: descriptor.simulation.gravity.z + descriptor.simulation.acceleration.z + descriptor.particle.acceleration.z
  };
  const drag = Math.exp(-descriptor.simulation.drag * delta); const boundaryType = descriptor.simulation.boundary.type;
  for (let i = 0; i < state.count; i++) {
    const o = i * 3; state.ages[i] += delta;
    if (state.ages[i] < 0) { state.alive[i] = 0; continue; }
    if (Number.isFinite(state.lifetimes[i]) && state.lifetimes[i] > 0 && state.ages[i] >= state.lifetimes[i]) {
      if (descriptor.emission.loop) resetParticle(state, i, 0); else { state.alive[i] = 0; continue; }
    } else state.alive[i] = 1;
    if (!state.alive[i]) continue;
    let ax = acceleration.x; let ay = acceleration.y; let az = acceleration.z;
    const noise = descriptor.simulation.noise;
    if (noise.strength > 0) {
      ax += Math.sin((state.elapsed + i * 0.73) * noise.frequency) * noise.strength;
      ay += Math.sin((state.elapsed + i * 1.13) * noise.frequency) * noise.strength;
      az += Math.cos((state.elapsed + i * 1.71) * noise.frequency) * noise.strength;
    }
    for (const attractor of descriptor.simulation.attractors) {
      const target = vector(attractor.position); const dx = target.x - state.positions[o]; const dy = target.y - state.positions[o + 1]; const dz = target.z - state.positions[o + 2];
      const distanceSq = Math.max(dx * dx + dy * dy + dz * dz, 1e-6); const maxDistance = finite(attractor.maxDistance, Infinity);
      if (Math.sqrt(distanceSq) <= maxDistance) { const force = finite(attractor.strength, 1) / distanceSq; ax += dx * force; ay += dy * force; az += dz * force; }
    }
    state.velocities[o] = (state.velocities[o] + ax * delta) * drag; state.velocities[o + 1] = (state.velocities[o + 1] + ay * delta) * drag; state.velocities[o + 2] = (state.velocities[o + 2] + az * delta) * drag;
    state.positions[o] += state.velocities[o] * delta; state.positions[o + 1] += state.velocities[o + 1] * delta; state.positions[o + 2] += state.velocities[o + 2] * delta;
    state.rotations[i] += state.angularVelocities[i] * delta;
    for (const [offset, axis] of [[0, "x"], [1, "y"], [2, "z"]]) {
      const value = state.positions[o + offset]; const min = state.boundary.min[axis]; const max = state.boundary.max[axis];
      if (value < min || value > max) {
        if (boundaryType === "wrap") state.positions[o + offset] = value < min ? max : min;
        else if (boundaryType === "bounce") { state.positions[o + offset] = Math.max(min, Math.min(max, value)); state.velocities[o + offset] *= -finite(descriptor.simulation.boundary.restitution, 1); }
        else if (boundaryType === "kill") state.alive[i] = 0;
      }
    }
  }
  pointsPositionNeedsUpdate(state); updateAttributes(state);
}
function pointsPositionNeedsUpdate(state) { state.points.geometry.getAttribute(state.positionAttributeName).needsUpdate = true; }

export function createParticleCpuSimulationStore() {
  const states = new WeakMap(); const targets = new Set();
  function disposeParticleCpuSimulation(points) { const state = states.get(points); if (!state) return; points.removeEventListener("removed", state.onRemoved); states.delete(points); targets.delete(points); }
  function register(points, state) { state.points = points; state.onRemoved = () => disposeParticleCpuSimulation(points); points.addEventListener("removed", state.onRemoved); states.set(points, state); targets.add(points); }
  function update(delta) { if (!(delta > 0)) return; for (const points of targets) { const state = states.get(points); if (!points?.parent || !state) { disposeParticleCpuSimulation(points); continue; } simulate(state, delta); } }
  function dispose() { for (const points of [...targets]) disposeParticleCpuSimulation(points); }
  return { register, update, disposeParticleCpuSimulation, dispose };
}

function resolveStore(scope) { return resolveRuntimeContext(scope).particleCpuSimulation; }
export function updateParticleCpuSimulation(delta, scope) { return resolveStore(scope).update(delta); }
export function disposeParticleCpuSimulation(points, scope) { return resolveStore(scope ?? points).disposeParticleCpuSimulation(points); }

function finishCpuEmitter(descriptor, scene, ctx, positions, random) {
  const state = buildState(descriptor, positions, random); const points = buildRenderable(descriptor, state);
  points.name = descriptor.name || "particle-emitter-cpu"; setUserDataObjJson(points, descriptor); applyTransform(points, descriptor); scene.add(points); state.points = points; updateAttributes(state);
  const spriteUrl = descriptor.render.sprite?.url ?? descriptor.render.sprite ?? descriptor.render.map;
  if (typeof spriteUrl === "string" && spriteUrl.trim()) {
    new THREE.TextureLoader(loadingManager).load(resolvePublicAssetUrl(spriteUrl), (texture) => {
      if (!points.parent) { texture.dispose(); return; }
      trackDisposableResource(texture);
      points.material.uniforms.spriteMap.value = texture;
      points.material.uniforms.useSpriteMap.value = true;
    });
  }
  resolveStore(scene).register(points, state); return registerObject(points, descriptor);
}

export function deployParticleCpuEmitter(record, scene, ctx = {}) {
  const descriptor = normalizeParticleEmitterV2(record, { defaultBackend: "cpu" });
  const count = assertParticleCountWithinBudget(descriptor, ctx.particleBudget || ctx);
  const random = createSeededRandom(descriptor.emission.seed);
  const result = sampleParticleSourcePositions(descriptor.source, count, {
    seed: descriptor.emission.seed, random,
    resolveMesh: (id) => getObjectByThreeJsonId(id, scene),
    targetMatrixWorld: buildParticleEmitterWorldMatrix(descriptor, scene)
  });
  if (result && typeof result.then === "function") return result.then((positions) => finishCpuEmitter(descriptor, scene, ctx, positions, random));
  return finishCpuEmitter(descriptor, scene, ctx, result, random);
}

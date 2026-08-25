import * as THREE from "three/webgpu";
import {
  Fn,
  If,
  color,
  deltaTime,
  float,
  instanceIndex,
  mix,
  select,
  storage,
  texture,
  uv,
  vec2,
  vec3,
  vec4
} from "three/tsl";
import { registerObject, getObjectByThreeJsonId } from "../core/handler/objectRegistry.js";
import { setUserDataObjJson } from "../core/handler/objectDescriptorAttach.js";
import { trackDisposableResource } from "../core/handler/trackedResourceRegistry.js";
import { registerParticleSimulationBackend, registerParticleSimulationLifecycle } from "../core/builder/particle/particleSimulationBackendRegistry.js";
import { buildParticleEmitterWorldMatrix, createSeededRandom, sampleParticleSourcePositions } from "../core/builder/particle/particleSourceSampler.js";
import { PARTICLE_ATTRACTOR_LIMIT, assertParticleCountWithinBudget, normalizeParticleEmitterV2, sampleRange } from "../core/builder/particle/particleV2Descriptor.js";
import { normalizeParticleLifecycleFrames } from "../core/builder/particle/particleLifecycle.js";
import { resolvePosition, resolveRotation, resolveScale } from "../core/util/vectorValue.js";
import { applyVisibilityFromDescriptor } from "../core/util/util.js";
import { loadingManager } from "../core/cache/loading.js";
import { resolvePublicAssetUrl } from "../core/util/assetsBase.js";

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function vector(value, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: finite(value?.x, fallback.x),
    y: finite(value?.y, fallback.y),
    z: finite(value?.z, fallback.z)
  };
}

function velocityRange(value) {
  if (value && typeof value === "object" && (value.min || value.max)) {
    const min = vector(value.min);
    return { min, max: vector(value.max, min) };
  }
  const exact = vector(value);
  return { min: exact, max: exact };
}

function resolveBoundary(descriptor) {
  const config = descriptor.simulation.boundary;
  const source = descriptor.source;
  const half = {
    x: finite(config.width ?? source.width, 100) / 2,
    y: finite(config.height ?? source.height, 100) / 2,
    z: finite(config.depth ?? source.depth, 100) / 2
  };
  return {
    type: config.type,
    min: vector(config.min, { x: -half.x, y: -half.y, z: -half.z }),
    max: vector(config.max, half),
    restitution: finite(config.restitution, 1)
  };
}

function applyTransform(object, record) {
  const position = resolvePosition(record.position);
  const rotation = resolveRotation(record.rotation);
  const scale = resolveScale(record.scale);
  object.position.set(position.x, position.y, position.z);
  object.rotation.set(rotation.x, rotation.y, rotation.z);
  object.scale.set(scale.x, scale.y, scale.z);
  applyVisibilityFromDescriptor(object, record);
}

/** Pure deterministic initialization shared by tests and the WebGPU adapter. */
export function buildWebgpuParticleInitialArrays(descriptor, sampledPositions, random = Math.random) {
  const count = descriptor.emission.count;
  if (!(sampledPositions instanceof Float32Array) || sampledPositions.length < count * 3) {
    throw new TypeError("WebGPU particle source did not return enough positions");
  }
  const positionLife = new Float32Array(count * 4);
  const originLife = new Float32Array(count * 4);
  const velocityAge = new Float32Array(count * 4);
  const initialVelocityAge = new Float32Array(count * 4);
  const velocity = velocityRange(descriptor.particle.velocity);
  const rate = descriptor.emission.rate > 0
    ? descriptor.emission.rate
    : count / Math.max(descriptor.emission.duration, 1);
  for (let index = 0; index < count; index++) {
    const sourceOffset = index * 3;
    const offset = index * 4;
    const lifetime = sampleRange(descriptor.particle.lifetime, random);
    const age = descriptor.emission.mode === "continuous" ? -index / Math.max(rate, 1e-9) : 0;
    const vx = velocity.min.x + (velocity.max.x - velocity.min.x) * random();
    const vy = velocity.min.y + (velocity.max.y - velocity.min.y) * random();
    const vz = velocity.min.z + (velocity.max.z - velocity.min.z) * random();
    positionLife.set([sampledPositions[sourceOffset], sampledPositions[sourceOffset + 1], sampledPositions[sourceOffset + 2], lifetime], offset);
    originLife.set([sampledPositions[sourceOffset], sampledPositions[sourceOffset + 1], sampledPositions[sourceOffset + 2], lifetime], offset);
    velocityAge.set([vx, vy, vz, age], offset);
    initialVelocityAge.set([vx, vy, vz, age], offset);
  }
  return { positionLife, originLife, velocityAge, initialVelocityAge };
}

function createStorage(array, count) {
  return storage(new THREE.StorageInstancedBufferAttribute(array, 4), "vec4", count);
}

function buildComputeNode(descriptor, buffers) {
  const acceleration = vector({
    x: descriptor.simulation.acceleration.x + descriptor.simulation.gravity.x + descriptor.particle.acceleration.x,
    y: descriptor.simulation.acceleration.y + descriptor.simulation.gravity.y + descriptor.particle.acceleration.y,
    z: descriptor.simulation.acceleration.z + descriptor.simulation.gravity.z + descriptor.particle.acceleration.z
  });
  const boundary = resolveBoundary(descriptor);
  const dragFactor = float(-descriptor.simulation.drag).mul(deltaTime).exp();
  const loop = descriptor.emission.loop === true;
  const noise = descriptor.simulation.noise;

  return Fn(() => {
    const positionLife = buffers.position.element(instanceIndex);
    const originLife = buffers.origin.element(instanceIndex);
    const velocityAge = buffers.velocity.element(instanceIndex);
    const initialVelocityAge = buffers.initialVelocity.element(instanceIndex);
    const lifetime = positionLife.w;
    velocityAge.w.addAssign(deltaTime);

    If(lifetime.greaterThan(0).and(velocityAge.w.greaterThanEqual(lifetime)), () => {
      if (loop) {
        positionLife.assign(originLife);
        velocityAge.assign(initialVelocityAge);
        velocityAge.w.assign(0);
      }
    });

    const alive = velocityAge.w.greaterThanEqual(0).and(
      lifetime.lessThanEqual(0).or(velocityAge.w.lessThan(lifetime))
    );
    If(alive, () => {
      const force = vec3(acceleration.x, acceleration.y, acceleration.z).toVar();
      if (noise.strength > 0) {
        const phase = float(instanceIndex).mul(0.731).add(velocityAge.w).mul(noise.frequency);
        force.addAssign(vec3(phase.sin(), phase.mul(1.37).sin(), phase.mul(1.91).cos()).mul(noise.strength));
      }
      for (const attractor of descriptor.simulation.attractors.slice(0, PARTICLE_ATTRACTOR_LIMIT)) {
        const target = vector(attractor.position);
        const offset = vec3(target.x, target.y, target.z).sub(positionLife.xyz);
        const distanceSq = offset.dot(offset).max(0.0001);
        const addForce = () => {
          force.addAssign(offset.mul(finite(attractor.strength, 1)).div(distanceSq));
        };
        const maxDistance = Number(attractor.maxDistance);
        if (Number.isFinite(maxDistance) && maxDistance > 0) {
          If(distanceSq.lessThanEqual(maxDistance * maxDistance), addForce);
        } else {
          addForce();
        }
      }
      velocityAge.xyz.addAssign(force.mul(deltaTime));
      velocityAge.xyz.mulAssign(dragFactor);
      positionLife.xyz.addAssign(velocityAge.xyz.mul(deltaTime));

      if (boundary.type === "wrap") {
        If(positionLife.x.lessThan(boundary.min.x), () => { positionLife.x.assign(boundary.max.x); });
        If(positionLife.x.greaterThan(boundary.max.x), () => { positionLife.x.assign(boundary.min.x); });
        If(positionLife.y.lessThan(boundary.min.y), () => { positionLife.y.assign(boundary.max.y); });
        If(positionLife.y.greaterThan(boundary.max.y), () => { positionLife.y.assign(boundary.min.y); });
        If(positionLife.z.lessThan(boundary.min.z), () => { positionLife.z.assign(boundary.max.z); });
        If(positionLife.z.greaterThan(boundary.max.z), () => { positionLife.z.assign(boundary.min.z); });
      } else if (boundary.type === "bounce") {
        If(positionLife.x.lessThan(boundary.min.x).or(positionLife.x.greaterThan(boundary.max.x)), () => {
          positionLife.x.assign(positionLife.x.clamp(boundary.min.x, boundary.max.x));
          velocityAge.x.mulAssign(-boundary.restitution);
        });
        If(positionLife.y.lessThan(boundary.min.y).or(positionLife.y.greaterThan(boundary.max.y)), () => {
          positionLife.y.assign(positionLife.y.clamp(boundary.min.y, boundary.max.y));
          velocityAge.y.mulAssign(-boundary.restitution);
        });
        If(positionLife.z.lessThan(boundary.min.z).or(positionLife.z.greaterThan(boundary.max.z)), () => {
          positionLife.z.assign(positionLife.z.clamp(boundary.min.z, boundary.max.z));
          velocityAge.z.mulAssign(-boundary.restitution);
        });
      } else if (boundary.type === "kill") {
        const outside = positionLife.x.lessThan(boundary.min.x).or(positionLife.x.greaterThan(boundary.max.x))
          .or(positionLife.y.lessThan(boundary.min.y)).or(positionLife.y.greaterThan(boundary.max.y))
          .or(positionLife.z.lessThan(boundary.min.z)).or(positionLife.z.greaterThan(boundary.max.z));
        If(outside, () => {
          positionLife.w.assign(0.000001);
          velocityAge.w.assign(1);
        });
      }
    });
  })().compute(descriptor.emission.count);
}

function resolveBlending(value) {
  return ({
    additive: THREE.AdditiveBlending,
    subtractive: THREE.SubtractiveBlending,
    multiply: THREE.MultiplyBlending
  })[value] ?? THREE.NormalBlending;
}

function numberCurveNode(value, fallback, progress) {
  const frames = normalizeParticleLifecycleFrames(value, fallback);
  let result = float(finite(frames.at(-1).value, finite(fallback, 0)));
  for (let index = frames.length - 2; index >= 0; index--) {
    const a = frames[index];
    const b = frames[index + 1];
    const factor = progress.sub(a.t).div(Math.max(1e-9, b.t - a.t)).clamp(0, 1);
    const segment = mix(float(finite(a.value, finite(fallback, 0))), float(finite(b.value, finite(a.value, finite(fallback, 0)))), factor);
    result = select(progress.lessThanEqual(b.t), segment, result);
  }
  return result;
}

function colorCurveNode(value, fallback, progress) {
  const frames = normalizeParticleLifecycleFrames(value, fallback);
  let result = color(frames.at(-1).value ?? fallback ?? "#ffffff");
  for (let index = frames.length - 2; index >= 0; index--) {
    const a = frames[index];
    const b = frames[index + 1];
    const factor = progress.sub(a.t).div(Math.max(1e-9, b.t - a.t)).clamp(0, 1);
    const segment = mix(color(a.value ?? fallback ?? "#ffffff"), color(b.value ?? a.value ?? fallback ?? "#ffffff"), factor);
    result = select(progress.lessThanEqual(b.t), segment, result);
  }
  return result;
}

function randomRangeNode(range, salt) {
  const randomValue = float(instanceIndex).add(salt).mul(12.9898).sin().mul(43758.5453).fract();
  return mix(float(finite(range.min, 0)), float(finite(range.max, finite(range.min, 0))), randomValue);
}

function atlasInfo(descriptor) {
  const atlas = descriptor.render.sprite?.atlas ?? descriptor.particle.atlas ?? descriptor.render.atlas ?? {};
  return {
    columns: Math.max(1, Math.floor(finite(atlas.columns, 1))),
    rows: Math.max(1, Math.floor(finite(atlas.rows, 1))),
    start: Math.max(0, finite(atlas.startFrame ?? atlas.frame, 0)),
    end: Math.max(0, finite(atlas.endFrame ?? atlas.frame, 0))
  };
}

function buildMaterial(descriptor, buffers) {
  const positionLife = buffers.position.toAttribute();
  const velocityAge = buffers.velocity.toAttribute();
  const progress = select(
    positionLife.w.greaterThan(0),
    velocityAge.w.div(positionLife.w).clamp(0, 1),
    float(0)
  );
  const alive = velocityAge.w.greaterThanEqual(0).and(
    positionLife.w.lessThanEqual(0).or(velocityAge.w.lessThan(positionLife.w))
  );
  const visibility = select(alive, float(1), float(0));
  const sizeNode = numberCurveNode(
    descriptor.particle.sizeOverLife ?? descriptor.render.sizeOverLife,
    descriptor.render.size,
    progress
  ).mul(visibility);
  const particleColorNode = colorCurveNode(
    descriptor.particle.colorOverLife ?? descriptor.render.colorOverLife,
    descriptor.render.color,
    progress
  );
  const particleOpacityNode = numberCurveNode(
    descriptor.particle.opacityOverLife ?? descriptor.render.opacityOverLife,
    descriptor.render.opacity,
    progress
  ).mul(visibility);
  const MaterialClass = descriptor.render.type === "points" ? THREE.PointsNodeMaterial : THREE.SpriteNodeMaterial;
  const material = new MaterialClass({
    transparent: descriptor.render.transparent,
    depthWrite: descriptor.render.depthWrite,
    depthTest: descriptor.render.depthTest,
    blending: resolveBlending(descriptor.render.blending),
    sizeAttenuation: descriptor.render.sizeAttenuation
  });
  material.positionNode = positionLife.xyz;
  if (descriptor.render.type === "points") material.sizeNode = vec2(sizeNode);
  else material.scaleNode = vec2(sizeNode);
  material.rotationNode = randomRangeNode(descriptor.particle.rotation, 3.17)
    .add(randomRangeNode(descriptor.particle.angularVelocity, 17.93).mul(velocityAge.w.max(0)));
  material.colorNode = particleColorNode;
  const circularMask = uv().sub(0.5).length().smoothstep(0.35, 0.5).oneMinus();
  material.opacityNode = particleOpacityNode.mul(circularMask);
  material.alphaTest = 0.001;
  return { material, progress, particleColorNode, particleOpacityNode };
}

function attachSpriteTexture(descriptor, materialState, particles) {
  const spriteUrl = descriptor.render.sprite?.url ?? descriptor.render.sprite ?? descriptor.render.map;
  if (typeof spriteUrl !== "string" || !spriteUrl.trim()) return;
  new THREE.TextureLoader(loadingManager).load(resolvePublicAssetUrl(spriteUrl), (spriteTexture) => {
    if (!particles.parent) { spriteTexture.dispose(); return; }
    trackDisposableResource(spriteTexture);
    const atlas = atlasInfo(descriptor);
    const frame = mix(float(atlas.start), float(atlas.end), materialState.progress).add(0.5).floor();
    const cell = vec2(frame.mod(atlas.columns), float(atlas.rows - 1).sub(frame.div(atlas.columns).floor()));
    const spriteUv = uv().add(cell).div(vec2(atlas.columns, atlas.rows));
    const spriteNode = texture(spriteTexture, spriteUv);
    materialState.material.colorNode = vec4(materialState.particleColorNode, 1).mul(spriteNode);
    materialState.material.opacityNode = materialState.particleOpacityNode.mul(spriteNode.a);
    materialState.material.needsUpdate = true;
  });
}

function finishWebgpuEmitter(descriptor, scene, ctx, sampledPositions, random) {
  const renderer = ctx.renderer;
  if (!renderer?.isWebGPURenderer) {
    const error = new Error("webgpu-compute particles require a WebGPURenderer runtime");
    error.code = "E_PARTICLE_WEBGPU_RENDERER_REQUIRED";
    throw error;
  }
  const maxStorageBytes = Number(renderer.backend?.device?.limits?.maxStorageBufferBindingSize);
  const bytesPerBuffer = descriptor.emission.count * 4 * Float32Array.BYTES_PER_ELEMENT;
  if (Number.isFinite(maxStorageBytes) && bytesPerBuffer > maxStorageBytes) {
    const error = new Error(`Particle storage buffer requires ${bytesPerBuffer} bytes; hardware limit is ${maxStorageBytes}`);
    error.code = "E_PARTICLE_HARDWARE_LIMIT";
    throw error;
  }
  const arrays = buildWebgpuParticleInitialArrays(descriptor, sampledPositions, random);
  const buffers = {
    position: createStorage(arrays.positionLife, descriptor.emission.count),
    origin: createStorage(arrays.originLife, descriptor.emission.count),
    velocity: createStorage(arrays.velocityAge, descriptor.emission.count),
    initialVelocity: createStorage(arrays.initialVelocityAge, descriptor.emission.count)
  };
  const computeNode = buildComputeNode(descriptor, buffers);
  const geometry = new THREE.PlaneGeometry(1, 1);
  const materialState = buildMaterial(descriptor, buffers);
  const material = materialState.material;
  const particles = new THREE.InstancedMesh(geometry, material, descriptor.emission.count);
  const identity = new THREE.Matrix4();
  for (let index = 0; index < descriptor.emission.count; index++) particles.setMatrixAt(index, identity);
  particles.instanceMatrix.needsUpdate = true;
  particles.frustumCulled = descriptor.render.frustumCulled === true;
  particles.name = descriptor.name || "particle-emitter-webgpu";
  setUserDataObjJson(particles, descriptor);
  applyTransform(particles, descriptor);
  trackDisposableResource([geometry, material], scene);
  trackDisposableResource(particles, scene);
  scene.add(particles);
  attachSpriteTexture(descriptor, materialState, particles);
  registerParticleSimulationLifecycle(particles, {
    update: () => renderer.compute(computeNode),
    dispose: () => {
      geometry.dispose();
      material.dispose();
    }
  }, scene);
  return registerObject(particles, descriptor, scene);
}

export function deployParticleWebgpuEmitter(record, scene, ctx = {}) {
  const descriptor = normalizeParticleEmitterV2(record, { defaultBackend: "webgpu-compute" });
  assertParticleCountWithinBudget(descriptor, ctx.particleBudget || ctx);
  const random = createSeededRandom(descriptor.emission.seed);
  const sampled = sampleParticleSourcePositions(descriptor.source, descriptor.emission.count, {
    random,
    seed: descriptor.emission.seed,
    resolveMesh: (id) => getObjectByThreeJsonId(id, scene),
    targetMatrixWorld: buildParticleEmitterWorldMatrix(descriptor, scene)
  });
  if (sampled && typeof sampled.then === "function") {
    return sampled.then((positions) => finishWebgpuEmitter(descriptor, scene, ctx, positions, random));
  }
  return finishWebgpuEmitter(descriptor, scene, ctx, sampled, random);
}

let registered = false;
export function registerWebgpuParticleBackend() {
  if (registered) return;
  registerParticleSimulationBackend("webgpu-compute", deployParticleWebgpuEmitter);
  registered = true;
}

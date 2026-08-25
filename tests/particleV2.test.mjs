import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { PARTICLE_ATTRACTOR_LIMIT, normalizeParticleEmitterV2 } from "../core/builder/particle/particleV2Descriptor.js";
import { normalizeParticleLifecycleFrames, sampleParticleLifecycleSegment } from "../core/builder/particle/particleLifecycle.js";
import { buildParticleEmitterWorldMatrix, createSeededRandom, sampleParticleSourcePositions } from "../core/builder/particle/particleSourceSampler.js";
import { deployParticleCpuEmitter } from "../core/builder/particle/particleCpuSimulation.js";
import { deployParticleEmitterCore } from "../core/builder/particle/particleEmitterBuilder.js";
import { deployParticleGpuEmitter } from "../core/builder/particle/particleGpuCompute.js";
import { createRuntimeContext, attachRuntimeContext } from "../core/runtime/runtimeContext.js";

test("V2 descriptor keeps the five orthogonal blocks", () => {
  const descriptor = normalizeParticleEmitterV2({
    objType: "particleEmitter",
    source: { type: "disc", radius: 5 },
    emission: { mode: "continuous", count: 20, rate: 10, seed: 42 },
    particle: { lifetime: [1, 3], velocity: { x: 0, y: 2, z: 0 } },
    simulation: { backend: "cpu", gravity: { y: -9.8 } },
    render: { type: "points", size: 3 }
  });
  assert.equal(descriptor.emission.count, 20);
  assert.equal(descriptor.simulation.backend, "cpu");
  assert.equal(descriptor.source.type, "disc");
  assert.deepEqual(descriptor.particle.lifetime, { min: 1, max: 3 });
});

test("all built-in particle backends reject attractors beyond the shared contract", () => {
  const attractors = Array.from({ length: PARTICLE_ATTRACTOR_LIMIT + 3 }, (_, index) => ({
    position: { x: index, y: 0, z: 0 }, strength: index + 1
  }));
  assert.equal(PARTICLE_ATTRACTOR_LIMIT, 16);
  assert.throws(
    () => normalizeParticleEmitterV2({ simulation: { backend: "cpu", attractors } }),
    (error) => error?.code === "E_PARTICLE_ATTRACTOR_LIMIT"
      && error?.attractorCount === PARTICLE_ATTRACTOR_LIMIT + 3
      && error?.maxAttractors === PARTICLE_ATTRACTOR_LIMIT
  );
});

test("particle sources are reproducible with a fixed seed", () => {
  const source = { type: "cone", radius: 4, height: 8 };
  const a = sampleParticleSourcePositions(source, 32, { random: createSeededRandom(9) });
  const b = sampleParticleSourcePositions(source, 32, { random: createSeededRandom(9) });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, sampleParticleSourcePositions(source, 32, { random: createSeededRandom(10) }));
});

test("curve particle sources accept the shared CurvePath descriptor", () => {
  const positions = sampleParticleSourcePositions({
    type: "curve",
    path: {
      type: "curvePath",
      curves: [
        { type: "line", points: [[0, 0, 0], [1, 0, 0]] },
        { type: "quadraticBezier", points: [[1, 0, 0], [2, 1, 0], [3, 0, 0]] }
      ]
    }
  }, 12, { random: createSeededRandom(1) });
  assert.equal(positions.length, 36);
});

test("meshSurface samples a referenced child mesh in emitter-local coordinates", () => {
  const scene = new THREE.Scene();
  const sourceRoot = new THREE.Group();
  sourceRoot.position.x = 5;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0,0,0, 0,1,0, 0,0,1], 3));
  const sourceMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  sourceMesh.position.x = 2;
  sourceRoot.add(sourceMesh);
  scene.add(sourceRoot);
  const sampled = sampleParticleSourcePositions({ type: "meshSurface", object: sourceRoot }, 1, {
    random: createSeededRandom(3),
    targetMatrixWorld: buildParticleEmitterWorldMatrix({ position: { x: 2, y: 0, z: 0 } }, scene)
  });
  assert.ok(Math.abs(sampled[0] - 5) < 1e-6);
  geometry.dispose();
  sourceMesh.material.dispose();
});

test("Particle V2 rejects removed aliases and does not turn unknown sources into boxes", () => {
  const aliased = normalizeParticleEmitterV2({ simulation: { backend: "gpuCompute" } });
  assert.equal(aliased.simulation.backend, "gpucompute");
  assert.throws(
    () => deployParticleEmitterCore(aliased, new THREE.Scene(), {}),
    (error) => error?.code === "E_PARTICLE_BACKEND_UNAVAILABLE"
  );
  assert.throws(
    () => sampleParticleSourcePositions({ type: "unknown-shape" }, 4),
    (error) => error?.code === "E_PARTICLE_SOURCE_UNAVAILABLE"
  );
});

test("the direct WebGL compute API reports a structured WebGL2 requirement", () => {
  assert.throws(
    () => deployParticleGpuEmitter(
      { objType: "particleEmitter", simulation: { backend: "webgl-compute" } },
      new THREE.Scene(),
      { capabilities: { isWebGL2: false } }
    ),
    (error) => error?.code === "E_PARTICLE_WEBGL2_REQUIRED"
  );
});

test("lifecycle curves preserve intermediate peaks across particle backends", () => {
  const frames = normalizeParticleLifecycleFrames([0, 0.9, 0], 1);
  assert.deepEqual(frames, [
    { t: 0, value: 0 },
    { t: 0.5, value: 0.9 },
    { t: 1, value: 0 }
  ]);
  const [a, b, factor] = sampleParticleLifecycleSegment(frames, 0.5);
  assert.equal(a.value + (b.value - a.value) * factor, 0.9);
});

test("lifecycle curves reject keys beyond the shared shader contract instead of truncating", () => {
  assert.throws(
    () => normalizeParticleLifecycleFrames(Array.from({ length: 9 }, (_, index) => index), 0),
    (error) => error?.code === "E_PARTICLE_LIFECYCLE_KEYFRAME_LIMIT"
      && error?.keyframeCount === 9
      && error?.maxKeyframes === 8
  );
});

test("CPU emitter supports lifecycle curves, forces and runtime disposal", () => {
  const scene = new THREE.Scene();
  const runtimeContext = createRuntimeContext();
  attachRuntimeContext(scene, runtimeContext);
  const points = deployParticleCpuEmitter({
    objType: "particleEmitter",
    source: { type: "line", points: [[0, 0, 0], [4, 0, 0]] },
    emission: { mode: "burst", count: 8, seed: 7 },
    particle: { lifetime: 2, velocity: { min: { y: 1 }, max: { y: 2 } }, sizeOverLife: [2, 0] },
    simulation: { backend: "cpu", gravity: { y: -1 }, drag: 0.1 },
    render: { color: "#ff8800", opacityOverLife: [1, 0], blending: "additive" }
  }, scene, {});
  assert.equal(points.isPoints, true);
  const before = points.geometry.getAttribute("position").array[1];
  runtimeContext.particleCpuSimulation.update(0.1);
  assert.notEqual(points.geometry.getAttribute("position").array[1], before);
  scene.remove(points);
  runtimeContext.particleCpuSimulation.update(0.1);
  runtimeContext.dispose();
});

import test from "node:test";
import assert from "node:assert/strict";
import * as WEBGPU from "three/webgpu";
import { normalizeParticleEmitterV2 } from "../core/builder/particle/particleV2Descriptor.js";
import { createSeededRandom, sampleParticleSourcePositions } from "../core/builder/particle/particleSourceSampler.js";
import { getParticleSimulationBackend } from "../core/builder/particle/particleSimulationBackendRegistry.js";
import { getSceneCapability } from "../core/capabilities/sceneCapabilityManifest.js";
import { attachRuntimeContext, createRuntimeContext } from "../core/runtime/runtimeContext.js";
import { buildWebgpuParticleInitialArrays, deployParticleWebgpuEmitter } from "../webgpu/index.js";

test("explicit WebGPU entry registers compute particles and shares V2 source initialization", () => {
  const descriptor = normalizeParticleEmitterV2({
    objType: "particleEmitter",
    source: { type: "sphere", radius: 3 },
    emission: { mode: "continuous", count: 17, rate: 5, seed: 42 },
    particle: { lifetime: [1, 2], velocity: { min: { x: -1 }, max: { x: 1 } } },
    simulation: { backend: "webgpu-compute" },
    render: { type: "billboard" }
  });
  const random = createSeededRandom(42);
  const positions = sampleParticleSourcePositions(descriptor.source, descriptor.emission.count, { random });
  const arrays = buildWebgpuParticleInitialArrays(descriptor, positions, random);
  assert.equal(arrays.positionLife.length, 17 * 4);
  assert.ok(arrays.initialVelocityAge[7 * 4 + 3] < 0);
  assert.equal(typeof getParticleSimulationBackend("webgpu-compute"), "function");
  assert.equal(getSceneCapability("particleBackends", "webgpu-compute").status, "preview");
});

test("WebGPU particles build full lifecycle curves for points and billboards", () => {
  for (const renderType of ["points", "billboard"]) {
    const scene = new WEBGPU.Scene();
    attachRuntimeContext(scene, createRuntimeContext());
    const particles = deployParticleWebgpuEmitter({
      objType: "particleEmitter",
      source: { type: "box", width: 1, height: 1, depth: 1 },
      emission: { count: 4, seed: 3 },
      particle: {
        lifetime: 2,
        sizeOverLife: [0, 2, 0],
        opacityOverLife: [0, 1, 0],
        colorOverLife: ["#ff0000", "#00ff00", "#0000ff"],
        rotation: [0, 1],
        angularVelocity: [-1, 1]
      },
      simulation: { backend: "webgpu-compute", attractors: [{ position: { x: 0 }, strength: 2, maxDistance: 3 }] },
      render: { type: renderType }
    }, scene, {
      renderer: {
        isWebGPURenderer: true,
        backend: { device: { limits: { maxStorageBufferBindingSize: 1_000_000 } } },
        compute() {}
      }
    });
    assert.equal(particles.isInstancedMesh, true);
    assert.equal(particles.material.isPointsNodeMaterial === true, renderType === "points");
    scene.remove(particles);
  }
});

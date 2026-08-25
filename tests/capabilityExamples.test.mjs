import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { assertSceneCapabilities } from "../core/capabilities/sceneCapabilityValidation.js";

const root = path.resolve(import.meta.dirname, "..");

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
}

test("Particle V2 and stable capability examples are valid JSON capability contracts", async () => {
  await import("../core/builder/particle/particlesRaster.js");
  for (const file of [
    "examples/particle-v2/text-logo.json",
    "examples/particle-v2/fire-smoke.json",
    "examples/particle-v2/rain-snow.json",
    "examples/particle-v2/attractor.json",
    "examples/particle-v2/mesh-surface.json",
    "examples/capabilities/lod-curves.json",
    "assets/json/tutorial/track-02/02-09-particle-emitter-gpu.json",
    "assets/json/tutorial/track-02/02-10-particle-v2-sources.json"
  ]) {
    const payload = readJson(file);
    assert.ok(payload.objectList || payload.worldInfo, file);
    assert.doesNotThrow(() => assertSceneCapabilities(payload), file);
  }
});

test("WebGPU examples become valid only after the explicit preview import", async () => {
  await import("../webgpu/index.js");
  for (const file of [
    "examples/webgpu/tsl-material.json",
    "examples/webgpu/webgpu-particles.json"
  ]) {
    const payload = readJson(file);
    assert.equal(payload.sceneConfig.renderer.backend, "webgpu");
    assert.doesNotThrow(() => assertSceneCapabilities(payload, { rendererBackend: "webgpu" }), file);
  }
});

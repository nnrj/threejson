import assert from "node:assert/strict";
import test from "node:test";

import {
  _clearSceneCapabilityRegistrationsForTests,
  getSceneCapabilityManifest,
  isSceneCapabilityAvailable,
  registerSceneCapability,
  unregisterSceneCapability
} from "../core/capabilities/sceneCapabilityManifest.js";
import { buildAgentCapabilityIndex } from "../core/ai/sceneCapabilityIndex.js";

test.afterEach(() => _clearSceneCapabilityRegistrationsForTests());

test("capability manifest exposes implemented lazy WebGL passes", () => {
  const manifest = getSceneCapabilityManifest({ rendererBackend: "webgl" });
  assert.equal(manifest.categories.rendererBackends.webgl.status, "stable");
  assert.equal(manifest.categories.rendererBackends.webgpu, undefined);
  assert.equal(manifest.categories.passes.unrealBloom.status, "stable");
  assert.equal(manifest.categories.passes.unrealBloom.lazy, true);
  assert.equal(manifest.categories.passes.unrealBloom.activation, "descriptor");
  assert.equal(manifest.categories.particleSources.textMask.status, "stable");
  assert.equal(manifest.categories.particleSources.textMask.activation, "descriptor");
  assert.equal(manifest.categories.controlsTypes.arcball.entry, "threejson/controls-extra");
  assert.equal(manifest.categories.materials.physical.status, "stable");
  assert.deepEqual(manifest.categories.objects.externalModel.materialBindings.formats, ["gltf", "glb"]);
  assert.deepEqual(manifest.categories.objects.externalModel.materialBindings.modes, ["replace", "patch"]);
  assert.ok(manifest.categories.modelFormats.fbx);
  assert.equal(manifest.categories.modelFormats.usd.import, true);
  assert.equal(manifest.categories.modelFormats.usd.export, false);
  assert.ok(manifest.categories.modelFormats.usdz);
});

test("capability manifest exposes unavailable preview renderer diagnostics", () => {
  const manifest = getSceneCapabilityManifest({ includeUnavailable: true });
  assert.equal(manifest.categories.passes.unrealBloom.status, "stable");
  assert.match(manifest.categories.rendererBackends.webgpu.reason, /threejson\/webgpu/);
});

test("optional modules can register and revoke preview capabilities", () => {
  registerSceneCapability("rendererBackends", "webgpu", {
    status: "preview",
    async: true,
    rendererBackends: ["webgpu"]
  });
  assert.equal(isSceneCapabilityAvailable("rendererBackends", "webgpu"), true);
  assert.equal(
    getSceneCapabilityManifest({ rendererBackend: "webgpu" }).categories.rendererBackends.webgpu.status,
    "preview"
  );
  assert.equal(unregisterSceneCapability("rendererBackends", "webgpu"), true);
  assert.equal(isSceneCapabilityAvailable("rendererBackends", "webgpu"), false);
});

test("AI capability snapshot advertises available runtime features only", () => {
  const prompt = buildAgentCapabilityIndex({ rendererBackend: "webgl" });
  assert.match(prompt, /GLTF\/GLB\/OBJ\/STL\/PLY\/FBX\/USD\/USDZ/);
  assert.match(prompt, /post-processing passes:[^\n]*unrealBloom/);
  assert.match(prompt, /post-processing passes:[^\n]*fxaa/);
  assert.match(prompt, /materials:[^\n]*physical/);
  assert.match(prompt, /registered shaderPreset/);
});

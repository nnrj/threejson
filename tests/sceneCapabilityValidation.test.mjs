import assert from "node:assert/strict";
import test from "node:test";

import {
  SceneCapabilityError,
  assertSceneCapabilities,
  collectSceneCapabilityDiagnostics
} from "../core/capabilities/sceneCapabilityValidation.js";

test("capability validation accepts stable WebGL records", () => {
  assert.equal(assertSceneCapabilities({
    sceneConfig: { renderer: { backend: "webgl" } },
    objectList: [
      { objType: "box", material: { type: "standard" } },
      { objType: "pass", passType: "outline" },
      { objType: "externalModel", modelFileType: "fbx" }
    ]
  }), true);
});

test("capability validation reports unavailable features with pointers", () => {
  const diagnostics = collectSceneCapabilityDiagnostics({
    sceneConfig: { renderer: { backend: "webgpu" } },
    objectList: [
      { objType: "box", material: { type: "tsl" } },
      { objType: "pass", passType: "unrealBloom" },
      { objType: "particleEmitter", source: { type: "textMask" }, simulation: { backend: "webgpu-compute" } }
    ]
  });
  assert.ok(diagnostics.some((entry) => entry.category === "rendererBackends" && entry.id === "webgpu"));
  assert.ok(diagnostics.some((entry) => entry.category === "materials" && entry.id === "tsl"));
  assert.ok(diagnostics.some((entry) => entry.category === "passes" && entry.id === "unrealBloom"));
  assert.equal(diagnostics.some((entry) => entry.category === "particleSources" && entry.id === "textMask"), false);
});

test("capability validation rejects the removed flat Particle V1 shape", () => {
  const diagnostics = collectSceneCapabilityDiagnostics({
    objectList: [{ objType: "particleEmitter", source: "box", simulation: "cpu", count: 100 }]
  });
  assert.ok(diagnostics.some((entry) => entry.category === "particleDescriptor" && entry.id === "source"));
  assert.ok(diagnostics.some((entry) => entry.category === "particleDescriptor" && entry.id === "simulation"));
  assert.ok(diagnostics.some((entry) => entry.category === "particleDescriptor" && entry.id === "v1-schema"));
});

test("WebGPU bloom is unavailable until the explicit WebGPU entry registers it", () => {
  const diagnostics = collectSceneCapabilityDiagnostics({
    sceneConfig: { renderer: { backend: "webgpu" } },
    objectList: [{ objType: "pass", passType: "bloom" }]
  });
  assert.ok(diagnostics.some((entry) => entry.category === "passes" && entry.id === "bloom"));
});

test("material presets in assetLibrary cannot hide an incompatible shader material", () => {
  const diagnostics = collectSceneCapabilityDiagnostics({
    sceneConfig: { renderer: { backend: "webgpu" } },
    assetLibrary: [{
      threeJsonId: "unsafe-webgpu-material",
      assetKind: "materialPreset",
      material: { type: "RawShaderMaterial" }
    }],
    objectList: [{ objType: "box", materialRef: "lib://unsafe-webgpu-material" }]
  });
  assert.ok(diagnostics.some((entry) => entry.category === "materials" && entry.id === "shader" && /assetLibrary/.test(entry.pointer)));
  const overridden = collectSceneCapabilityDiagnostics({
    sceneConfig: { renderer: { backend: "webgpu" } },
    objectList: [{ objType: "box", materialRef: "lib://base", materialOverrides: { type: "ShaderMaterial" } }]
  });
  assert.ok(overridden.some((entry) => entry.category === "materials" && entry.id === "shader"));
});

test("capability validation throws one structured error instead of silent stubs", () => {
  assert.throws(
    () => assertSceneCapabilities({ objectList: [{ objType: "shaderSurface" }] }),
    (error) => {
      assert.ok(error instanceof SceneCapabilityError);
      assert.equal(error.code, "E_SCENE_CAPABILITY_UNAVAILABLE");
      assert.ok(error.diagnostics.some((entry) => /shaderPreset/.test(entry.reason)));
      return true;
    }
  );
});

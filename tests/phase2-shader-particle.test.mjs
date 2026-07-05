import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clearAssetRegistry,
  registerAssetLibrary,
  resolveLibTokenToShaderSource
} from "../core/cache/assetRegistry.js";
import { resolveParticleTextureSize } from "../core/builder/particle/particleComputeUtil.js";

test("assetRegistry resolves shaderSource from assetLibrary", () => {
  clearAssetRegistry();
  registerAssetLibrary([
    {
      threeJsonId: "shader-vs",
      assetKind: "shaderSource",
      source: "void main(){gl_Position=vec4(position,1.0);}"
    }
  ]);
  const resolved = resolveLibTokenToShaderSource("shader-vs");
  assert.equal(typeof resolved?.source, "string");
  assert.equal(resolved?.assetKind, "shaderSource");
  clearAssetRegistry();
});

test("assetRegistry stores shaderSource url entries", () => {
  clearAssetRegistry();
  registerAssetLibrary([
    {
      threeJsonId: "shader-fs-url",
      assetKind: "shaderSource",
      url: "/assets/shaders/water.frag.glsl"
    }
  ]);
  const resolved = resolveLibTokenToShaderSource("shader-fs-url");
  assert.equal(resolved?.url, "/assets/shaders/water.frag.glsl");
  assert.equal(resolved?.assetKind, "shaderSource");
  clearAssetRegistry();
});

test("resolveParticleTextureSize picks power-of-two side from count", () => {
  assert.deepEqual(resolveParticleTextureSize(1000), { width: 32, height: 32 });
  assert.deepEqual(resolveParticleTextureSize(5000), { width: 128, height: 128 });
  assert.deepEqual(resolveParticleTextureSize(500, { textureSize: 64 }), { width: 64, height: 64 });
  assert.deepEqual(resolveParticleTextureSize(500, { textureWidth: 40, textureHeight: 30 }), {
    width: 40,
    height: 30
  });
});


import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveDracoDecoderPath,
  deriveThreeExamplesVersion,
  resolveGltfLoaderConfig
} from "../core/builder/gltfLoaderConfig.js";

test("Draco fallback follows the active Three.js revision instead of a frozen CDN version", () => {
  assert.equal(deriveThreeExamplesVersion("184"), "0.184.0");
  assert.equal(
    deriveDracoDecoderPath("179"),
    "https://cdn.jsdelivr.net/npm/three@0.179.0/examples/jsm/libs/draco/gltf/"
  );
});

test("host and model can configure optional GLTF decoders", () => {
  const config = resolveGltfLoaderConfig({
    decoderPaths: { draco: "https://assets.example/draco/" },
    gltf: { ktx2: { enabled: true, transcoderPath: "https://assets.example/basis/" } }
  }, { gltf: { meshopt: false } });
  assert.equal(config.draco.decoderPath, "https://assets.example/draco/");
  assert.equal(config.meshopt.enabled, false);
  assert.equal(config.ktx2.enabled, true);
  assert.equal(config.ktx2.transcoderPath, "https://assets.example/basis/");
});

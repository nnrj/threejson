import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  applyRendererDescriptor,
  buildWebGLRendererConstructorOptions,
  resolveRendererOutputColorSpace,
  resolveRendererShadowMapType,
  resolveRendererToneMapping
} from "../core/handler/rendererConfig.js";
import {
  extractControlsConfigFromRuntime,
  extractRendererConfigFromRuntime
} from "../core/util/sceneRuntimeConfigExport.js";

test("renderer enums accept stable JSON names", () => {
  assert.equal(resolveRendererToneMapping("ACES"), THREE.ACESFilmicToneMapping);
  assert.equal(resolveRendererToneMapping("agx"), THREE.AgXToneMapping);
  assert.equal(resolveRendererOutputColorSpace("srgb-linear"), THREE.LinearSRGBColorSpace);
  assert.equal(resolveRendererShadowMapType("pcf-soft"), THREE.PCFSoftShadowMap);
});

test("WebGL constructor options preserve Three.js defaults for omitted fields", () => {
  const canvas = {};
  const options = buildWebGLRendererConstructorOptions(canvas, {
    powerPreference: "high-performance",
    logarithmicDepthBuffer: true,
    reversedDepthBuffer: true
  });
  assert.deepEqual(options, {
    canvas,
    antialias: true,
    powerPreference: "high-performance",
    logarithmicDepthBuffer: true,
    reversedDepthBuffer: true
  });
  assert.equal("alpha" in options, false);
});

test("renderer descriptor applies color, tone, shadow and exposure settings", () => {
  const renderer = {
    outputColorSpace: null,
    toneMapping: null,
    toneMappingExposure: 1,
    shadowMap: { enabled: false, type: THREE.BasicShadowMap },
    sortObjects: true,
    autoClear: true,
    localClippingEnabled: false
  };
  applyRendererDescriptor(renderer, {
    outputColorSpace: "linear",
    toneMapping: "neutral",
    exposure: 1.5,
    shadowMap: { enabled: true, type: "vsm" },
    sortObjects: false,
    localClippingEnabled: true
  });
  assert.equal(renderer.outputColorSpace, THREE.LinearSRGBColorSpace);
  assert.equal(renderer.toneMapping, THREE.NeutralToneMapping);
  assert.equal(renderer.toneMappingExposure, 1.5);
  assert.deepEqual(renderer.shadowMap, { enabled: true, type: THREE.VSMShadowMap });
  assert.equal(renderer.sortObjects, false);
  assert.equal(renderer.localClippingEnabled, true);
  const roundTrip = extractRendererConfigFromRuntime({ renderer });
  assert.equal(roundTrip.toneMapping, THREE.NeutralToneMapping);
  assert.equal(roundTrip.shadowMap.enabled, true);
  assert.equal(roundTrip.localClippingEnabled, true);
});

test("controls runtime export preserves the selected controls type and options", () => {
  const controls = {
    threeJsonControlsKind: "map",
    threeJsonControlsConfig: { type: "map", enableDamping: true, maxDistance: 80 },
    target: new THREE.Vector3(1, 2, 3)
  };
  assert.deepEqual(extractControlsConfigFromRuntime({ controls }), {
    type: "map",
    enableDamping: true,
    maxDistance: 80,
    target: { x: 1, y: 2, z: 3 }
  });
});

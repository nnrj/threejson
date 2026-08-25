import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createJsonScene, deployJsonScene } from "../core/handler/sceneLoadHandler.js";

test("WebGPU preview registers only through its explicit entry", async () => {
  const webgpu = await import("../webgpu/index.js");
  const {
    detectRendererBackend,
    getRendererBackend,
    rendererBackendOwnsPostProcessing,
    resolveRendererBackendFallback
  } = await import("../core/handler/rendererBackendRegistry.js");
  const { getSceneCapability } = await import("../core/capabilities/sceneCapabilityManifest.js");
  assert.equal(webgpu.THREEJSON_WEBGPU_SUPPORTED_REVISION, "184");
  assert.equal(typeof getRendererBackend("webgpu")?.createRenderer, "function");
  assert.equal(detectRendererBackend({ isWebGPURenderer: true }), "webgpu");
  assert.equal(rendererBackendOwnsPostProcessing("webgpu"), true);
  assert.equal(resolveRendererBackendFallback("webgpu", { policy: "fallback-webgl" }), "webgl");
  assert.equal(resolveRendererBackendFallback("webgpu", { policy: "error" }), null);
  assert.equal(getSceneCapability("rendererBackends", "webgpu").status, "preview");
  assert.equal(getSceneCapability("materials", "tsl").status, "preview");
});

test("canonical renderer records participate in pre-deploy compatibility validation", async () => {
  await assert.rejects(
    createJsonScene({
      objectList: [
        { objType: "renderer", backend: "webgpu" },
        { objType: "pass", passType: "unrealBloom" }
      ]
    }),
    (error) => error?.code === "E_SCENE_CAPABILITY_UNAVAILABLE"
  );
});

test("deploying into an existing runtime validates the actual renderer backend", async () => {
  await assert.rejects(
    deployJsonScene({
      scene: new THREE.Scene(),
      renderer: { isWebGPURenderer: true, __threeJsonBackend: "webgpu" }
    }, {
      sceneConfig: { renderer: { backend: "webgl" } },
      objectList: [{ objType: "pass", passType: "unrealBloom" }]
    }),
    (error) => error?.code === "E_SCENE_CAPABILITY_UNAVAILABLE"
  );
});

test("TSL graph compiles safe serializable nodes and rejects cycles", async () => {
  const { compileTslGraph, prepareTslGraphsForPayload, TslGraphError } = await import("../webgpu/index.js");
  const graph = {
    graphVersion: 1,
    nodes: [
      { id: "uv", type: "uv" },
      { id: "y", type: "swizzle", input: "uv", components: "y" },
      { id: "a", type: "color", value: "#0044ff" },
      { id: "b", type: "color", value: "#ff8800" },
      { id: "gradient", type: "mix", a: "a", b: "b", factor: "y" }
    ],
    outputs: { color: "gradient" }
  };
  assert.equal(compileTslGraph(graph).color.isNode, true);
  assert.throws(() => compileTslGraph({
    graphVersion: 1,
    nodes: [{ id: "a", type: "sin", input: "b" }, { id: "b", type: "cos", input: "a" }],
    outputs: { color: "a" }
  }), (error) => error instanceof TslGraphError && error.code === "E_TSL_GRAPH_CYCLE");
  assert.throws(() => compileTslGraph({
    graphVersion: 1,
    nodes: [{ id: "a", type: "sin", input: "missing" }],
    outputs: { color: "a" }
  }), (error) => error instanceof TslGraphError && error.code === "E_TSL_GRAPH_UNKNOWN_REFERENCE");
  assert.throws(() => compileTslGraph({
    graphVersion: 1,
    nodes: [{ id: "uv", type: "uv" }, { id: "bad", type: "swizzle", input: "uv", components: "constructor" }],
    outputs: { color: "bad" }
  }), (error) => error instanceof TslGraphError && error.code === "E_TSL_GRAPH_SWIZZLE_INVALID");
  await assert.rejects(
    prepareTslGraphsForPayload({
      objectList: [{
        objType: "box",
        materials: [{
          type: "tsl",
          tsl: {
            kind: "graph",
            graphVersion: 1,
            nodes: [{ id: "bad", type: "sin", input: "missing" }],
            outputs: { color: "bad" }
          }
        }]
      }]
    }),
    (error) => error instanceof TslGraphError && error.code === "E_TSL_GRAPH_UNKNOWN_REFERENCE"
  );
});

test("TSL preset material is a NodeMaterial without raw code evaluation", async () => {
  const { createTslMaterialFromDescriptor } = await import("../webgpu/index.js");
  const material = createTslMaterialFromDescriptor({
    type: "tsl",
    base: "standard",
    roughness: 0.7,
    tsl: { kind: "preset", preset: "uv-gradient", params: { colorA: "#000000", colorB: "#ffffff" } }
  });
  assert.equal(material.isNodeMaterial, true);
  assert.equal(material.roughness, 0.7);
  assert.equal(material.colorNode.isNode, true);
  material.dispose();
});

test("TSL physical bases preserve advanced PhysicalMaterial fields", async () => {
  const { createTslMaterialFromDescriptor } = await import("../webgpu/index.js");
  const material = createTslMaterialFromDescriptor({
    type: "tsl",
    base: "physical",
    clearcoat: 0.7,
    transmission: 0.6,
    attenuationColor: "#ffeecc",
    attenuationDistance: 12,
    anisotropy: 0.4,
    dispersion: 0.1,
    specularIntensity: 0.8,
    iridescenceThicknessRange: [120, 380],
    tsl: { kind: "preset", preset: "solid", params: { color: "#ffffff" } }
  });
  assert.equal(material.isMeshPhysicalNodeMaterial, true);
  assert.equal(material.clearcoat, 0.7);
  assert.equal(material.transmission, 0.6);
  assert.equal(material.attenuationDistance, 12);
  assert.equal(material.anisotropy, 0.4);
  assert.equal(material.dispersion, 0.1);
  assert.deepEqual(material.iridescenceThicknessRange, [120, 380]);
  material.dispose();
});

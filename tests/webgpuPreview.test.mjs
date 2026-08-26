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
  assert.equal(webgpu.THREEJSON_WEBGPU_TESTED_REVISION, "184");
  assert.equal(webgpu.checkWebgpuRevisionCompatibility({ actualRevision: "184" }).compatible, true);
  assert.throws(
    () => webgpu.checkWebgpuRevisionCompatibility({ actualRevision: "999", policy: "strict" }),
    (error) => error?.code === "E_WEBGPU_THREE_REVISION_UNSUPPORTED"
  );
  assert.equal(typeof getRendererBackend("webgpu")?.createRenderer, "function");
  assert.equal(detectRendererBackend({ isWebGPURenderer: true }), "webgpu");
  assert.equal(rendererBackendOwnsPostProcessing("webgpu"), true);
  assert.equal(resolveRendererBackendFallback("webgpu", { policy: "fallback-webgl" }), "webgl");
  assert.equal(resolveRendererBackendFallback("webgpu", { policy: "error" }), null);
  const backendCapability = getSceneCapability("rendererBackends", "webgpu");
  assert.equal(backendCapability.status, "preview");
  assert.equal(backendCapability.testedRevision, "184");
  assert.equal(backendCapability.revisionPolicy, "best-effort");
  assert.equal(getSceneCapability("materials", "tsl").status, "preview");
  assert.deepEqual(getSceneCapability("materials", "tsl").modes, ["preset", "graph"]);
  const { collectSceneCapabilityDiagnostics } = await import("../core/capabilities/sceneCapabilityValidation.js");
  const codeDiagnostics = collectSceneCapabilityDiagnostics({
    sceneConfig: { renderer: { backend: "webgpu" } },
    objectList: [{
      objType: "box",
      material: { type: "tsl", tsl: { kind: "code", source: { inline: "export default () => ({})" } } }
    }]
  }, { rendererBackend: "webgpu" });
  assert.ok(codeDiagnostics.some((entry) => entry.category === "materialModes" && entry.id === "tsl.code"));
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

test("TSL graph exposes fractal noise, generic three/tsl calls and host node registration", async () => {
  const {
    compileTslGraph,
    registerTslGraphNode,
    unregisterTslGraphNode,
    TslGraphError
  } = await import("../webgpu/index.js");
  const graph = {
    graphVersion: 1,
    nodes: [
      { id: "p", type: "position", space: "local" },
      { id: "fractal", type: "fractalNoise", input: "p" },
      { id: "clamped", type: "call", function: "clamp", inputs: ["fractal", 0, 1] }
    ],
    outputs: { opacityNode: "clamped" }
  };
  assert.equal(compileTslGraph(graph).opacityNode.isNode, true);
  assert.throws(
    () => compileTslGraph({
      graphVersion: 1,
      nodes: [{ id: "bad", type: "call", function: "not_a_tsl_export", inputs: [] }],
      outputs: { color: "bad" }
    }),
    (error) => error instanceof TslGraphError && error.code === "E_TSL_GRAPH_CALL_UNAVAILABLE"
  );
  registerTslGraphNode("double", ({ node, resolveInput }) => resolveInput(node.input).mul(2));
  assert.equal(compileTslGraph({
    graphVersion: 1,
    nodes: [{ id: "one", type: "constant", value: 1 }, { id: "two", type: "double", input: "one" }],
    outputs: { opacity: "two" }
  }).opacity.isNode, true);
  unregisterTslGraphNode("double");
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

test("TSL graph material provides animated fractal color and opacity nodes", async () => {
  const { createTslMaterialFromDescriptor } = await import("../webgpu/index.js");
  const material = createTslMaterialFromDescriptor({
    type: "tsl",
    base: "standard",
    transparent: true,
    side: "double",
    tsl: {
      kind: "graph",
      source: {
        inline: {
          graphVersion: 1,
          nodes: [
            { id: "position", type: "position", space: "local" },
            { id: "noise", type: "fractalNoise", input: "position" },
            { id: "opacity", type: "smoothstep", input: "noise", edge0: 0.44, edge1: 0.5 },
            { id: "hot", type: "color", value: "#ff3300" },
            { id: "surface", type: "color", value: "#cccccc" },
            { id: "color", type: "mix", a: "hot", b: "surface", factor: "opacity" }
          ],
          outputs: { color: "color", opacity: "opacity" }
        }
      }
    }
  });
  assert.equal(material.isMeshStandardNodeMaterial, true);
  assert.equal(material.colorNode.isNode, true);
  assert.equal(material.opacityNode.isNode, true);
  assert.equal(material.transparent, true);
  assert.equal(material.side, THREE.DoubleSide);
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

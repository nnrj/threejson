import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { prepareTslGraphsForPayload, compileTslGraph } from "../webgpu/tslGraph.js";
import { createTslMaterialFromDescriptor } from "../webgpu/tslMaterial.js";
import { createRuntimeContext, attachRuntimeContext, runWithRuntimeContextScope } from "../core/runtime/runtimeContext.js";
import { registerSceneCapabilityPreparer, unregisterSceneCapabilityPreparer, runSceneCapabilityPreparers } from "../core/capabilities/scenePreparationRegistry.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));
const graph = (url = "map.png") => ({ graphVersion: 1, nodes: [{ id: "image", type: "texture", url, repeat: [2, 3] }], outputs: { color: "image" } });
const descriptor = { type: "tsl", tsl: { kind: "graph", source: { url: "/assets/graphs/material.json" } } };
const scene = (material = descriptor) => ({ objectList: [{ objType: "box", material }] });
function loader() {
  const calls = [];
  return { calls, load(url, ready, _progress, fail) {
    const texture = new THREE.Texture(); let disposed = 0;
    texture.addEventListener("dispose", () => disposed++);
    calls.push({ url, texture, get disposed() { return disposed; }, fail, ready() { texture.image = { width: 8, height: 8 }; ready(texture); } });
    return texture;
  } };
}
test("same graph paths resolve against their owning load and wait for decoded images", async (t) => {
  const a = loader(), b = loader(), fetched = [];
  const fetchGraph = async (url) => { fetched.push(url); return Response.json(graph()); };
  let exposed = false;
  const pa = prepareTslGraphsForPayload(scene(), { assetsBase: "https://a.test/assets", assetsBaseMode: "base-only", fetch: fetchGraph, textureLoader: a }).then((value) => { exposed = true; return value; });
  const pb = prepareTslGraphsForPayload(scene(), { assetsBase: "https://b.test/assets", assetsBaseMode: "base-only", fetch: fetchGraph, textureLoader: b });
  await tick();
  assert.deepEqual(fetched.sort(), ["https://a.test/assets/graphs/material.json", "https://b.test/assets/graphs/material.json"]);
  assert.equal(exposed, false);
  assert.equal(a.calls[0].url, "https://a.test/assets/graphs/map.png");
  assert.equal(b.calls[0].url, "https://b.test/assets/graphs/map.png");
  a.calls[0].ready(); b.calls[0].ready();
  const [ra, rb] = await Promise.all([pa, pb]); t.after(() => { ra.dispose(); rb.dispose(); });
  const ma = createTslMaterialFromDescriptor(descriptor, { graphResources: ra });
  const mb = createTslMaterialFromDescriptor(descriptor, { graphResources: rb });
  assert.equal(ma.colorNode.value.image, a.calls[0].texture.image);
  assert.equal(mb.colorNode.value.image, b.calls[0].texture.image);
  const ma2 = createTslMaterialFromDescriptor(descriptor, { graphResources: ra });
  assert.notEqual(ma2.colorNode.value, ma.colorNode.value);
  assert.deepEqual(ma.colorNode.value.repeat.toArray(), [2, 3]);
  ma2.colorNode.value.repeat.set(9, 9);
  assert.deepEqual(ma.colorNode.value.repeat.toArray(), [2, 3]);
  ma.dispose(); ma2.dispose(); ra.dispose();
  assert.equal(a.calls[0].disposed, 1);
  assert.equal(b.calls[0].disposed, 0);
  mb.dispose();
});

test("a failed/cancelled graph releases siblings and late image results", async () => {
  const images = loader(), controller = new AbortController();
  const pending = prepareTslGraphsForPayload(scene(), { fetch: async () => Response.json(graph()), textureLoader: images, signal: controller.signal });
  await tick(); controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  images.calls[0].ready(); await tick();
  assert.equal(images.calls[0].disposed, 1);
});

test("optional preparation failure releases completed resources without touching another load", async () => {
  let disposed = 0;
  registerSceneCapabilityPreparer("fixture-owned", async () => ({ dispose: () => disposed++ }));
  const good = await runSceneCapabilityPreparers({ objectList: [] });
  registerSceneCapabilityPreparer("fixture-failure", async () => { throw new Error("bad optional resource"); });
  try {
    await assert.rejects(runSceneCapabilityPreparers({ objectList: [] }), /bad optional resource/);
    assert.equal(disposed, 1);
    good.dispose(); good.dispose(); assert.equal(disposed, 2);
  } finally { unregisterSceneCapabilityPreparer("fixture-owned"); unregisterSceneCapabilityPreparer("fixture-failure"); }
});

test("builders resolve scoped prepared data, never the most recently attached scene", async (t) => {
  const first = createRuntimeContext(), second = createRuntimeContext();
  t.after(() => { first.dispose(); second.dispose(); });
  const prepare = (color) => prepareTslGraphsForPayload(scene(), { fetch: async () => Response.json({ graphVersion: 1, nodes: [{ id: "color", type: "color", value: color }], outputs: { color: "color" } }) });
  first.capabilityResources.add("webgpu-tsl-graphs", await prepare("#ff0000"));
  second.capabilityResources.add("webgpu-tsl-graphs", await prepare("#0000ff"));
  attachRuntimeContext(new THREE.Scene(), first); attachRuntimeContext(new THREE.Scene(), second);
  const material = runWithRuntimeContextScope(first, () => createTslMaterialFromDescriptor(descriptor));
  assert.equal(material.colorNode.node.value.getHexString(), "ff0000");
  assert.throws(() => createTslMaterialFromDescriptor(descriptor), /graphVersion/);
  material.dispose();
});

test("embedded graphs and their relative images survive offline document reload", async () => {
  const json = `data:application/json,${encodeURIComponent(JSON.stringify(graph("./map.png")))}`;
  const material = { type: "tsl", tsl: { kind: "graph", source: { url: "pack://archive/graphs/material.json" } } };
  const payload = { ...scene(material), assetLibrary: [
    { assetKind: "file", archivePath: "archive/graphs/material.json", url: json },
    { assetKind: "file", archivePath: "archive/graphs/map.png", url: "data:image/png;base64,dGVzdA==" }
  ] };
  const images = loader();
  const ready = prepareTslGraphsForPayload(JSON.parse(JSON.stringify(payload)), { textureLoader: images });
  await tick(); assert.equal(images.calls[0].url, "data:image/png;base64,dGVzdA==");
  images.calls[0].ready(); const resources = await ready;
  const result = createTslMaterialFromDescriptor(material, { graphResources: resources });
  assert.equal(result.colorNode.value.image.width, 8);
  result.dispose(); resources.dispose();
});

test("large valid node graphs have no artificial 256-node ceiling", () => {
  const nodes = Array.from({ length: 300 }, (_, i) => ({ id: `n${i}`, type: "constant", value: i }));
  assert.equal(compileTslGraph({ graphVersion: 1, nodes, outputs: { roughness: "n299" } }).roughness.node.value, 299);
});

test("ordinary scenes do not fetch when optional graph preparation is registered", async () => {
  assert.equal(await prepareTslGraphsForPayload({ objectList: [{ objType: "box" }] }, { fetch() { throw new Error("unexpected fetch"); } }), undefined);
});

test("relative texture paths resolve beside a relative graph, not beside the host page", async () => {
  const images = loader(), requested = [];
  const material = { type: "tsl", tsl: { kind: "graph", source: { url: "./models/paint.json" } } };
  const pending = prepareTslGraphsForPayload(scene(material), {
    resourceBaseUrl: "https://host.test/viewer/index.html", textureLoader: images,
    fetch: async (url) => { requested.push(url); return Response.json(graph("./paint.png")); }
  });
  await tick();
  assert.deepEqual(requested, ["https://host.test/viewer/models/paint.json"]);
  assert.equal(images.calls[0].url, "https://host.test/viewer/models/paint.png");
  images.calls[0].ready(); (await pending).dispose();
});

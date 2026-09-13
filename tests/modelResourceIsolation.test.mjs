import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { createRuntimeContext, attachRuntimeContext } from "../core/runtime/runtimeContext.js";
import { configureSceneResourcePolicy } from "../core/resource/sceneResourcePolicy.js";
import { createModelLoadScope, discardUndecodedModelTextures, withModelLoadScope } from "../core/resource/modelLoadScope.js";
import { loadExternalModelAsync } from "../core/builder/modelBuilder.js";
import { getObjectByThreeJsonId } from "../core/handler/objectRegistry.js";
import { applyAssetGatewayToPayload } from "../core/util/assetGateway.js";

function sceneWithPolicy(base) {
  const scene = new THREE.Scene(), context = createRuntimeContext();
  attachRuntimeContext(scene, context);
  configureSceneResourcePolicy(context, {}, { assetsBase: base, assetGateway: { baseUrl: "https://proxy.example" } });
  return { scene, context };
}

test("model paths retain authority; child resources resolve at the per-scene request boundary", async () => {
  const a = sceneWithPolicy("https://a.example/assets/"), b = sceneWithPolicy("https://b.example/assets/");
  const first = createModelLoadScope(a.scene), second = createModelLoadScope(b.scene);
  assert.equal(first.resolvePath("/assets/chair/model.gltf"), "https://a.example/assets/chair/model.gltf");
  assert.equal(second.resolvePath("/assets/chair/model.gltf"), "https://b.example/assets/chair/model.gltf");
  const image = first.resolvePath("../wood.png", first.resolvePath("/assets/chair/model.gltf"));
  const request = new URL(first.manager.resolveURL(image));
  assert.equal(request.searchParams.get("url"), "https://a.example/assets/wood.png");
  assert.equal(request.searchParams.get("kind"), "image");
  const payload = { objectList: [{ objType: "externalModel", modelPath: "https://a.example/model.gltf", metadata: { url: "https://author.example" } }] };
  const original = structuredClone(payload);
  applyAssetGatewayToPayload(payload, { baseUrl: "https://proxy.example" }, { deferModels: true, deferTextures: true });
  assert.deepEqual(payload, original);
  first.close(); second.close(); a.context.dispose(); b.context.dispose();
});

test("real concurrent GLTF loads keep relative buffers and object registration in their own scenes", async (t) => {
  const previousFetch = globalThis.fetch, previousProgress = globalThis.ProgressEvent;
  globalThis.ProgressEvent ||= class { constructor(type, data) { this.type = type; Object.assign(this, data); } };
  const requests = [];
  globalThis.fetch = async (request) => {
    const proxyUrl = new URL(request.url || request);
    const url = proxyUrl.searchParams.get("url") || proxyUrl.href;
    requests.push(url);
    if (url.endsWith(".bin")) return new Response(new Float32Array([0,0,0, 1,0,0, 0,1,0]).buffer);
    if (url.includes("a.example")) await new Promise((resolve) => setTimeout(resolve, 10));
    return Response.json({ asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
      buffers: [{ uri: "geometry.bin", byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0,0,0], max: [1,1,0] }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }] });
  };
  const a = sceneWithPolicy("https://a.example/assets/"), b = sceneWithPolicy("https://b.example/assets/");
  t.after(() => { globalThis.fetch = previousFetch; globalThis.ProgressEvent = previousProgress; a.context.dispose(); b.context.dispose(); });
  const descriptor = (id) => ({ objType: "externalModel", threeJsonId: id, modelFileType: "gltf", modelPath: "/assets/chair/model.gltf", gltf: { draco: false, meshopt: false } });
  const [modelA, modelB] = await Promise.all([loadExternalModelAsync(descriptor("a"), a.scene), loadExternalModelAsync(descriptor("b"), b.scene)]);
  assert.equal(modelA.parent, a.scene); assert.equal(modelB.parent, b.scene);
  assert.equal(getObjectByThreeJsonId("a", a.scene), modelA);
  assert.equal(getObjectByThreeJsonId("b", b.scene), modelB);
  assert.ok(!getObjectByThreeJsonId("b", a.scene));
  assert.ok(requests.includes("https://a.example/assets/chair/geometry.bin"));
  assert.ok(requests.includes("https://b.example/assets/chair/geometry.bin"));
});

test("cancelled non-abortable model completion is disposed, never attached or leaked", async () => {
  const { scene, context } = sceneWithPolicy("https://a.example/");
  let complete;
  const delayed = new Promise((resolve) => { complete = resolve; });
  const model = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  let disposed = 0;
  model.geometry.addEventListener("dispose", () => disposed++);
  const loading = withModelLoadScope(scene, {}, undefined, async (scope) => {
    const result = scope.own(await delayed);
    scope.check(); scene.add(result); return scope.release(result);
  });
  await Promise.resolve(); context.dispose();
  await assert.rejects(loading, { name: "AbortError" });
  complete(model);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scene.children.length, 0); assert.equal(disposed, 1);
});

test("failed imported image maps are removed without changing base color or decoded PBR maps", () => {
  const good = new THREE.DataTexture(new Uint8Array([255,255,255,255]), 1, 1);
  const material = new THREE.MeshStandardMaterial({ color: "#d83222", map: new THREE.Texture(), roughnessMap: good });
  const object = new THREE.Mesh(new THREE.BoxGeometry(), material);
  assert.equal(discardUndecodedModelTextures(object), 1);
  assert.equal(material.map, null); assert.equal(material.roughnessMap, good);
  assert.equal(material.color.getHexString(), "d83222");
  object.geometry.dispose(); material.dispose(); good.dispose();
});

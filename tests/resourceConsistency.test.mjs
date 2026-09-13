import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createAssetResolver } from "../core/resource/assetResolver.js";
import { createRuntimeContext, attachRuntimeContext } from "../core/runtime/runtimeContext.js";
import { applyMaterialTextureSetFromJson, whenTextureReady } from "../core/util/loadTextureFromMaterialJson.js";
import { registerObject } from "../core/handler/objectRegistry.js";
import { getObjectByThreeJsonId } from "../core/handler/objectRegistry.js";
import { createJsonScene, createJsonSceneSimple } from "../core/handler/sceneLoadHandler.js";
import { sceneToStandardJsonSimple } from "../core/util/sceneToJson.js";
import { applyTextureAssignmentAsync, runSceneTexturePipeline, TextureAcquisitionProvider } from "../core/texture/index.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));
function controlledLoader() {
  const calls = [];
  return { calls, load(url, ready, _progress, fail) {
    const texture = new THREE.Texture();
    calls.push({ url, texture, fail, ready() { texture.image = { width: 4, height: 4 }; ready(texture); } });
    return texture;
  } };
}

test("failed initial textures never replace base material, and a later request retries", async () => {
  const runtimeScope = createRuntimeContext();
  const loader = controlledLoader();
  const material = new THREE.MeshStandardMaterial({ color: "#336699" });
  const descriptor = { textureUrl: "https://test.invalid/map.png" };
  const first = applyMaterialTextureSetFromJson(material, descriptor, { loader, runtimeScope });
  assert.equal(material.map, null);
  await tick();
  loader.calls[0].fail(new Error("offline"));
  await assert.rejects(whenTextureReady(first.baseColor), /offline/);
  await tick();
  assert.equal(material.map, null);
  assert.equal(material.color.getHexString(), "336699");
  const second = applyMaterialTextureSetFromJson(material, descriptor, { loader, runtimeScope });
  await tick();
  assert.equal(loader.calls.length, 2);
  loader.calls[1].ready();
  await whenTextureReady(second.baseColor);
  await tick();
  assert.equal(material.map, second.baseColor);
  runtimeScope.dispose();
});

test("late texture results cannot replace a newer slot assignment", async () => {
  const runtimeScope = createRuntimeContext();
  const loader = controlledLoader();
  const material = new THREE.MeshStandardMaterial();
  const first = applyMaterialTextureSetFromJson(material, { textureUrl: "https://test.invalid/one" }, { loader, runtimeScope });
  const second = applyMaterialTextureSetFromJson(material, { textureUrl: "https://test.invalid/two" }, { loader, runtimeScope });
  await tick();
  loader.calls[1].ready();
  await whenTextureReady(second.baseColor);
  await tick();
  loader.calls[0].ready();
  await whenTextureReady(first.baseColor);
  await tick();
  assert.equal(material.map, second.baseColor);
  runtimeScope.dispose();
});

test("live resource leases deduplicate loading but never share mutable texture views", async () => {
  const runtimeScope = createRuntimeContext();
  const loader = controlledLoader();
  const a = new THREE.MeshStandardMaterial();
  const b = new THREE.MeshStandardMaterial();
  const first = applyMaterialTextureSetFromJson(a, { textureUrl: "https://test.invalid/shared", textureRepeat: { x: 2, y: 3 } }, { loader, runtimeScope });
  const second = applyMaterialTextureSetFromJson(b, { textureUrl: "https://test.invalid/shared", textureRepeat: { x: 4, y: 5 } }, { loader, runtimeScope });
  await tick();
  assert.equal(loader.calls.length, 1);
  loader.calls[0].ready();
  await Promise.all([whenTextureReady(first.baseColor), whenTextureReady(second.baseColor)]);
  assert.notEqual(first.baseColor, second.baseColor);
  assert.deepEqual(first.baseColor.repeat.toArray(), [2, 3]);
  assert.deepEqual(second.baseColor.repeat.toArray(), [4, 5]);
  let disposed = 0;
  loader.calls[0].texture.addEventListener("dispose", () => disposed++);
  first.baseColor.dispose();
  assert.equal(disposed, 0);
  second.baseColor.dispose();
  assert.equal(disposed, 1);
  runtimeScope.dispose();
});

test("releasing a pending resource cleans up a late success", async () => {
  let complete;
  let disposed = 0;
  const resolver = createAssetResolver();
  const lease = resolver.acquire({ source: "one" }, { load: () => new Promise((resolve) => { complete = resolve; }), dispose: () => disposed++ });
  await tick();
  lease.release();
  complete({});
  await assert.rejects(lease.promise);
  assert.equal(disposed, 1);
  assert.deepEqual(resolver.inspect(), []);
});

test("Physical shading and durable archive replicas survive the descriptor pipeline", async () => {
  const scene = { objectList: [{ objType: "box", threeJsonId: "one", material: { type: "physical", clearcoat: 1 } }] };
  const provider = new TextureAcquisitionProvider({
    capabilities: async () => ({ search: ["pbr-set"], persist: ["archive-selected"] }),
    search: async () => ({ candidates: [{ maps: { roughness: "https://origin.test/temporary" }, license: { id: "CC0" } }] }),
    persist: async ({ candidates }) => ({ candidates: candidates.map((candidate) => ({ ...candidate, archived: true, runtimeMaps: { roughness: "https://archive.test/sha.png" } })) })
  });
  await runSceneTexturePipeline(scene, { mutate: true, textureProvider: provider, plan: { tasks: [{
    id: "one", objectPointer: "/objectList/0", threeJsonId: "one", materialPointer: "/objectList/0/material", relativeMaterialPointer: "/material", slots: ["roughness"], query: "surface", sourcePreference: "search"
  }] } });
  assert.equal(scene.objectList[0].material.type, "physical");
  assert.equal(scene.objectList[0].material.clearcoat, 1);
  assert.deepEqual(scene.objectList[0].material.textureResources.roughness.replicas, ["https://archive.test/sha.png"]);
  assert.equal(scene.objectList[0].material.roughnessMap, "https://origin.test/temporary");
});

test("aborting one lease rejects promptly without cancelling another consumer", async () => {
  let complete;
  const resolver = createAssetResolver();
  const controller = new AbortController();
  const hooks = { load: () => new Promise((resolve) => { complete = resolve; }) };
  const first = resolver.acquire({ source: "shared" }, { ...hooks, signal: controller.signal });
  const second = resolver.acquire({ source: "shared" }, hooks);
  await tick();
  controller.abort();
  await assert.rejects(first.promise, { name: "AbortError" });
  assert.equal(second.state, "loading");
  complete("ready");
  assert.equal(await second.promise, "ready");
  second.release();
  resolver.dispose();
});

test("resolved resource leases release failed, unused and successful URLs exactly once", async () => {
  const released = [];
  const resolver = createAssetResolver();
  const lease = resolver.acquire({ source: "origin" }, {
    resolve: () => ["bad", "good", "unused"].map((url) => ({ url, release: () => released.push(url) })),
    load: async (url) => { if (url === "bad") throw new Error("offline"); return url; }
  });
  assert.equal(await lease.promise, "good");
  assert.deepEqual(released, ["bad", "unused"]);
  lease.release();
  lease.release();
  resolver.dispose();
  assert.deepEqual(released, ["bad", "unused", "good"]);
});

test("parallel PBR preload failure disposes textures that finish after the rejection", async () => {
  const scene = new THREE.Scene();
  attachRuntimeContext(scene, createRuntimeContext());
  const descriptor = { threeJsonId: "one", material: { type: "standard" } };
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  scene.add(mesh);
  registerObject(mesh, descriptor, { runtimeScope: scene });
  let finish;
  const texture = new THREE.Texture();
  let disposed = 0;
  texture.addEventListener("dispose", () => disposed++);
  await assert.rejects(applyTextureAssignmentAsync(scene, { threeJsonId: "one", maps: { baseColor: "fail", normal: "late" } }, {
    loadTexture: (url) => url === "fail" ? Promise.reject(new Error("failed")) : new Promise((resolve) => { finish = resolve; })
  }), /failed/);
  finish(texture);
  await tick();
  assert.equal(disposed, 1);
  assert.equal(mesh.material.map, null);
});

test("initial loading and reloading keep proxy credentials out of authoritative texture URLs", async () => {
  const originalLoad = THREE.TextureLoader.prototype.load;
  const loader = controlledLoader();
  THREE.TextureLoader.prototype.load = loader.load.bind(loader);
  const runtimes = [];
  try {
    const source = "https://origin.test/color.png";
    const payload = { objectList: [{ objType: "box", threeJsonId: "proxy-box", material: { type: "physical", color: "#336699", textureUrl: source } }] };
    const options = { assetGateway: { baseUrl: "https://proxy.test", apiKey: "private-test-key" } };
    const runtime = createJsonSceneSimple(payload, options);
    runtimes.push(runtime);
    await tick();
    assert.ok(loader.calls.length > 0);
    for (const call of loader.calls) {
      assert.equal(new URL(call.url).searchParams.get("url"), source);
      assert.equal(new URL(call.url).searchParams.get("kind"), "image");
      call.ready();
    }
    await tick();
    const record = getObjectByThreeJsonId("proxy-box", runtime.scene).userData.objJson;
    assert.equal(record.material.textureUrl, source);
    const saved = sceneToStandardJsonSimple(runtime.scene, { merge: false, runtimeTarget: runtime });
    assert.equal(saved.objectList[0].material.textureUrl, source);
    assert.ok(!JSON.stringify(saved).includes("private-test-key"));
    runtimes.push(createJsonSceneSimple(saved, options));
    await tick();
    for (const call of loader.calls) assert.equal(new URL(call.url).searchParams.get("url"), source);
    assert.equal(payload.objectList[0].material.textureUrl, source);
  } finally {
    runtimes.forEach((runtime) => runtime.dispose());
    THREE.TextureLoader.prototype.load = originalLoad;
  }
});

test("concurrent scenes retain distinct asset bases throughout scheduled loading", async () => {
  const originalLoad = THREE.TextureLoader.prototype.load;
  const loader = controlledLoader();
  THREE.TextureLoader.prototype.load = loader.load.bind(loader);
  const make = (suffix) => ({
    sceneConfig: { assetsBase: `https://${suffix}.test`, assetsBaseMode: "base-only" },
    objectList: [{ objType: "box", threeJsonId: "shared", material: { textureUrl: "/assets/surface.png" } }]
  });
  let runtimes = [];
  try {
    runtimes = await Promise.all([createJsonScene(make("first")), createJsonScene(make("second"))]);
    await tick();
    assert.deepEqual(new Set(loader.calls.map((call) => call.url)), new Set(["https://first.test/surface.png", "https://second.test/surface.png"]));
  } finally {
    runtimes.forEach((runtime) => runtime.dispose());
    THREE.TextureLoader.prototype.load = originalLoad;
  }
});

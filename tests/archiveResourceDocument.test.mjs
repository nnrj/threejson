import assert from "node:assert/strict";
import { test } from "node:test";
import { packTjzArchive } from "../core/archive/tjzPackager.js";
import { parseTjzArchiveForScene } from "../core/archive/tjzArchive.js";
import { createJsonScene, createJsonSceneFromArchive } from "../core/handler/sceneLoadHandler.js";
import { createEmbeddedResourceIndex, resolveEmbeddedResource, dataUrlToBytes } from "../core/resource/embeddedResources.js";
import { SceneSession } from "../core/document/sceneSession.js";
import { compileAuthoring, formatAuthoring } from "../core/document/authoringAdapters.js";
import { createSceneSessionRuntimeDriver } from "../core/runtime/sceneSessionDriver.js";
import { packPayloadToTjz } from "../core/util/archiveExportUtil.js";
import { resolveEventScriptSource } from "../core/runtime/eventMechanism/resolveEventScriptSource.js";

test("archive authoring keeps portable bytes and stable pack identity across JSON save, disposal and re-pack", async () => {
  const source = { objectList: [{ objType: "box", threeJsonId: "box", material: { color: "#ffaa00", textureUrl: "pack://assets/a.png" } }] };
  const bytes = new Uint8Array([1,2,3,4]);
  const parsed = await parseTjzArchiveForScene(await packTjzArchive(source, { assets: { "assets/a.png": bytes } }));
  const reference = parsed.payload.objectList[0].material.textureUrl;
  assert.match(reference, /^pack:\/\/_archive\/[a-f\d]{64}\/assets\/a\.png$/);
  assert.equal(parsed.objectUrlCount, 0); parsed.dispose();
  const saved = JSON.parse(JSON.stringify(parsed.payload));
  assert.ok(!JSON.stringify(saved).includes("blob:"));
  assert.deepEqual(dataUrlToBytes(resolveEmbeddedResource(createEmbeddedResourceIndex(saved), reference)), bytes);
  const again = await parseTjzArchiveForScene(await packTjzArchive(saved));
  assert.equal(again.payload.objectList[0].material.textureUrl, reference);
  assert.deepEqual(dataUrlToBytes(resolveEmbeddedResource(createEmbeddedResourceIndex(again.payload), reference)), bytes);
  assert.equal(again.payload.assetLibrary.length, saved.assetLibrary.length);
  const collected = await parseTjzArchiveForScene(await packPayloadToTjz(saved, { assetPolicy: "tryPack" }));
  assert.deepEqual(dataUrlToBytes(resolveEmbeddedResource(createEmbeddedResourceIndex(collected.payload), reference)), bytes);
});

test("two imported archives may contain the same filename without cross-object resource collisions", async () => {
  const make = async (value) => parseTjzArchiveForScene(await packTjzArchive({ objType: "box", material: { textureUrl: "pack://a.png" } }, { assets: { "a.png": new Uint8Array([value]) } }));
  const a = await make(1), b = await make(2), scene = { objectList: [a.payload, b.payload] };
  const index = createEmbeddedResourceIndex(scene);
  assert.notEqual(a.payload.material.textureUrl, b.payload.material.textureUrl);
  assert.equal(dataUrlToBytes(resolveEmbeddedResource(index, a.payload.material.textureUrl))[0], 1);
  assert.equal(dataUrlToBytes(resolveEmbeddedResource(index, b.payload.material.textureUrl))[0], 2);
});

test("binary BufferGeometry in an archive survives a full document rebuild and undo", async (t) => {
  const positions = new Float32Array([0,0,0, 2,0,0, 0,3,0]);
  const payload = { objectList: [{ objType: "bufferMesh", threeJsonId: "mesh", geometry: {
    buffers: { points: "pack://mesh/positions.bin" }, attributes: { position: { bufferRef: "points", itemSize: 3, type: "Float32Array" } }
  }, material: { type: "basic", color: "red" } }] };
  const archive = await packTjzArchive(payload, { assets: { "mesh/positions.bin": new Uint8Array(positions.buffer) } });
  const runtime = await createJsonSceneFromArchive(archive);
  const driver = createSceneSessionRuntimeDriver({ initialRuntime: runtime });
  const session = new SceneSession(compileAuthoring(runtime.normalizedPayload), { driver });
  t.after(() => session.dispose());
  const identity = runtime.scene.children.find((object) => object.isMesh);
  await session.dispatch({ operations: [{ op: "add", path: "/objectList/0/geometry/computeNormals", value: true }] });
  assert.equal(driver.runtime, runtime);
  assert.equal(runtime.scene.children.find((object) => object.isMesh), identity);
  assert.deepEqual([...identity.geometry.attributes.position.array], [...positions]);
  await session.dispatch({ operations: [{ op: "add", path: "/objectList/-", value: { objType: "box", threeJsonId: "extra" } }] });
  let mesh; driver.runtime.scene.traverse((object) => { if (object.userData?.objJson?.threeJsonId === "mesh") mesh = object; });
  assert.deepEqual([...mesh.geometry.attributes.position.array], [...positions]);
  await session.undo();
  const reloaded = await createJsonScene(JSON.parse(JSON.stringify(formatAuthoring(session.document))));
  t.after(() => reloaded.dispose());
  reloaded.scene.traverse((object) => { if (object.userData?.objJson?.threeJsonId === "mesh") mesh = object; });
  assert.deepEqual([...mesh.geometry.attributes.position.array], [...positions]);
});

test("real GLTF loader resolves archived relative buffers offline and reloads after runtime disposal", async (t) => {
  const progress = globalThis.ProgressEvent;
  globalThis.ProgressEvent ||= class { constructor(type, data) { this.type = type; Object.assign(this, data); } };
  t.after(() => { globalThis.ProgressEvent = progress; });
  const gltf = { asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    buffers: [{ uri: "geometry.bin", byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0,0,0], max: [1,1,0] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }] };
  const archive = await packTjzArchive({ objectList: [{ objType: "externalModel", threeJsonId: "model", modelFileType: "gltf", modelPath: "pack://model/model.gltf", gltf: { draco: false, meshopt: false } }] }, {
    assets: { "model/model.gltf": JSON.stringify(gltf), "model/geometry.bin": new Float32Array([0,0,0, 1,0,0, 0,1,0]).buffer }
  });
  const runtime = await createJsonSceneFromArchive(archive);
  const saved = JSON.parse(JSON.stringify(runtime.normalizedPayload)); runtime.dispose();
  const reloaded = await createJsonScene(saved); t.after(() => reloaded.dispose());
  const meshes = []; reloaded.scene.traverse((object) => { if (object.isMesh) meshes.push(object); });
  assert.equal(meshes.length, 1); assert.equal(meshes[0].geometry.attributes.position.count, 3);
});

test("archive packaging respects custom entry paths and rejects asset overwrite of scene/manifest", async () => {
  const bytes = await packTjzArchive({ objectList: [] }, { manifest: { entry: "nested/main.json" } });
  const parsed = await parseTjzArchiveForScene(bytes);
  assert.equal(parsed.entryPath, "nested/main.json");
  await assert.rejects(packTjzArchive({ objectList: [] }, { assets: { "scene.json": "malformed" } }), /reserved asset path/);
});

test("archived event scripts resolve within their owning runtime and survive independent scene loads", async (t) => {
  const make = async (text) => createJsonSceneFromArchive(await packTjzArchive({ objectList: [{ objType: "box", threeJsonId: "box" }],
    metadata: { author: "local" } }, { assets: { "events/action.js": text } }));
  const first = await make("return 1;"), second = await make("return 2;");
  t.after(() => { first.dispose(); second.dispose(); });
  assert.equal(first.normalizedPayload.metadata.author, "local");
  for (const [runtime, expected] of [[first, "return 1;"], [second, "return 2;"]]) {
    const file = runtime.normalizedPayload.assetLibrary.find((entry) => entry.archivePath.endsWith("/events/action.js"));
    const resolved = await resolveEventScriptSource({ script: `pack://${file.archivePath}` }, { runtimeScope: runtime.scene });
    assert.equal(resolved.source, expected);
  }
});

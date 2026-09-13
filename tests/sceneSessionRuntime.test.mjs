import test from "node:test";
import assert from "node:assert/strict";
import { createRuntimeSceneSession, captureSceneSession } from "../core/session.js";
import { createJsonScene } from "../core/handler/sceneLoadHandler.js";
import { getObjectByThreeJsonId } from "../core/handler/objectRegistry.js";
import * as THREE from "three";
import { executeSceneSessionCommands } from "../core/session.js";

const source = () => ({ sceneConfig: { lights: [] }, objectList: [{ objType: "box", threeJsonId: "one", position: { x: 0, y: 0, z: 0 }, material: { color: "#336699" } }] });

test("session transforms preserve runtime, mesh, geometry, material and camera identity", async () => {
  let creates = 0;
  const session = await createRuntimeSceneSession(source(), { createRuntime: (...args) => { creates++; return createJsonScene(...args); } });
  try {
    const runtime = session.runtime;
    const object = getObjectByThreeJsonId("one", runtime.scene);
    const geometry = object.geometry, material = object.material, camera = runtime.camera;
    const snapshot = session.snapshot();
    await session.dispatch({ baseRevision: 0, operations: [{ op: "object.patch", id: "one", patch: { position: { x: 12 }, rotation: { y: 0.4 } } }] });
    assert.equal(creates, 1);
    assert.equal(session.runtime, runtime);
    assert.equal(getObjectByThreeJsonId("one", runtime.scene), object);
    assert.equal(object.geometry, geometry); assert.equal(object.material, material); assert.equal(runtime.camera, camera);
    assert.equal(object.position.x, 12);
    assert.equal(snapshot.root.objectList[0].position.x, 0);
    await session.undo(); assert.equal(object.position.x, 0);
    await session.redo(); assert.equal(object.position.x, 12);
    assert.equal(captureSceneSession(session).objectList[0].position.x, 12);
  } finally { session.dispose(); }
});

test("failed scene preparation retains the previous runtime and authoritative document", async () => {
  let fail = false, changes = 0;
  const session = await createRuntimeSceneSession(source(), {
    createRuntime: (...args) => fail ? Promise.reject(new Error("injected compile failure")) : createJsonScene(...args),
    onRuntimeChanged: () => changes++
  });
  try {
    const previous = session.runtime;
    fail = true;
    const operations = [{ op: "add", path: "/objectList/-", value: { objType: "sphere", threeJsonId: "added" } }];
    await assert.rejects(session.dispatch({ operations }), /compile failure/);
    assert.equal(session.runtime, previous); assert.equal(session.revision, 0); assert.equal(changes, 1);
    assert.ok(getObjectByThreeJsonId("one", previous.scene));
    fail = false;
    await session.dispatch({ operations });
    assert.notEqual(session.runtime, previous); assert.equal(changes, 2);
    assert.equal(captureSceneSession(session).objectList[1].threeJsonId, "added");
  } finally { session.dispose(); }
});

test("material/geometry batches retain object identity, playback pose and prior immutable snapshots", async () => {
  const session = await createRuntimeSceneSession(source());
  try {
    const runtime = session.runtime, mesh = getObjectByThreeJsonId("one", runtime.scene), geometry = mesh.geometry;
    const before = session.snapshot();
    mesh.rotation.y = 1.2; // playback is not authoring
    const result = await executeSceneSessionCommands(session, [
      { op: "material.patch", args: { id: "one", partial: { type: "physical", color: "#ff0000", clearcoat: 0.8, transmission: 0.1 } } },
      { op: "object.patch", args: { id: "one", partial: { geometry: { width: 4, height: 2, depth: 3 } } } }
    ]);
    assert.equal(result.ok, true); assert.equal(session.runtime, runtime);
    assert.equal(getObjectByThreeJsonId("one", runtime.scene), mesh);
    assert.equal(mesh.geometry, geometry); // same topology: update attribute ranges
    assert.equal(mesh.geometry.boundingBox.max.x, 2);
    assert.equal(mesh.rotation.y, 1.2); assert.equal(session.revision, 1);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      assert.equal(material.type, "MeshPhysicalMaterial"); assert.equal(material.color.getHexString(), "ff0000");
      assert.equal(material.clearcoat, 0.8); assert.equal(material.transmission, 0.1);
    }
    assert.equal(before.root.objectList[0].material.color, "#336699");
    await session.undo(); assert.equal(mesh.geometry.boundingBox.max.x, 0.5);
    assert.equal((Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).color.getHexString(), "336699");
    await session.redo(); assert.equal(mesh.geometry.boundingBox.max.x, 2);
  } finally { session.dispose(); }
});

test("a failed replacement texture rolls back color, transform, document and history as one transaction", async () => {
  const session = await createRuntimeSceneSession(source(), {
    loader: { load(url, onLoad, progress, onError) { const texture = new THREE.Texture(); queueMicrotask(() => onError(new Error("injected image decode failure"))); return texture; } }
  });
  try {
    const runtime = session.runtime, mesh = getObjectByThreeJsonId("one", runtime.scene), material = mesh.material, snapshot = session.snapshot();
    const result = await executeSceneSessionCommands(session, [
      { op: "object.patch", args: { id: "one", partial: { position: { x: 4 } } } },
      { op: "material.patch", args: { id: "one", partial: { color: "#ff0000", textureUrl: "https://example.invalid/failed.png" } } }
    ]);
    assert.equal(result.ok, false); assert.match(result.error, /decode failure/);
    assert.equal(mesh.material, material); assert.equal(mesh.position.x, 0);
    assert.equal(session.snapshot(), snapshot); assert.equal(session.canUndo, false);
    assert.equal(session.runtime, runtime);
  } finally { session.dispose(); }
});

test("real buffer/mesh validation prevents an invalid final batch from changing the canvas", async () => {
  const input = { objectList: [{ objType: "bufferMesh", threeJsonId: "raw", geometry: { positions: [0,0,0, 1,0,0, 0,1,0], indices: [0,1,2] }, material: { color: "red" } }] };
  const session = await createRuntimeSceneSession(input);
  try {
    const mesh = getObjectByThreeJsonId("raw", session.runtime.scene), geometry = mesh.geometry;
    const prepared = await executeSceneSessionCommands(session, [{ op: "mesh.buffer.appendIndices", args: { id: "raw", values: [0,1,200] } }]);
    assert.equal(prepared.ok, true); assert.equal(session.revision, 0);
    const failed = await executeSceneSessionCommands(session, [{ op: "mesh.buffer.commit", args: { id: "raw" } }]);
    assert.equal(failed.ok, false); assert.equal(session.revision, 0); assert.equal(mesh.geometry, geometry);
    const fixed = await executeSceneSessionCommands(session, [
      { op: "mesh.buffer.setIndexRange", args: { id: "raw", offset: 3, values: [2,1,0] } },
      { op: "mesh.buffer.commit", args: { id: "raw" } }
    ]);
    assert.equal(fixed.ok, true); assert.equal(mesh.geometry.index.count, 6);
    assert.equal(getObjectByThreeJsonId("raw", session.runtime.scene), mesh);
  } finally { session.dispose(); }
});

import test from "node:test";
import assert from "node:assert/strict";
import { createRuntimeSceneSession, captureSceneSession } from "../core/session.js";
import { createJsonScene } from "../core/handler/sceneLoadHandler.js";
import { getObjectByThreeJsonId } from "../core/handler/objectRegistry.js";

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
    await assert.rejects(session.dispatch({ operations: [{ op: "object.patch", id: "one", patch: { geometry: { width: 10 } } }] }), /compile failure/);
    assert.equal(session.runtime, previous); assert.equal(session.revision, 0); assert.equal(changes, 1);
    assert.ok(getObjectByThreeJsonId("one", previous.scene));
    fail = false;
    await session.dispatch({ operations: [{ op: "object.patch", id: "one", patch: { geometry: { width: 10 } } }] });
    assert.notEqual(session.runtime, previous); assert.equal(changes, 2);
    assert.equal(captureSceneSession(session).objectList[0].geometry.width, 10);
  } finally { session.dispose(); }
});

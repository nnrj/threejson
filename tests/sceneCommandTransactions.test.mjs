import test from "node:test";
import assert from "node:assert/strict";
import { createSceneSession, executeSceneSessionCommands } from "../core/session.js";
import { prepareBufferMeshDraft } from "../core/document/bufferMeshDraft.js";
import { applyDocumentOperations, createSceneDocument } from "../core/document/sceneDocument.js";

const source = () => ({ objectList: [{ objType: "box", threeJsonId: "box", material: { color: "blue" }, position: { x: 0, y: 0, z: 0 } }] });

test("a failing command at the end rolls back the entire document batch, not just its result flag", async () => {
  let preparations = 0;
  const session = createSceneSession(source(), { driver: { prepare() { preparations++; return {}; } } });
  const snapshot = session.snapshot();
  const failed = await executeSceneSessionCommands(session, [
    { op: "object.patch", args: { id: "box", partial: { position: { x: 10 } } } },
    { op: "material.patch", args: { id: "missing", partial: { color: "red" } } }
  ]);
  assert.equal(failed.ok, false); assert.equal(failed.sceneMutated, false);
  assert.equal(session.document, snapshot); assert.equal(preparations, 0); assert.equal(session.canUndo, false);
  const result = await executeSceneSessionCommands(session, [
    { op: "object.patch", args: { id: "box", partial: { position: { x: 10 } } } },
    { op: "material.patch", args: { id: "box", partial: { color: "red" } } },
    { op: "object.get", args: { id: "box", path: "position.x" } }
  ]);
  assert.equal(result.ok, true); assert.equal(result.revision, 1); assert.equal(preparations, 1);
  assert.equal(result.results[2].data.value, 10);
  let undoState;
  session.subscribe((event) => { if (event.mode === "undo") undoState = [session.canUndo, session.canRedo]; });
  await session.undo();
  assert.deepEqual(session.document.root, snapshot.root); assert.deepEqual(undoState, [false, true]);
  session.dispose();
});

test("object addition, nested ownership, removal, export and read-only commands use the authoring document", async () => {
  const session = createSceneSession({ objectList: [{ objType: "group", threeJsonId: "group" }] });
  const result = await executeSceneSessionCommands(session, [
    { op: "object.add", args: { parent: "group", descriptor: { objType: "sphere", threeJsonId: "child" } } },
    { op: "scene.list" },
    { op: "scene.export" }
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.results[1].data.items[1].parentThreeJsonId, "group");
  assert.equal(result.results[2].data.json.objectList[0].subScene[0].threeJsonId, "child");
  const revision = session.revision;
  await executeSceneSessionCommands(session, [{ op: "scene.list" }]);
  assert.equal(session.revision, revision);
  await executeSceneSessionCommands(session, [{ op: "object.remove", args: { id: "child" } }]);
  assert.equal(session.document.root.objectList[0].subScene.length, 0);
  await session.undo(); assert.equal(session.document.root.objectList[0].subScene[0].threeJsonId, "child");
  session.dispose();
});

test("buffer drafts append more than 200,000 values without argument-stack limits and preserve failed drafts", async () => {
  const record = { objType: "bufferMesh", threeJsonId: "mesh", geometry: { positions: [0, 0, 0] } };
  const prepared = prepareBufferMeshDraft(record, null, "appendAttribute", { name: "position", values: new Array(210000).fill(1) });
  assert.equal(prepared.draft.descriptor.geometry.attributes.position.array.length, 210003);
  assert.equal(record.geometry.positions.length, 3);
  assert.throws(() => prepareBufferMeshDraft({ ...record, meshRevision: 1 }, prepared.draft, "commit"), { code: "E_MESH_REVISION_CONFLICT" });
  let fail = false;
  const session = createSceneSession({ objectList: [record] }, { driver: { prepare() { if (fail) throw new Error("geometry preparation failed"); return {}; } } });
  const append = await executeSceneSessionCommands(session, [{ op: "mesh.buffer.appendAttribute", args: { id: "mesh", name: "position", values: [1, 1, 1] } }]);
  assert.equal(append.ok, true); assert.equal(session.revision, 0);
  fail = true;
  assert.equal((await executeSceneSessionCommands(session, [{ op: "mesh.buffer.commit", args: { id: "mesh" } }])).ok, false);
  assert.equal(session.revision, 0);
  fail = false;
  assert.equal((await executeSceneSessionCommands(session, [{ op: "mesh.buffer.commit", args: { id: "mesh" } }])).ok, true);
  assert.equal(session.document.root.objectList[0].geometry.attributes.position.array.length, 6);
  await session.undo(); assert.deepEqual(session.document.root.objectList[0].geometry.positions, [0, 0, 0]);
  session.dispose();
});

test("mesh vertex editing logs small deltas and rejects stale topology revisions", async () => {
  const session = createSceneSession({ objectList: [{ objType: "editableMesh", threeJsonId: "mesh", topology: {
    vertices: [{ id: "a", position: [0, 0, 0] }, { id: "b", position: [1, 0, 0] }, { id: "c", position: [0, 1, 0] }],
    faces: [{ id: "f", vertices: ["a", "b", "c"] }]
  } }] });
  const before = session.document;
  const result = await executeSceneSessionCommands(session, [{ op: "mesh.edit", args: { id: "mesh", baseRevision: 0, operations: [{ type: "setVertex", id: "b", position: [2, 0, 0] }] } }]);
  assert.equal(result.ok, true);
  assert.equal(session.document.root.objectList[0].topology.vertices[1].position[0], 2);
  assert.equal((await executeSceneSessionCommands(session, [{ op: "mesh.edit", args: { id: "mesh", baseRevision: 0, operations: [{ type: "setVertex", id: "b", position: [3, 0, 0] }] } }])).ok, false);
  assert.ok(session.getJournal()[1].operations.some((op) => op.path.includes("/vertices/1/position")));
  await session.undo(); assert.deepEqual(session.document.root, before.root);
  session.dispose();
});

test("copy/move and compact array splices are atomic and invert exactly", () => {
  const document = createSceneDocument({ objectList: [], custom: { data: [1, 2, 3, 4], other: [] } });
  const result = applyDocumentOperations(document, [
    { op: "array.splice", path: "/custom/data", index: 1, deleteCount: 2, values: [5, 6, 7] },
    { op: "copy", from: "/custom/data/1", path: "/custom/other/-" },
    { op: "move", from: "/custom/data/0", path: "/custom/data/4" }
  ]);
  assert.deepEqual(result.document.root.custom, { data: [5, 6, 7, 4, 1], other: [5] });
  assert.deepEqual(applyDocumentOperations(result.document, result.inverse).document.root, document.root);
  assert.throws(() => applyDocumentOperations(document, [{ op: "move", from: "/custom", path: "/custom/x" }]), { code: "INVALID_OPERATION" });
});

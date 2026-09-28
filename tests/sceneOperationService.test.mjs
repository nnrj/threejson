import test from "node:test";
import assert from "node:assert/strict";
import { createSceneSession, createSceneOperationService } from "../core/session.js";
import { createSceneOperationRegistry, executeCommands, createCommandContext } from "../core/command/index.js";
import { queryScene } from "../core/query.js";

const source = () => ({ objectList: [{ objType: "box", threeJsonId: "box", position: { x: 0, y: 0, z: 0 }, geometry: { width: 2, height: 2, depth: 2 } }] });
const move = (x) => ({ op: "object.transform", args: { id: "box", frame: "parent", position: [x, 0, 0] } });

test("invalid arguments, no-runtime skips and schema-only preflight are not falsely successful execution", async () => {
  const ctx = createCommandContext();
  assert.equal((await executeCommands(ctx, [{ op: "object.patch", args: {} }], { dryRun: true })).ok, false);
  const skip = await executeCommands(ctx, [{ op: "object.remove", args: { id: "box" } }], { executeMode: "auto" });
  assert.equal(skip.ok, false); assert.equal(skip.results[0].code, "RUNTIME_REQUIRED");
  const service = createSceneOperationService({ session: createSceneSession(source()) });
  const invalid = await service.execute({ op: "object.transform", args: { id: "box", frame: "world", postion: [1, 2, 3] } });
  assert.equal(invalid.code, "INVALID_COMMAND_ARGUMENTS");
  const valid = await service.preflight(move(2));
  assert.equal(valid.status, "preflight"); assert.equal(valid.checks.render, "unchecked"); assert.equal(service.revision, 0);
});

test("preflight uses real driver preparation, rolls it back, and never publishes history or draft state", async () => {
  let commits = 0, preparations = 0, rollbacks = 0, disposals = 0;
  const session = createSceneSession(source(), { driver: { prepare(document) {
    preparations++;
    if (document.root.objectList[0].position.x === 13) throw Object.assign(new Error("unbuildable"), { code: "GEOMETRY_FAILED" });
    return { commit() { commits++; }, rollback() { rollbacks++; }, dispose() { disposals++; } };
  } } });
  const service = createSceneOperationService({ session }), before = session.snapshot();
  assert.equal((await service.preflight(move(13))).ok, false);
  assert.equal((await service.preflight(move(2))).status, "preflight");
  assert.equal(session.document, before); assert.equal(session.canUndo, false);
  assert.equal(preparations, 2); assert.equal(commits, 0); assert.equal(rollbacks, 1); assert.equal(disposals, 1);
  const applied = await service.execute(move(2));
  assert.equal(applied.status, "committed"); assert.equal(commits, 1); assert.deepEqual(applied.changedIds, ["box"]);
  await service.undo(); assert.deepEqual(session.document.root, before.root);
  await service.redo(); assert.equal(session.document.root.objectList[0].position.x, 2);
});

test("request IDs coalesce queued writes; payload conflicts, stale revisions, wrong sessions and expired sessions are explicit", async () => {
  const session = createSceneSession(source()), service = createSceneOperationService({ session });
  const otherWrapper = createSceneOperationService({ session });
  const options = { requestId: "move-1", baseRevision: 0 };
  const [a, b] = await Promise.all([service.execute(move(4), options), otherWrapper.execute(move(4), options)]);
  assert.equal(a, b); assert.equal(session.revision, 1);
  assert.equal((await service.execute(move(5), options)).code, "REQUEST_ID_CONFLICT");
  assert.equal((await service.execute(move(5), { baseRevision: 0 })).code, "STALE_SCENE_REVISION");
  assert.equal((await service.execute(move(5), { sessionId: "different" })).code, "SESSION_ID_MISMATCH");
  assert.equal((await service.execute(move(4))).status, "noop");
  session.dispose(); assert.equal((await service.execute(move(4), options)).status, "unavailable");
});

test("failed batches and cancellation preserve committed source", async () => {
  const session = createSceneSession(source()), service = createSceneOperationService({ session });
  const before = session.snapshot();
  const failed = await service.execute([move(10), { op: "object.remove", args: { id: "missing" } }]);
  assert.equal(failed.ok, false); assert.equal(session.snapshot(), before); assert.equal(session.canUndo, false);
  const abort = new AbortController(); abort.abort();
  assert.equal((await service.execute(move(10), { signal: abort.signal })).status, "cancelled");
  assert.equal(session.document, before);
});

test("custom operations share contracts, pure preparation and undo, without exposing imperative handlers", async () => {
  const registry = createSceneOperationRegistry();
  registry.register({ op: "custom.rename", category: "authoring", inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false } }, ({ document }, args) => ({ operations: [{ op: "object.patch", id: "box", patch: { name: args.name } }], data: { previousRevision: document.revision } }));
  const session = createSceneSession(source()), service = createSceneOperationService({ session, registry });
  assert.equal((await service.execute({ op: "custom.rename", args: {} })).ok, false);
  assert.equal((await service.preflight({ op: "custom.rename", args: { name: "new" } })).ok, true);
  assert.equal(session.revision, 0);
  assert.equal((await service.execute({ op: "custom.rename", args: { name: "new" } })).ok, true);
  await service.undo(); assert.equal(session.document.root.objectList[0].name, undefined);
});

test("queries keep same-ID sessions separate and cursor revisions explicit", async () => {
  const first = createSceneSession(source()), second = createSceneSession(source());
  const a = createSceneOperationService({ session: first }), b = createSceneOperationService({ session: second });
  await a.execute(move(7));
  const qa = await a.execute({ op: "scene.query" }), qb = await b.execute({ op: "scene.query" });
  assert.equal(qa.status, "read"); assert.deepEqual(qa.results[0].data.items[0].transform.worldPosition, [7, 0, 0]);
  assert.deepEqual(qb.results[0].data.items[0].transform.worldPosition, [0, 0, 0]);
  const stale = await a.execute({ op: "scene.query", args: { cursor: { revision: 0, offset: 0 } } });
  assert.equal(stale.code, "STALE_QUERY_CURSOR");
});

test("dense mesh query responses stay compact unless descriptor is explicitly requested", () => {
  const scene = createSceneSession({ objectList: [{ objType: "bufferMesh", threeJsonId: "dense", geometry: { attributes: { position: { array: new Array(600000).fill(0), itemSize: 3 } } } }] });
  const result = queryScene(scene.document);
  assert.ok(JSON.stringify(result).length < 6000);
  assert.equal(result.items[0].descriptor, undefined);
  assert.equal(queryScene(scene.document, { projection: ["descriptor"] }).items[0].descriptor.geometry.attributes.position.array.length, 600000);
});

test("world transforms and reparent preserve poses through nested rotated parents; impossible shear fails", async () => {
  const session = createSceneSession({ objectList: [{ objType: "group", threeJsonId: "parent", rotation: { z: Math.PI / 2 }, position: { x: 10 }, subScene: source().objectList }, { objType: "group", threeJsonId: "other", position: { z: 5 } }] });
  const service = createSceneOperationService({ session });
  assert.equal((await service.execute({ op: "object.transform", args: { id: "box", frame: "world", position: [10, 3, 0] } })).ok, true);
  const position = () => queryScene(session.document, { selector: { ids: ["box"] }, projection: ["transform"] }).items[0].transform.worldPosition;
  assert.ok(Math.abs(position()[1] - 3) < 1e-9);
  assert.equal((await service.execute({ op: "object.reparent", args: { id: "box", parent: "other" } })).ok, true);
  assert.deepEqual(position(), [10, 3, 0]);
  assert.equal((await service.execute({ op: "object.reparent", args: { id: "other", parent: "box" } })).code, "HIERARCHY_CYCLE");
  const sheared = createSceneSession({ objectList: [{ objType: "group", threeJsonId: "p", scale: [2, 1, 1], subScene: [{ objType: "box", threeJsonId: "c", rotation: { z: Math.PI / 4 } }] }] });
  assert.equal((await createSceneOperationService({ session: sheared }).execute({ op: "object.reparent", args: { id: "c" } })).code, "UNREPRESENTABLE_SHEAR");
  assert.equal(sheared.revision, 0); sheared.dispose();
});

test("clones remap internal design references, retain external references, and undo as one transaction", async () => {
  const session = createSceneSession({ objectList: [{ objType: "group", threeJsonId: "assembly", subScene: source().objectList }], design: { version: 1, relations: [{ type: "attach", object: "box", target: "assembly", anchor: "origin", targetAnchor: "origin" }] } });
  const service = createSceneOperationService({ session });
  const result = await service.execute({ op: "object.clone", args: { id: "assembly", newId: "copy" } });
  assert.equal(result.ok, true);
  assert.equal(session.document.root.objectList[1].subScene[0].threeJsonId, "copy/box");
  assert.equal(session.document.root.design.relations[1].object, "copy/box");
  assert.equal(session.document.root.design.relations[1].target, "copy");
  await service.undo(); assert.equal(session.document.root.objectList.length, 1);
});

test("design-bound fields require editing the parameter; layout and postconditions are deterministic", async () => {
  const session = createSceneSession({ ...source(), design: { version: 1, parameters: { x: 1 }, bindings: [{ object: "box", path: "/position/x", value: { param: "x" } }] } });
  const service = createSceneOperationService({ session });
  assert.equal((await service.execute(move(5))).code, "AUTHORING_FIELD_CONTROLLED");
  assert.equal((await service.execute({ op: "design.parameter.set", args: { name: "x", value: 5 } })).ok, true);
  const observed = await service.execute({ op: "scene.query", args: { state: "evaluated", projection: ["transform"] } });
  assert.equal(observed.results[0].data.items[0].transform.worldPosition[0], 5);
  const checked = await service.execute({ op: "scene.check", args: { state: "evaluated", assertions: [{ type: "position", id: "box", value: [5, 0, 0] }, { type: "beauty", value: "industrial quality" }] } });
  assert.equal(checked.results[0].data.checks[0].status, "passed");
  assert.equal(checked.results[0].data.checks[1].status, "unchecked");
  assert.equal(checked.results[0].data.satisfied, false);
  assert.equal((await service.execute({ op: "object.patch", args: { id: "box", partial: { position: { x: 3 } } } })).code, "AUTHORING_FIELD_CONTROLLED");
  assert.equal((await service.execute({ op: "scene.applyPatch", args: { patch: [{ op: "replace", path: "/objectList/0/position/x", value: 8 }] } })).code, "AUTHORING_FIELD_CONTROLLED");
  assert.equal((await service.execute({ op: "scene.applyPatch", args: { patch: [{ op: "remove", path: "/design/bindings/0" }, { op: "replace", path: "/objectList/0/position/x", value: 8 }] } })).ok, true);
});

test("revision deltas include inherited transforms, removals and idempotent undo receipts", async () => {
  const session = createSceneSession({ objectList: [{ objType: "group", threeJsonId: "g", subScene: source().objectList }] }), service = createSceneOperationService({ session });
  await service.execute({ op: "object.transform", args: { id: "g", frame: "world", position: [3, 0, 0] } });
  const read = () => service.execute({ op: "scene.query", args: { sinceRevision: 0 } });
  assert.deepEqual((await read()).results[0].data.items.map((item) => item.id), ["box", "g"]);
  await service.execute({ op: "object.remove", args: { id: "box" } });
  assert.deepEqual((await read()).results[0].data.removedIds, ["box"]);
  const options = { requestId: "undo-once", baseRevision: 2 };
  const first = await service.undo(options), second = await service.undo(options);
  assert.equal(first, second); assert.equal(session.revision, 3);
  assert.deepEqual((await read()).results[0].data.removedIds, []);
  assert.equal((await service.redo(options)).code, "REQUEST_ID_CONFLICT"); session.dispose();
});

test("disposing a session aborts in-flight preflight preparation", async () => {
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  const session = createSceneSession(source(), { driver: { prepare(_doc, { signal }) { started(); return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })); } } });
  const task = createSceneOperationService({ session }).preflight(move(3)); await ready; session.dispose();
  assert.equal((await task).status, "cancelled"); assert.equal(session.revision, 0);
});

test("candidate queries never leak internal revisions and cursor/delta reads cannot observe pending edits", async () => {
  const session = createSceneSession(source()), service = createSceneOperationService({ session });
  const result = await service.execute([move(2), move(3), { op: "scene.query", args: { projection: ["transform"] } }]);
  assert.equal(result.ok, true); assert.equal(session.revision, 1);
  const observed = result.results[2].data;
  assert.equal(observed.revision, null); assert.equal(observed.baseRevision, 0);
  assert.equal(observed.documentState, "candidate"); assert.equal(observed.nextCursor, null);
  assert.deepEqual(observed.items[0].transform.worldPosition, [3, 0, 0]);
  const failed = await service.execute([move(4), { op: "scene.query", args: { sinceRevision: 0 } }]);
  assert.equal(failed.code, "QUERY_REQUIRES_COMMIT"); assert.equal(session.revision, 1);
  session.dispose();
});

test("preflight and failed batches preserve an existing pending buffer transaction", async () => {
  const session = createSceneSession({ objectList: [{ objType: "bufferMesh", threeJsonId: "mesh", geometry: { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] } }] });
  const service = createSceneOperationService({ session });
  const update = (value) => ({ op: "mesh.buffer.setAttributeRange", args: { id: "mesh", name: "position", offset: 0, values: [value, 0, 0], baseRevision: 0 } });
  const commit = { op: "mesh.buffer.commit", args: { id: "mesh", baseRevision: 0 } };
  assert.equal((await service.execute(update(2))).status, "draft");
  assert.equal((await service.preflight([update(9), commit])).status, "preflight");
  assert.equal(session.canUndo, false); assert.equal(session.revision, 0);
  assert.equal((await service.execute([update(10), { op: "object.remove", args: { id: "missing" } }])).ok, false);
  assert.equal((await service.execute(commit)).ok, true);
  assert.equal(session.document.root.objectList[0].geometry.attributes.position.array[0], 2);
  assert.equal(session.revision, 1); await service.undo();
  assert.deepEqual(session.document.root.objectList[0].geometry.positions, [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  session.dispose();
});

test("parameters retain quantity units, clones preserve opaque metadata and nested layouts honor world targets", async () => {
  const session = createSceneSession({ objectList: [{ objType: "group", threeJsonId: "parent", metadata: { target: "parent" }, subScene: source().objectList }],
    design: { parameters: { height: { value: 100, unit: "cm" }, twice: { op: "mul", args: [{ param: "height" }, 2] } } } });
  const service = createSceneOperationService({ session });
  assert.equal((await service.execute({ op: "design.parameter.set", args: { name: "height", value: 250 } })).ok, true);
  assert.deepEqual(session.document.root.design.parameters.height, { value: 250, unit: "cm" });
  assert.equal((await service.execute({ op: "design.parameter.set", args: { name: "twice", value: 1 } })).code, "DESIGN_PARAMETER_DERIVED");
  const layout = await service.execute({ op: "scene.layout", args: { ids: ["box", "parent"], layout: "row", origin: [2, 0, 0], step: [3, 0, 0] } });
  assert.equal(layout.ok, true);
  const positions = queryScene(session.document, { projection: ["transform"] }).items;
  assert.deepEqual(positions.find((item) => item.id === "box").transform.worldPosition, [2, 0, 0]);
  assert.deepEqual(positions.find((item) => item.id === "parent").transform.worldPosition, [5, 0, 0]);
  await service.execute({ op: "object.clone", args: { id: "parent", newId: "copy" } });
  assert.equal(session.document.root.objectList[1].metadata.target, "parent");
  session.dispose();
});

test("quaternion patches cannot bypass a retained Euler binding", async () => {
  const session = createSceneSession({ objectList: [{ objType: "box", threeJsonId: "box", rotation: { x: 0, y: 0, z: 0 } }],
    design: { parameters: { angle: 1 }, bindings: [{ object: "box", path: "/rotation/y", value: { param: "angle" } }] } });
  const service = createSceneOperationService({ session });
  const result = await service.execute({ op: "object.patch", args: { id: "box", partial: { quaternion: [0, 0, 0, 1] } } });
  assert.equal(result.code, "AUTHORING_FIELD_CONTROLLED"); assert.equal(session.revision, 0); session.dispose();
});

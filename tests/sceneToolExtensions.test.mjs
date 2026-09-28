import test from "node:test";
import assert from "node:assert/strict";
import { createSceneSession, createSceneOperationService } from "../core/session.js";
import { registerEventAction, unregisterEventAction } from "../core/operations.js";
import { evaluateMeshOperator } from "../core/modeling/meshOperators.js";
import { Scene, Mesh, BoxGeometry, MeshBasicMaterial } from "three";
import { captureSceneFrame } from "../core/runtime/sceneObservation.js";

test("surface scatter is reproducible and weighted by area, and arc samples have uniform distance", async () => {
  const mesh = (await evaluateMeshOperator("mesh.raw", { params: { geometry: { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 10, 0, 0, 12, 0, 0, 10, 2, 0] } }, inputs: {}, nodeId: "surface" })).mesh;
  const request = { params: { count: 1000, seed: 5 }, inputs: { mesh }, nodeId: "scatter" };
  const first = await evaluateMeshOperator("points.scatterMesh", request), second = await evaluateMeshOperator("points.scatterMesh", request);
  assert.deepEqual(first, second);
  assert.ok(first.points.positions.filter(([x]) => x > 5).length > 730);
  assert.ok(first.points.positions.every(([, , z]) => z === 0));
  assert.ok(first.points.normals.every((n) => n[2] === 1));
  const curve = await evaluateMeshOperator("points.sampleCurve", { params: { count: 4, includeEnd: true }, inputs: { curve: { points: [[0, 0, 0], [1, 0, 0], [3, 0, 0]] } }, nodeId: "curve" });
  assert.deepEqual(curve.points.positions, [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]]);
});
test("contracted runtime actions are discoverable, scoped, separate from authoring and never invoked by preflight", async () => {
  const session = createSceneSession({ objectList: [{ objType: "box", threeJsonId: "b" }] });
  const scene = new Scene(), mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial()); scene.add(mesh); mesh.userData.objJson = { objType: "box", threeJsonId: "b" };
  Object.defineProperty(session, "runtime", { value: { scene } });
  let calls = 0;
  registerEventAction("test.open", (action, ctx) => { calls++; assert.equal(ctx.object, mesh); return { open: action.open }; }, { inputSchema: { type: "object", properties: { open: { type: "boolean" } }, required: ["open"], additionalProperties: false }, targets: ["box"] });
  try {
    const service = createSceneOperationService({ session }), command = { op: "action.invoke", args: { id: "b", type: "test.open", params: { open: true } } };
    assert.ok((await service.execute({ op: "action.discover" })).results[0].data.actions.some((a) => a.type === "test.open"));
    assert.equal((await service.preflight(command)).ok, true); assert.equal(calls, 0);
    assert.equal((await service.execute([command, { op: "object.remove", args: { id: "b" } }])).code, "NON_TRANSACTIONAL_ACTION_BATCH");
    assert.equal(calls, 0);
    assert.equal((await service.execute(command, { requestId: "open" })).status, "applied");
    await service.execute(command, { requestId: "open" }); assert.equal(calls, 1); assert.equal(session.revision, 0); assert.equal(session.canUndo, false);
  } finally { unregisterEventAction("test.open"); session.dispose(); mesh.geometry.dispose(); mesh.material.dispose(); }
});
test("scene capture rejects zero-size canvas and preserves actual lighting metadata", async () => {
  const scene = new Scene(), canvas = { width: 0, height: 0, toDataURL: () => "data:image/png;base64,AA==" };
  const runtime = { scene, renderer: { domElement: canvas }, renderOnce() {} };
  await assert.rejects(captureSceneFrame(runtime), (error) => error.code === "EMPTY_VIEWPORT");
  canvas.width = 20; canvas.height = 30;
  const result = await captureSceneFrame(runtime);
  assert.equal(result.diagnosticRelighting, false); assert.deepEqual(result.observation.lights, []);
  assert.equal(result.views[0].width, 20);
});

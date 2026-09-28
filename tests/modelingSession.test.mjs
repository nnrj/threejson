import assert from "node:assert/strict";
import { test } from "node:test";
import { createRuntimeSceneSession, executeSceneSessionCommands } from "../core/session.js";
import { compileAuthoring, formatAuthoring } from "../core/document/authoringAdapters.js";
import { getObjectByThreeJsonId } from "../core/handler/objectRegistry.js";
import { packTjzArchive } from "../core/archive/tjzPackager.js";
import { parseTjzArchiveForScene } from "../core/archive/tjzArchive.js";
import { captureSceneSession } from "../core/session.js";
import { createModelingOperatorRegistry } from "../core/modeling/index.js";

const model = () => ({ objType: "modeledMesh", threeJsonId: "m", material: { type: "standard", color: "#885533" }, modeling: {
  version: 1, parameters: { width: 2 }, nodes: [{ id: "base", operator: "primitive.box", params: { width: { param: "width" }, height: 1, depth: 1 } }], output: { node: "base", output: "mesh" }
} });

test("friendly/standard authoring preserves modeling source rather than flattening it", () => {
  const initial = compileAuthoring({ objectList: [model()] });
  const friendly = formatAuthoring(initial, { format: "friendly" });
  const restored = compileAuthoring(friendly);
  assert.deepEqual(restored.root.objectList.find((r) => r.threeJsonId === "m").modeling, initial.root.objectList[0].modeling);
});

test("modeled meshes render, edit in place, undo/redo and bake without losing materials or authoring", async () => {
  const session = await createRuntimeSceneSession({ objectList: [model()] });
  try {
    const runtime = session.runtime, mesh = getObjectByThreeJsonId("m", runtime.scene), material = mesh.material;
    assert.ok(mesh.isMesh); assert.equal(mesh.geometry.boundingBox.max.x, 1);
    const snapshot = session.snapshot();
    const command = { op: "model.patch", args: { id: "m", baseRevision: 0, patch: [{ op: "replace", path: "/parameters/width", value: 4 }] } };
    const result = await executeSceneSessionCommands(session, [command]);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(session.runtime, runtime); assert.equal(getObjectByThreeJsonId("m", runtime.scene), mesh); assert.equal(mesh.material, material);
    assert.equal(mesh.geometry.boundingBox.max.x, 2); assert.equal(snapshot.root.objectList[0].modeling.parameters.width, 2);
    await session.undo(); assert.equal(mesh.geometry.boundingBox.max.x, 1);
    await session.redo(); assert.equal(mesh.geometry.boundingBox.max.x, 2);
    const stale = await executeSceneSessionCommands(session, [command]); assert.equal(stale.ok, false);
    const bad = await executeSceneSessionCommands(session, [{ ...command, args: { ...command.args, baseRevision: 1, patch: [{ op: "replace", path: "/parameters/width", value: -1 }] } }]);
    assert.equal(bad.ok, false); assert.equal(mesh.geometry.boundingBox.max.x, 2);
    const inspection = await executeSceneSessionCommands(session, [{ op: "model.inspect", args: { id: "m" } }]);
    assert.equal(inspection.results[0].data.revision, 1); assert.equal(inspection.results[0].data.nodes[0].params, undefined);
    const baked = await executeSceneSessionCommands(session, [{ op: "model.bake", args: { id: "m", baseRevision: 1 } }]);
    assert.equal(baked.ok, true, JSON.stringify(baked)); assert.equal(session.document.root.objectList[0].objType, "bufferMesh");
    assert.equal(mesh.material, material);
    await session.undo(); assert.equal(session.document.root.objectList[0].objType.toLowerCase(), "modeledmesh");
  } finally { session.dispose(); }
});

test("root design bindings are evaluated before modeling preparation and survive undo as authoring", async () => {
  const source = { objectList: [model()], design: { version: 1, parameters: { width: { value: 300, unit: "cm" } },
    bindings: [{ object: "m", path: "/modeling/parameters/width", value: { param: "width" } }] } };
  const session = await createRuntimeSceneSession(source);
  try {
    const mesh = getObjectByThreeJsonId("m", session.runtime.scene);
    assert.equal(mesh.geometry.boundingBox.max.x, 1.5);
    assert.equal(session.document.root.objectList[0].modeling.parameters.width, 2);
    await session.dispatch({ operations: [{ op: "replace", path: "/design/parameters/width/value", value: 400 }] });
    assert.equal(mesh.geometry.boundingBox.max.x, 2);
    await session.undo(); assert.equal(mesh.geometry.boundingBox.max.x, 1.5);
  } finally { session.dispose(); }
});

test("inspection/evaluation/bake use bound values and bake removes only consumed graph bindings", async () => {
  const source = { objectList: [model()], design: { version: 1, parameters: { width: 3, x: 7 }, bindings: [
    { object: "m", path: "/modeling/parameters/width", value: { param: "width" } },
    { object: "m", path: "/position/x", value: { param: "x" } }
  ] } };
  const session = await createRuntimeSceneSession(source);
  try {
    const query = await executeSceneSessionCommands(session, [{ op: "model.inspect", args: { id: "m" } }, { op: "model.evaluate", args: { id: "m" } }]);
    assert.equal(query.ok, true, JSON.stringify(query));
    assert.equal(query.results[0].data.parameters.width, 2);
    assert.equal(query.results[0].data.evaluatedParameters.width, 3);
    assert.equal(query.results[0].data.position.x, 7);
    assert.equal(query.results[1].data.bounds.max[0], 1.5);
    const overridden = await executeSceneSessionCommands(session, [{ op: "model.patch", args: { id: "m", baseRevision: 0, patch: [{ op: "replace", path: "/parameters/width", value: 4 }] } }]);
    assert.equal(overridden.ok, false); assert.equal(overridden.results[0].data.code, "MODEL_PARAMETER_BOUND");
    const bake = await executeSceneSessionCommands(session, [{ op: "model.bake", args: { id: "m" } }]);
    assert.equal(bake.ok, true, JSON.stringify(bake));
    assert.equal(getObjectByThreeJsonId("m", session.runtime.scene).geometry.boundingBox.max.x, 1.5);
    assert.equal(getObjectByThreeJsonId("m", session.runtime.scene).position.x, 7);
    assert.deepEqual(session.document.root.design.bindings.map((b) => b.path), ["/position/x"]);
    await session.undo();
    assert.equal(session.document.root.design.bindings.length, 2);
    assert.equal(session.document.root.objectList[0].modeling.parameters.width, 2);
    assert.equal(getObjectByThreeJsonId("m", session.runtime.scene).geometry.boundingBox.max.x, 1.5);
  } finally { session.dispose(); }
});

test("binary input content participates in cache invalidation even when its URL is unchanged", async () => {
  const positions = new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0]);
  const source = { ...model(), modeling: { version: 1, nodes: [{ id: "raw", operator: "mesh.raw", params: { geometry: {
    buffers: { points: "custom://positions" }, attributes: { position: { bufferRef: "points", itemSize: 3, type: "Float32Array" } }
  } } }], output: { node: "raw", output: "mesh" } } };
  const session = await createRuntimeSceneSession({ objectList: [source] }, { resolveBufferReference: () => ({ buffer: positions.buffer }) });
  try {
    assert.equal(getObjectByThreeJsonId("m", session.runtime.scene).geometry.boundingBox.max.x, 2);
    positions[3] = 5;
    const evaluation = await executeSceneSessionCommands(session, [{ op: "model.evaluate", args: { id: "m" } }]);
    assert.equal(evaluation.ok, true, JSON.stringify(evaluation)); assert.equal(evaluation.results[0].data.bounds.max[0], 5);
    const bake = await executeSceneSessionCommands(session, [{ op: "model.bake", args: { id: "m" } }]);
    assert.equal(bake.ok, true, JSON.stringify(bake));
    assert.equal(getObjectByThreeJsonId("m", session.runtime.scene).geometry.boundingBox.max.x, 5);
  } finally { session.dispose(); }
});

test("raw operator binary references survive offline archive reload, graph edit and bake", async () => {
  const positions = new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0]);
  const record = { ...model(), modeling: { version: 1, nodes: [{ id: "raw", operator: "mesh.raw", params: { geometry: {
    buffers: { points: "pack://mesh/positions.bin" }, attributes: { position: { bufferRef: "points", itemSize: 3, type: "Float32Array" } }
  } } }], output: { node: "raw", output: "mesh" } } };
  const parsed = await parseTjzArchiveForScene(await packTjzArchive({ objectList: [record] }, { assets: { "mesh/positions.bin": new Uint8Array(positions.buffer) } }));
  const session = await createRuntimeSceneSession(parsed.payload, { fetch: () => { throw new Error("No network is allowed in this offline test"); } });
  try {
    const mesh = getObjectByThreeJsonId("m", session.runtime.scene);
    assert.deepEqual([...mesh.geometry.attributes.position.array], [...positions]);
    const edit = await executeSceneSessionCommands(session, [{ op: "model.patch", args: { id: "m", baseRevision: 0,
      patch: [{ op: "add", path: "/nodes/0/params/geometry/computeNormals", value: true }] } }]);
    assert.equal(edit.ok, true, JSON.stringify(edit));
    const saved = JSON.parse(JSON.stringify(captureSceneSession(session)));
    assert.match(saved.objectList[0].modeling.nodes[0].params.geometry.buffers.points, /^pack:\/\//);
    assert.doesNotMatch(JSON.stringify(saved), /blob:/);
    const reloaded = await createRuntimeSceneSession(saved);
    try { assert.deepEqual([...getObjectByThreeJsonId("m", reloaded.runtime.scene).geometry.attributes.position.array], [...positions]); }
    finally { reloaded.dispose(); }
    const baked = await executeSceneSessionCommands(session, [{ op: "model.bake", args: { id: "m" } }]);
    assert.equal(baked.ok, true, JSON.stringify(baked));
  } finally { session.dispose(); parsed.dispose(); }
});

test("a host-scoped custom registry/context works for initial load and later atomic commands", async () => {
  const registry = createModelingOperatorRegistry(); let calls = 0;
  registry.register({ id: "custom.triangle", version: 1, outputs: { mesh: "mesh" }, parameters: { type: "object", properties: { width: { type: "number", default: 2 } } },
    backends: { cpu: ({ params, context }) => { calls++; return { mesh: { type: "mesh", geometry: { positions: [0, 0, 0, params.width, 0, 0, 0, context.height, 0] } } }; } } });
  const record = { ...model(), modeling: { version: 1, parameters: { width: 2 }, nodes: [{ id: "triangle", operator: "custom.triangle", params: { width: { param: "width" } } }], output: { node: "triangle", output: "mesh" } } };
  const session = await createRuntimeSceneSession({ objectList: [record] }, { modelingRegistry: registry, modelingContext: { height: 3 } });
  try {
    const mesh = getObjectByThreeJsonId("m", session.runtime.scene);
    assert.equal(mesh.geometry.boundingBox.max.y, 3);
    const result = await executeSceneSessionCommands(session, [{ op: "model.patch", args: { id: "m", baseRevision: 0, patch: [{ op: "replace", path: "/parameters/width", value: 5 }] } }]);
    assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(mesh.geometry.boundingBox.max.x, 5); assert.equal(mesh.geometry.boundingBox.max.y, 3);
    assert.equal(calls, 2, "one initial evaluation and one edit; validation and runtime must share the compiled graph");
    const operators = await executeSceneSessionCommands(session, [{ op: "model.operators", args: { id: "custom.triangle" } }]);
    assert.equal(operators.results[0].data.operators.length, 1);
  } finally { session.dispose(); }
});

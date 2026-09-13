import assert from "node:assert/strict";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import * as THREE from "three";
import { createWorkerGeometryCompiler, createDirectGeometryCompiler } from "../core/geometry/geometryCompiler.js";
import { geometryInputRecord, collectGeometryRecords } from "../core/geometry/geometryInput.js";
import { evaluateEditableMeshGeometry } from "../core/geometry/editableMeshGeometry.js";
import { evaluateProceduralMeshGeometry } from "../core/geometry/proceduralMeshGeometry.js";
import { createRuntimeContext, attachRuntimeContext } from "../core/runtime/runtimeContext.js";
import { prepareSceneGeometry } from "../core/geometry/preparedGeometry.js";
import { createEditableMesh } from "../core/builder/editableMesh/editableMeshBuilder.js";

const surface = { objType: "parametricSurface", uSegments: 100, vSegments: 70, expressions: { x: "u * 4", y: "sin(u * 6.28) * cos(v * 6.28)", z: "v * 4" } };
const cage = { objType: "editableMesh", topology: {
  vertices: [{id:"a",position:[-1,0,-1]},{id:"b",position:[1,0,-1]},{id:"c",position:[1,0,1]},{id:"d",position:[-1,0,1]}],
  faces: [{id:"f",vertices:["d","c","b","a"],part:"seat"}]
}, modifiers: [{ type: "catmullClark", iterations: 3 }], uvProjection: "planar" };

function realCompiler() {
  return createWorkerGeometryCompiler({ workerFactory() {
    const worker = new Worker(new URL("./fixtures/geometryWorkerNode.mjs", import.meta.url));
    return { postMessage: (v, t) => worker.postMessage(v, t), terminate: () => worker.terminate(),
      addEventListener: (type, fn) => worker.on(type, (data) => fn(type === "message" ? { data } : data)) };
  } });
}

function equalGeometry(a, b) {
  assert.deepEqual(a.index?.array, b.index?.array);
  for (const key of Object.keys(b.attributes)) assert.deepEqual(a.attributes[key].array, b.attributes[key].array, key);
  assert.deepEqual(a.groups, b.groups); assert.deepEqual(a.boundingBox, b.boundingBox);
  assert.deepEqual(a.userData, b.userData);
}

test("real worker preserves surface/cage geometry, groups, bounds and deterministic metadata", async () => {
  const compiler = realCompiler();
  try {
    for (const [record, evaluate] of [[surface, evaluateProceduralMeshGeometry], [cage, evaluateEditableMeshGeometry]]) {
      const expected = evaluate(record); assert.ok(expected.geometry, expected.error);
      const result = await compiler.compile(record);
      equalGeometry(result.geometry, expected.geometry); assert.deepEqual(result.stats, expected.stats);
      assert.equal(result.evaluatedTopology, undefined, "do not transfer expanded topology back just for rendering");
      result.geometry.dispose(); expected.geometry.dispose();
    }
  } finally { compiler.dispose(); }
});

test("prepared geometry is consumed once without re-evaluating mutated input", async () => {
  const compiler = realCompiler(), context = createRuntimeContext(), parent = new THREE.Group();
  attachRuntimeContext(parent, context);
  try {
    let compiled;
    const resources = await prepareSceneGeometry({ objectList: [cage] }, { geometryCompiler: { supports: compiler.supports, async compile(record, options) {
      compiled = await compiler.compile(record, options); return compiled;
    } } });
    context.capabilityResources.add("compiled-geometry", resources);
    const mesh = createEditableMesh({ ...cage, name: "chair" }, parent);
    assert.equal(mesh.geometry, compiled.geometry, "builder must consume the worker result without computing it again");
    assert.ok(mesh.geometry.attributes.position.count > 4);
    let retired = false; mesh.geometry.addEventListener("dispose", () => { retired = true; });
    resources.dispose(); assert.equal(retired, false, "adopted geometry belongs to the scene, not the preparation");
    mesh.geometry.dispose(); mesh.material.dispose?.();
  } finally { compiler.dispose(); context.dispose(); }
});

test("worker errors reject, ordinary cubes do not start a worker, and caller data is projected", async () => {
  let starts = 0;
  const compiler = createWorkerGeometryCompiler({ workerFactory() { starts++; throw new Error("CSP blocks worker"); } });
  try {
    const resources = await prepareSceneGeometry({ objectList: [{ objType: "box" }] }, { geometryCompiler: compiler });
    resources.dispose(); assert.equal(starts, 0);
    await assert.rejects(compiler.compile(surface), { code: "GEOMETRY_WORKER_UNAVAILABLE" });
    const input = geometryInputRecord({ ...surface, material: { textureUrl: "private-url" }, metadata: { token: "secret" }, events: { code: "not sent" } });
    assert.equal(input.material, undefined); assert.equal(input.metadata, undefined); assert.equal(input.events, undefined);
    assert.equal(collectGeometryRecords({ values: new Float32Array(100000), objectList: [surface] }).length, 1);
  } finally { compiler.dispose(); }
});

test("cancelling active worker terminates it without dropping another queued compilation", async () => {
  const instances = [], controller = new AbortController();
  const compiler = createWorkerGeometryCompiler({ workerFactory() {
    const listeners = new Map();
    const worker = { terminated: false, request: null, terminate() { this.terminated = true; },
      addEventListener: (t, fn) => listeners.set(t, fn), postMessage(data) { this.request = data; },
      emit(data) { listeners.get("message")?.({ data }); } };
    instances.push(worker); queueMicrotask(() => worker.emit({ type: "ready" })); return worker;
  } });
  try {
    const first = compiler.compile(cage, { signal: controller.signal });
    const rejected = assert.rejects(first, { name: "AbortError" });
    const secondController = new AbortController();
    const second = compiler.compile(surface, { signal: secondController.signal });
    const secondRejected = assert.rejects(second, { name: "AbortError" });
    await new Promise((r) => setImmediate(r));
    assert.equal(instances[0].request.record.objType, "editablemesh");
    controller.abort(); await rejected;
    await new Promise((r) => setImmediate(r));
    assert.equal(instances[0].terminated, true);
    assert.equal(instances[1].request.record.objType, "parametricsurface");
    secondController.abort(); await secondRejected;
  } finally { compiler.dispose(); }
});

test("invalid geometry fails identically in worker and explicit direct fallback", async () => {
  const compiler = realCompiler();
  try {
    const bad = { objType: "editableMesh", topology: { vertices: [], faces: [{ id: "bad", vertices: ["missing", "b", "c"] }] } };
    await assert.rejects(compiler.compile(bad));
    await assert.rejects(createDirectGeometryCompiler().compile(bad));
    const valid = await compiler.compile(surface); assert.ok(valid.geometry); valid.geometry.dispose();
  } finally { compiler.dispose(); }
});

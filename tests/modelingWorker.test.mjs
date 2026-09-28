import { test } from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { compileModelingGraph, createWorkerModelingCompiler, attachModelingWorkerHost } from "../core/modeling/index.js";

const graph = { version: 1, nodes: [{ id: "b", operator: "primitive.box", params: { width: 3, heightSegments: 5 } }, { id: "d", operator: "mesh.deform", inputs: { mesh: { node: "b", output: "mesh" } }, params: { mode: "twist", amount: 0.5 } }], output: { node: "d", output: "mesh" } };
test("real worker matches CPU reference and transfers owned buffers without detaching cached results", async () => {
  const compiler = createWorkerModelingCompiler({ workerFactory() {
    const worker = new Worker(new URL("./fixtures/modelingWorkerNode.mjs", import.meta.url));
    return { postMessage: (value) => worker.postMessage(value), terminate: () => worker.terminate(), addEventListener: (type, fn) => worker.on(type, (data) => fn(type === "message" ? { data } : data)) };
  } });
  try {
    const expected = await compileModelingGraph(graph);
    const actual = await compiler.compile(graph); assert.deepEqual(actual.result, expected.result);
    const cached = await compiler.compile(graph); assert.deepEqual(cached.result, expected.result); assert.ok(cached.nodes.every((n) => n.status === "cached"));
  } finally { compiler.dispose(); }
});

test("abort terminates active computation and starts a replacement for queued jobs", async () => {
  const instances = [], controller = new AbortController();
  const compiler = createWorkerModelingCompiler({ workerFactory() {
    const listeners = new Map();
    const worker = { terminated: false, terminate() { this.terminated = true; }, addEventListener(t, fn) { listeners.set(t, fn); }, postMessage(data) { this.request = data; }, emit(data) { listeners.get("message")({ data }); } };
    instances.push(worker); queueMicrotask(() => worker.emit({ type: "ready" })); return worker;
  } });
  try {
    const first = compiler.compile(graph, { signal: controller.signal }), rejected = assert.rejects(first, { name: "AbortError" });
    const second = compiler.compile(graph);
    await new Promise((r) => setImmediate(r)); controller.abort(); await rejected;
    await new Promise((r) => setImmediate(r)); assert.equal(instances[0].terminated, true);
    instances[1].emit({ type: "result", id: instances[1].request.id, result: { success: true } });
    assert.deepEqual(await second, { success: true });
  } finally { compiler.dispose(); }
});

test("worker host disposal removes listeners and ignores already queued work", async () => {
  let listener; const messages = [];
  const host = attachModelingWorkerHost({ addEventListener: (_, fn) => { listener = fn; },
    removeEventListener: (_, fn) => { assert.equal(listener, fn); listener = null; }, postMessage: (m) => messages.push(m) });
  listener({ data: { type: "compile", id: 1, graph } }); host.dispose();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(listener, null); assert.deepEqual(messages, [{ type: "ready" }]);
});

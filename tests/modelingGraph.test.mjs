import assert from "node:assert/strict";
import { test } from "node:test";
import { createModelingCompiler, compileModelingGraph, createModelingOperatorRegistry, registerBuiltinModelingOperators,
  registerModelingOperator, getModelingOperatorManifest, validateModelingGraph } from "../core/modeling/index.js";

const ref = (node, output = "mesh") => ({ node, output });
const box = (id = "body", params = {}) => ({ id, operator: "primitive.box", params });
const graph = (nodes, output = ref(nodes.at(-1).id)) => ({ version: 1, nodes, output });

test("typed graph compiles parameters/units, produces an owned mesh, and reuses unaffected branches", async () => {
  const compiler = createModelingCompiler();
  const source = { ...graph([box("a", { width: { param: "width" } }), box("b"),
    { id: "both", operator: "mesh.merge", inputs: { meshes: [ref("a"), ref("b")] } }]), parameters: { width: { value: 200, unit: "cm" } } };
  try {
    const a = await compiler.compile(source);
    assert.equal(a.result.type, "mesh"); assert.equal(a.result.stats.triangles, 24);
    assert.equal(a.result.bounds.max[0], 1); assert.equal(a.nodes.filter((n) => n.status === "evaluating").length, 3);
    a.result.geometry.attributes.position.array.fill(123);
    const b = await compiler.compile(source); assert.ok(b.nodes.every((n) => n.status === "cached"));
    assert.notEqual(b.result.geometry.attributes.position.array[0], 123);
    source.parameters.width.value = 300;
    const c = await compiler.compile(source);
    assert.deepEqual(c.nodes.filter((n) => n.status === "evaluating").map((n) => n.nodeId), ["a", "both"]);
    assert.equal(c.result.bounds.max[0], 1.5);
    assert.equal(compiler.cacheSize, 3, "obsolete variants are released, not accumulated forever");
  } finally { compiler.dispose(); }
});

test("operator registry supports custom CPU functions and composable subgraphs", async () => {
  const registry = registerBuiltinModelingOperators(createModelingOperatorRegistry());
  let calls = 0;
  registerModelingOperator({ id: "custom.offset", version: 1, inputs: { mesh: "mesh" }, outputs: { mesh: "mesh" },
    parameters: { type: "object", properties: { distance: { type: "number", default: 1 } }, additionalProperties: false },
    backends: { cpu: ({ inputs, params }) => { calls++; const mesh = inputs.mesh; mesh.geometry.attributes.position.array[0] += params.distance; return { mesh }; } } }, registry);
  registerModelingOperator({ id: "custom.module", version: 1, inputs: {}, outputs: { mesh: "mesh" },
    parameters: { type: "object", properties: { width: { type: "number", default: 2 } } },
    graph: { version: 1, nodes: [box("base", { width: { param: "width" } }), { id: "end", operator: "custom.offset", inputs: { mesh: ref("base") } }], outputs: { mesh: ref("end") } } }, registry);
  const compiler = createModelingCompiler({ registry });
  try {
    const g = graph([{ id: "part", operator: "custom.module" }]);
    await compiler.compile(g); await compiler.compile(g); assert.equal(calls, 1);
    g.nodes[0].params = { width: 3 }; await compiler.compile(g); assert.equal(calls, 2);
    const manifest = getModelingOperatorManifest(registry);
    assert.equal(manifest.operators.find((o) => o.id === "custom.module").composite, true);
    assert.doesNotThrow(() => JSON.stringify(manifest));
  } finally { compiler.dispose(); }
});

test("graph rejects missing versions, incompatible ports, cycles and malformed parameters before publishing", async () => {
  assert.throws(() => validateModelingGraph({ version: 42, nodes: [] }), { code: "MODEL_GRAPH_VERSION" });
  assert.throws(() => validateModelingGraph(graph([{ id: "x", operator: "missing" }])), { code: "MODEL_OPERATOR_MISSING" });
  const curve = { id: "c", operator: "curve.polyline", params: { points: [[0, 0, 0], [1, 1, 1]] } };
  assert.throws(() => validateModelingGraph(graph([curve, { id: "x", operator: "mesh.transform", inputs: { mesh: ref("c", "curve") } }])), { code: "MODEL_PORT_TYPE" });
  assert.throws(() => validateModelingGraph(graph([{ id: "x", operator: "mesh.transform", inputs: { mesh: ref("x") } }])), { code: "MODEL_GRAPH_CYCLE" });
  await assert.rejects(compileModelingGraph(graph([box("bad", { width: -1 })])), { code: "OPERATOR_PARAMETERS" });
  await assert.rejects(compileModelingGraph(graph([box("bad", { misspelled: 5 })])), { code: "OPERATOR_PARAMETERS" });
  await assert.rejects(compileModelingGraph(graph([{ ...box(), backend: "gpu" }])), { code: "MODEL_BACKEND_UNAVAILABLE" });
});

test("custom output data contract, cancellation and failed evaluations never poison cache", async () => {
  const registry = createModelingOperatorRegistry(); let release;
  registerModelingOperator({ id: "deferred", version: 1, outputs: { points: "points" }, backends: { cpu: () => new Promise((resolve) => { release = resolve; }) } }, registry);
  const compiler = createModelingCompiler({ registry }), signal = new AbortController();
  const pending = compiler.compile(graph([{ id: "p", operator: "deferred" }], ref("p", "points")), { signal: signal.signal });
  while (!release) await new Promise((r) => setImmediate(r));
  signal.abort(); release({ points: { type: "points", positions: [] } });
  await assert.rejects(pending, { name: "AbortError" }); assert.equal(compiler.cacheSize, 0); compiler.dispose();
  await assert.rejects(compiler.compile({ version: 1, nodes: [] }), { code: "MODEL_COMPILER_DISPOSED" });
});

test("instances remain compact until explicitly realized; deformation preserves UVs and groups", async () => {
  const nodes = [box("base", { heightSegments: 8 }), { id: "twist", operator: "mesh.deform", inputs: { mesh: ref("base") }, params: { mode: "twist", amount: 1 } },
    { id: "copies", operator: "mesh.array", inputs: { mesh: ref("twist") }, params: { count: 5, offset: [2, 0, 0] } }];
  const compact = await compileModelingGraph(graph(nodes, ref("copies", "instances")));
  assert.equal(compact.result.transforms.length, 5);
  const realized = await compileModelingGraph(graph([...nodes, { id: "bake", operator: "instances.realize", inputs: { instances: ref("copies", "instances") } }]));
  assert.equal(realized.result.stats.vertices, compact.result.mesh.stats.vertices * 5);
  assert.ok(realized.result.geometry.attributes.uv); assert.equal(realized.result.provenance.faceRanges.length, 5);
});

test("curves/surfaces/fields compile through explicitly typed tessellation operations", async () => {
  const surface = await compileModelingGraph(graph([{ id: "s", operator: "surface.parametric", params: { expressions: { x: "u", y: "sin(u*3)*cos(v*3)", z: "v" } } },
    { id: "mesh", operator: "surface.tessellate", inputs: { surface: ref("s", "surface") }, params: { uSegments: 8, vSegments: 8 } }]));
  assert.equal(surface.result.stats.vertices, 81);
  const implicit = await compileModelingGraph(graph([{ id: "f", operator: "field.sphere" }, { id: "mesh", operator: "field.mesh", inputs: { field: ref("f", "field") }, params: { bounds: { min: [-1.2, -1.2, -1.2], max: [1.2, 1.2, 1.2] }, resolution: 8 } }]));
  assert.ok(implicit.result.stats.triangles > 100);
});

test("cache identity preserves semantic nodes and invalidates consumers of re-registered composite children", async () => {
  const registry = registerBuiltinModelingOperators(createModelingOperatorRegistry());
  const points = (x) => ({ id: "custom.points", version: 1, outputs: { points: "points" }, backends: { cpu: () => ({ points: { type: "points", positions: [[x, 0, 0]] } }) } });
  let unregister = registry.register(points(1));
  registry.register({ id: "custom.nested", version: 1, outputs: { points: "points" }, graph: { version: 1, nodes: [{ id: "p", operator: "custom.points" }], outputs: { points: ref("p", "points") } } });
  const compiler = createModelingCompiler({ registry });
  try {
    const source = graph([box("a"), box("b"), { id: "merged", operator: "mesh.merge", inputs: { meshes: [ref("a"), ref("b")] } }]);
    const mesh = (await compiler.compile(source)).result;
    assert.deepEqual(mesh.provenance.faceRanges.map((r) => r.source), ["a", "b"]);
    const nested = graph([box("a"), { id: "p", operator: "custom.nested" }, { id: "copies", operator: "points.instance", inputs: { mesh: ref("a"), points: ref("p", "points") } }], ref("copies", "instances"));
    const first = await compiler.compile(nested); assert.equal(first.result.transforms[0][12], 1);
    unregister(); unregister = registry.register(points(3));
    const second = await compiler.compile(nested); assert.equal(second.result.transforms[0][12], 3);
    assert.ok(second.nodes.some((n) => n.nodeId === "copies" && n.status === "evaluating"));
  } finally { unregister(); compiler.dispose(); }
});

test("automatic GPU fallback is explicit in diagnostics; an explicitly requested GPU never silently changes backend", async () => {
  const registry = createModelingOperatorRegistry();
  registry.register({ id: "custom.accelerated", version: 1, outputs: { points: "points" }, backends: {
    cpu: () => ({ points: { type: "points", positions: [[1, 2, 3]] } }),
    gpu: () => { throw Object.assign(new Error("Device buffer limit"), { code: "MODEL_GPU_LIMIT" }); }
  } });
  const source = graph([{ id: "p", operator: "custom.accelerated" }], ref("p", "points"));
  const result = await compileModelingGraph(source, { registry, context: { gpu: {} } });
  assert.equal(result.diagnostics[0].code, "MODEL_BACKEND_FALLBACK"); assert.equal(result.nodes.at(-1).backend, "cpu");
  await assert.rejects(compileModelingGraph(source, { registry, context: { gpu: {} }, backend: "gpu" }), { code: "MODEL_GPU_LIMIT" });
});

test("composites can forward multiple typed inputs without flattening artifacts into JSON source", async () => {
  const registry = registerBuiltinModelingOperators(createModelingOperatorRegistry());
  registry.register({ id: "custom.join", version: 1, inputs: { pieces: { type: "mesh", multiple: true } }, outputs: { mesh: "mesh" },
    graph: { version: 1, nodes: [{ id: "join", operator: "mesh.merge", inputs: { meshes: { input: "pieces" } } }], outputs: { mesh: ref("join") } } });
  const result = await compileModelingGraph(graph([box("a"), box("b"), { id: "parts", operator: "custom.join", inputs: { pieces: [ref("a"), ref("b")] } }]), { registry });
  assert.equal(result.result.stats.triangles, 24);
});

test("merging respects source draw ranges and material groups instead of exposing hidden triangles", async () => {
  const raw = { attributes: { position: { array: [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0], itemSize: 3 } }, index: [0, 1, 2, 1, 3, 2],
    drawRange: { start: 3, count: 3 }, groups: [{ start: 0, count: 3, materialIndex: 0 }, { start: 3, count: 3, materialIndex: 1 }] };
  const result = await compileModelingGraph(graph([{ id: "a", operator: "mesh.raw", params: { geometry: raw } },
    { id: "merged", operator: "mesh.merge", inputs: { meshes: [ref("a"), ref("a")] } }]));
  assert.equal(result.result.stats.triangles, 2);
  assert.deepEqual(result.result.geometry.groups, [{ start: 0, count: 3, materialIndex: 1 }, { start: 3, count: 3, materialIndex: 1 }]);
});

test("deformation interprets normalized integer positions in their rendered coordinates", async () => {
  const result = await compileModelingGraph(graph([{ id: "raw", operator: "mesh.raw", params: { geometry: { attributes: { position: {
    array: [0, 0, 0, 255, 0, 0, 0, 255, 0], itemSize: 3, type: "Uint8Array", normalized: true
  } } } } }, { id: "shape", operator: "mesh.deform", inputs: { mesh: ref("raw") }, params: { mode: "twist", amount: 0 } }]));
  assert.deepEqual([...result.result.geometry.attributes.position.array], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
});

test("polyline loft preserves straight profiles instead of introducing unrequested Catmull-Rom overshoot", async () => {
  const points = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];
  const result = await compileModelingGraph(graph([
    { id: "a", operator: "curve.polyline", params: { points, closed: true } },
    { id: "b", operator: "curve.polyline", params: { points: points.map(([x, y]) => [x, y, 2]), closed: true } },
    { id: "loft", operator: "curve.loft", inputs: { sections: [ref("a", "curve"), ref("b", "curve")] }, params: { segments: 32 } }
  ]));
  assert.deepEqual(result.result.bounds, { min: [0, 0, 0], max: [1, 1, 2] });
});

test("rational NURBS tessellation retains weighted circular geometry", async () => {
  const ring = [[1, 0, 0, 1], [1, 1, 0, Math.SQRT1_2], [0, 1, 0, 1]];
  const result = await compileModelingGraph(graph([
    { id: "s", operator: "surface.nurbs", params: { controlPoints: [ring, ring.map(([x, y, , w]) => [x, y, 2, w])], degreeU: 2, degreeV: 1,
      knotsU: [0, 0, 0, 1, 1, 1], knotsV: [0, 0, 1, 1] } },
    { id: "m", operator: "surface.tessellate", inputs: { surface: ref("s", "surface") }, params: { uSegments: 8, vSegments: 2 } }
  ]));
  const positions = result.result.geometry.attributes.position.array;
  for (let i = 0; i < positions.length; i += 3) assert.ok(Math.abs(Math.hypot(positions[i], positions[i + 1]) - 1) < 1e-6);
});

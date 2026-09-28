[中文](../zh/modeling.md) | [English](./modeling.md)

# Computable modeling: parameters, operators and source models

Friendly JSON, standard JSON, unrestricted `bufferMesh` coordinates and `editableMesh` control cages remain available. A new `modeledMesh` stores parameters, dependencies and modeling operations, then computes triangles locally. **The computed mesh is not a second authoritative scene.** Edits, saving and undo retain the graph; only an explicit bake replaces it with coordinates.

Simple cubes do not need a modeling graph. Operators are not a closed catalog of object templates: applications can use built-ins, register implementations, or package a subgraph as a reusable operator. Directly supplying dense coordinates remains supported, without a default engine vertex limit.

## A parameterized object

Put the same object in `worldInfo.modelList` (friendly) or `objectList` (standard):

```json
{
  "objType": "modeledMesh", "threeJsonId": "column",
  "material": { "type": "standard", "color": "#c38b4c", "roughness": 0.3 },
  "modeling": {
    "version": 1,
    "parameters": { "height": { "value": 200, "unit": "cm" }, "twist": 0.8 },
    "nodes": [
      { "id": "body", "operator": "primitive.box", "version": 1, "part": "body",
        "params": { "width": 0.4, "depth": 0.4, "height": { "param": "height" }, "heightSegments": 64 } },
      { "id": "shape", "operator": "mesh.deform", "version": 1,
        "inputs": { "mesh": { "node": "body", "output": "mesh" } },
        "params": { "mode": "twist", "amount": { "param": "twist" } } }
    ],
    "output": { "node": "shape", "output": "mesh" }
  }
}
```

Load it through asynchronous `createJsonScene()` or `createRuntimeSceneSession()`. Synchronous deployment cannot wait for computation. The scene loader detects modeled objects and loads the capability on demand. Ordinary scenes do not load CAD, the GPU modeling adapter or a modeling Worker.

Quantity parameters reuse the existing `design` unit/expression resolver: lengths default to meters and angles to radians. An explicit `modeling.units.length` changes the length target for parameter expressions and must match the host's scene coordinate units. Bare operator values use that operator's units. Twist is radians per length, bend is curvature, taper is a linear slope. `modeling.units` does not implicitly rescale coordinate arrays; CAD operators always require meters.

See the [interactive parameter/undo/bake/GPU demo](../../examples/html-demo/track-01-geometry/01-09-computable-modeling.html) and the “Computable modeling” website examples section.

## Contracts and built-ins

`getModelingOperatorManifest()` from `threejson/modeling` returns actual registered versions, typed ports, parameters and backends. The AI and inspector consume this contract. Parameter validation implements `type / properties / required / additionalProperties / enum / minimum / exclusiveMinimum / maximum / items / minItems / maxItems / default`, not the entire JSON Schema specification.

| Family | Implemented operators |
| --- | --- |
| Mesh | `primitive.box/sphere/cylinder/torus`, `mesh.raw/editable/transform/deform/merge/array` |
| Curve/surface | `curve.polyline/bezier/sweep/loft/revolve`, `surface.parametric/bezier/nurbs/tessellate` |
| Field | `field.sphere/box/combine/mesh` |
| Points/instances | `points.explicit/instance`, `instances.realize` |
| Exact solid (optional) | `cad.box/cylinder/sphere/boolean/fillet/chamfer/shell/extrude/revolve/loft/sweep/transform/tessellate` |

Port types are `mesh / curve / surface / solid / field / points / instances`. Missing operators, unknown versions, cycles and incompatible connections produce errors with `code` and `nodeId`, never placeholder cubes. Use `outputs` for multiple outputs. A scene uses the `result` output, or the first output when absent; that output must be a mesh. Tessellate solids/surfaces and realize instances explicitly.

`mesh.raw` accepts the existing BufferGeometry contract, including custom vertex attributes, UVs, groups, drawRange, morphs and binary references. Binary references use the scene resource policy, including `.tjz` offline packing. Deformation preserves UV/custom vertex attributes and recomputes normals/tangents. Unsupported rigged/morph deformations fail explicitly; ordinary object transforms are unaffected. Merge requires compatible attribute layouts and preserves visible draw ranges and material groups; it is not a boolean union.

## Custom and composite operators

```js
import {
  createModelingOperatorRegistry, registerBuiltinModelingOperators,
  registerModelingOperator, createModelingCompiler
} from "threejson/modeling";
const registry = registerBuiltinModelingOperators(createModelingOperatorRegistry());
registerModelingOperator({
  id: "studio.points", version: 1, inputs: {}, outputs: { points: "points" },
  parameters: { type: "object", properties: { span: { type: "number", default: 2 } }, additionalProperties: false },
  backends: { cpu: ({ params }) => ({ points: {
    type: "points", positions: [[0, 0, 0], [params.span, 0, 0]]
  } }) }
}, registry);
registerModelingOperator({
  id: "studio.twistedBox", version: 1, inputs: {}, outputs: { mesh: "mesh" },
  parameters: { type: "object", properties: { amount: { type: "number", default: 0.5 } } },
  graph: { version: 1, nodes: [
    { id: "base", operator: "primitive.box", params: { heightSegments: 32 } },
    { id: "twist", operator: "mesh.deform",
      inputs: { mesh: { node: "base", output: "mesh" } },
      params: { mode: "twist", amount: { param: "amount" } } }
  ], outputs: { mesh: { node: "twist", output: "mesh" } } }
}, registry);
const compiler = createModelingCompiler({ registry });
try {
  const result = await compiler.compile({ version: 1,
    nodes: [{ id: "part", operator: "studio.twistedBox", params: { amount: 0.8 } }],
    output: { node: "part", output: "mesh" }
  });
} finally { compiler.dispose(); }
```

Composite graphs reference external ports using `{ "input": "portName" }`, including multiple inputs. Implementations receive `inputs / params / signal / quality / context / nodeId` and return port-named serializable artifacts. Do not return Object3D, WASM handles or closures. Implementations should be deterministic; random algorithms need a seed, and external state changes need `contextKey`/`context.cacheKey` to invalidate cached results.

Scene hosts pass `modelingRegistry` and `modelingContext`. `createRuntimeSceneSession` also forwards them to command execution. Default-registry registration is supported. Duplicate ID/version registration fails; use a new version or explicitly call the returned unregister function. Saved JSON refers to operator IDs and versions, **not embedded or automatically downloaded JavaScript**. Recipients must register the same implementations, or receive a baked mesh instead. Code trust and execution policies belong to the host.

## Incremental compilation, workers and GPU

Cache identity includes the implementation, node identity, parameters, input fingerprints, backend, quality and context key. Only affected branches recompute. Caches belong to compilers/scenes, not process-global chats. Ownership copies prevent runtime disposal or mutations to returned arrays from corrupting cached data.

- `createWorkerModelingCompiler()` lazily starts a self-contained Worker with a serial queue. Canceling active computation terminates/restarts the Worker; queued jobs survive. A scene host already opting into `geometryCompiler` can use this path for built-in graphs.
- Register custom operators/kernels in a custom Worker and call `attachModelingWorkerHost()`, then inject `workerFactory`. Functions cannot be structured-cloned into a Worker. Graphs requiring a runtime binary resolver currently compute on the main thread rather than claiming to be offloaded.
- An AbortSignal cannot interrupt synchronous WASM on the same thread. Use a Worker for hard cancellation and WASM memory isolation. Compiler/provider disposal clears owned state; terminating the Worker releases the entire WASM instance.
- No fixed vertex, graph-node or execution-time budget is imposed by the engine. Actual device/memory constraints can fail computation. Host budgets must not silently truncate geometry.

GPU modeling is independent of the scene renderer. Only twist/taper/bend currently have GPU implementations; other operators stay on CPU:

```js
import { createModelingCompiler } from "threejson/modeling";
import { createWebgpuModelingBackend } from "threejson/modeling-webgpu";
const gpu = await createWebgpuModelingBackend(); // null when unavailable
const compiler = createModelingCompiler({ context: gpu ? { gpu } : {} });
try { const result = await compiler.compile(graph); }
finally { compiler.dispose(); gpu?.dispose(); }
```

`backend:"auto"` chooses GPU only when the host supplied one and the operator supports it. Recoverable device/limit failures fall back to CPU with a `MODEL_BACKEND_FALLBACK` diagnostic. Explicit `backend:"gpu"` fails instead of silently changing backend. Numerical parity is approximate, not bit-for-bit; normal/tangent processing remains on CPU.

## Optional exact CAD and STEP

This adapter uses actual OpenCascade through replicad. Solid artifacts contain BREP; preview triangles are a separate output.

```sh
npm install replicad@^1.1.0 replicad-opencascadejs@^1.1.0
```

```js
import { createModelingOperatorRegistry, registerBuiltinModelingOperators, createModelingCompiler } from "threejson/modeling";
import { createOpenCascadeModelingProvider, registerCadModelingOperators } from "threejson/modeling-cad";
const registry = registerBuiltinModelingOperators(createModelingOperatorRegistry());
const provider = await createOpenCascadeModelingProvider({ wasmUrl: "/vendor/replicad_single.wasm" });
const unregister = registerCadModelingOperators(provider, registry);
const compiler = createModelingCompiler({ registry });
try {
  const result = await compiler.compile({ version: 1, nodes: [
    { id: "block", operator: "cad.box", params: { size: [0.1, 0.08, 0.04] } },
    { id: "preview", operator: "cad.tessellate",
      inputs: { solid: { node: "block", output: "solid" } }, params: { tolerance: 0.0001 } }
  ], outputs: {
    result: { node: "preview", output: "mesh" }, solid: { node: "block", output: "solid" }
  } });
  const stepBlob = await provider.exportSTEP(result.outputs.solid, { unit: "MM", name: "block" });
} finally { compiler.dispose(); unregister(); provider.dispose(); }
```

Deploy the matching WASM from your installed version, or pass `wasmBinary`/initialized `oc`; no CDN is chosen by the engine. Internal units are meters, with explicit STEP output units. Replicad selects its kernel at module scope: serialize use within a Worker, not concurrent access to one native instance. Distributors must review the licenses of replicad (MIT), replicad-opencascadejs (LGPL-2.1-only) and their dependencies.

Selectors support planes/offsets, edge directions and boxes. OCCT face indices are **not persistent topology names**. This extension is not a full sketch/assembly constraint solver or CAM system. STEP is a host API, not a new generic Editor export-menu entry. CAD failures leave the previous scene intact and do not substitute approximate primitives.

## Commands, AI and Editor

| Command | Purpose |
| --- | --- |
| `model.operators` | Registered contracts; optional id/category filter |
| `model.inspect` | Revision, nodes, connections, parameter names and object pose; optional nodeId/includeParameters |
| `model.evaluate` | Statistics, bounds and diagnostics; dense data only with includeArtifact |
| `model.patch` | Atomic RFC6902 graph update; baseRevision required |
| `model.bake` | Undoable bufferMesh conversion, preserving object identity/materials/transform |

```js
import { executeSceneSessionCommands } from "threejson/session";
await executeSceneSessionCommands(session, [{ op: "model.patch", args: {
  id: "column", baseRevision: 0,
  patch: [{ op: "replace", path: "/parameters/twist", value: 1.1 }]
} }]);
```

New geometry is built before an atomic swap. Failure retains document, history and viewport. Incremental updates preserve Object3D, materials, parent and ID. The Editor exposes graph parameters, node parameter JSON, revision and bake through its existing undo/redo transaction system.

When scene `design.bindings` control graph parameters, inspect returns authored values, bindings and evaluated values. Edit the design parameter instead of silently overriding its bound field with model.patch. Evaluate/bake use the bound values; bake atomically removes consumed graph bindings, preserves pose/material bindings, and restores them on undo. Binary input cache identity includes content and data type, not just its URL.

The `modelingGraph` AI capability loads contracts on demand, supports scoped queries and `model.patch`, and avoids re-sending generated triangle arrays for each edit. Moving a model should use an object transform. Simple shapes can still use simple JSON. Repeated/no-change AI refinement now reports an incomplete result and retains the scene instead of presenting a false completion. None of this proves that every LLM reliably produces production-quality vehicles or characters: representational capacity, reasoning and artistic quality require separate evaluation.

## Validation, packaging and honest limits

```sh
node --test --test-concurrency=1 tests/modelingGraph.test.mjs tests/modelingSession.test.mjs tests/modelingWorker.test.mjs tests/modelingCad.test.mjs
npm run build:geometry-worker
npm run validate:demo-catalog
npm run release:check
```

The CAD test uses a real optional kernel; without it, the test is explicitly skipped, not passed. The HTML demo provides a real GPU/CPU numerical comparison; unavailable GPU is reported as unavailable. `prepack` builds the self-contained modeling Worker and the package must include `core/modeling/modeling.worker.bundle.js`. See [npm release instructions](../dev/npm-release.md).

Implemented: typed/versioned operators, composable extensions, incremental/Worker evaluation, graph commands, optional GPU/exact CAD and host integration. Not claimed complete: a visual node editor, a universal point/edge/face/corner attribute propagation system, persistent face naming across topology edits, general adaptive error-based tessellation, full CAD constraints, automatic game-asset optimization or guaranteed industrial-quality AI output. Existing control-mesh modifier limits still apply. These can evolve on the same contract without replacing all scene JSON again.

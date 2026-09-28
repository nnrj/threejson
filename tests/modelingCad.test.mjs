import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createOpenCascadeModelingProvider, registerCadModelingOperators } from "../extensions/modeling-cad/index.js";
import { createModelingOperatorRegistry, registerBuiltinModelingOperators, compileModelingGraph } from "../core/modeling/index.js";

let r, init, wasmBinary;
try {
  r = await import("replicad"); init = (await import("replicad-opencascadejs")).default;
  wasmBinary = await readFile(new URL(import.meta.resolve("replicad-opencascadejs/wasm")));
} catch {
  try {
    r = await import("../.cache/cad/node_modules/replicad/dist/replicad.js");
    init = (await import("../.cache/cad/node_modules/replicad-opencascadejs/dist/replicad_single.js")).default;
    wasmBinary = await readFile(new URL("../.cache/cad/node_modules/replicad-opencascadejs/dist/replicad_single.wasm", import.meta.url));
  } catch { /* Optional CAD kernel is intentionally not installed by ordinary users. */ }
}

test("real OCCT boolean, fillet, mesh preview and STEP export retain exact solid source", { skip: !wasmBinary && "Install optional replicad / replicad-opencascadejs to run real CAD tests" }, async () => {
  const provider = await createOpenCascadeModelingProvider({ replicad: r, initOpenCascade: init, wasmBinary });
  const registry = registerBuiltinModelingOperators(createModelingOperatorRegistry());
  const unregister = registerCadModelingOperators(provider, registry);
  const nodes = [
    { id: "body", operator: "cad.box", params: { size: [2, 2, 1] } },
    { id: "round", operator: "cad.fillet", params: { radius: 0.1 }, inputs: { solid: { node: "body", output: "solid" } } },
    { id: "tool", operator: "cad.cylinder", params: { radius: 0.3, height: 2, origin: [1, 1, -0.5] } },
    { id: "cut", operator: "cad.boolean", params: { operation: "subtract" }, inputs: { a: { node: "round", output: "solid" }, b: { node: "tool", output: "solid" } } },
    { id: "preview", operator: "cad.tessellate", inputs: { solid: { node: "cut", output: "solid" } } }
  ];
  try {
    const solid = (node) => ({ node, output: "solid" });
    const cases = [
      { name: "extrude", nodes: [{ id: "result", operator: "cad.extrude", params: { profile: { type: "rectangle", width: 2, height: 3 }, distance: 4 } }], volume: 24 },
      { name: "revolve", nodes: [{ id: "result", operator: "cad.revolve", params: { profile: { type: "rectangle", width: 1, height: 2, origin: [2, 0, 0] } } }], volume: Math.PI * 8 },
      { name: "loft", nodes: [{ id: "result", operator: "cad.loft", params: { profiles: [{ type: "rectangle", width: 2, height: 2 }, { type: "rectangle", width: 2, height: 2, origin: [0, 0, 3] }] } }], volume: 12 },
      { name: "sweep", nodes: [{ id: "result", operator: "cad.sweep", params: { profile: { type: "circle", radius: 0.5 }, path: [[0, 0, 0], [0, 0, 3]] } }], volume: Math.PI * 0.75 },
      { name: "shell", nodes: [{ id: "box", operator: "cad.box", params: { size: [2, 2, 2] } }, { id: "result", operator: "cad.shell", inputs: { solid: solid("box") }, params: { thickness: -0.1, selector: { plane: "XY", offset: 2 } } }] },
      { name: "chamfer", nodes: [{ id: "box", operator: "cad.box", params: { size: [2, 2, 2] } }, { id: "result", operator: "cad.chamfer", inputs: { solid: solid("box") }, params: { distance: 0.1, selector: { plane: "XY", offset: 2 } } }] },
      { name: "transform", nodes: [{ id: "sphere", operator: "cad.sphere" }, { id: "result", operator: "cad.transform", inputs: { solid: solid("sphere") }, params: { scale: 2, angle: Math.PI / 4, position: [1, 2, 3] } }], volume: Math.PI * 32 / 3 }
    ];
    for (const item of cases) {
      const result = await compileModelingGraph({ version: 1, nodes: item.nodes, output: solid("result") }, { registry });
      assert.ok(result.result.stats.volume > 0, item.name);
      if (item.volume) assert.ok(Math.abs(result.result.stats.volume - item.volume) < 1e-6, `${item.name}: ${result.result.stats.volume} != ${item.volume}`);
    }
    const result = await compileModelingGraph({ version: 1, nodes, outputs: { solid: { node: "cut", output: "solid" }, mesh: { node: "preview", output: "mesh" } } }, { registry });
    assert.ok(result.outputs.solid.stats.volume > 3 && result.outputs.solid.stats.volume < 4);
    assert.ok(result.outputs.mesh.stats.triangles > 100);
    assert.ok(result.outputs.solid.brep.length > 1000);
    const step = await (await provider.exportSTEP(result.outputs.solid)).text();
    assert.match(step, /ISO-10303-21/); assert.match(step, /MANIFOLD_SOLID_BREP/); assert.match(step, /END-ISO-10303-21/);
    // Export is a genuine re-importable solid, not triangles renamed to .step.
    r.getOC().Interface_Static.SetCVal("xstep.cascade.unit", "MM");
    const imported = await r.importSTEP(new Blob([step]));
    try { assert.ok(Math.abs(r.measureVolume(imported) / 1e9 - result.outputs.solid.stats.volume) < 1e-6, `STEP volume ${r.measureVolume(imported)} mm^3, source ${result.outputs.solid.stats.volume} m^3`); }
    finally { imported.delete(); }
  } finally { unregister(); provider.dispose(); }
});

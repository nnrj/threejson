import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { createRuntimeSceneSession } from "../core/session.js";
import { buildAgentCapabilityIndex } from "../core/ai/sceneCapabilityIndex.js";
import { createModelingOperatorRegistry, registerBuiltinModelingOperators } from "../core/modeling/index.js";

const root = path.resolve(import.meta.dirname, "..");
function staticGraph(entry) {
  const local = new Set(), bare = new Set(), pending = [path.join(root, entry)];
  while (pending.length) {
    const file = pending.pop(); if (local.has(file)) continue; local.add(file);
    const source = fs.readFileSync(file, "utf8").replace(/`(?:\\[\s\S]|[^\\`])*`/g, '""')
      .replace(/^[ \t]*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const match of source.matchAll(/^[ \t]*(?:import\s+(?:[^"'()]*?\s+from\s*)?|export\s+(?:\*|\{[\s\S]*?\})\s+from\s*)["']([^"']+)["']/gm)) {
      if (match[1].startsWith(".")) pending.push(path.resolve(path.dirname(file), match[1])); else bare.add(match[1]);
    }
  }
  return { local: [...local].map((file) => path.relative(root, file).replaceAll("\\", "/")), bare: [...bare] };
}

test("ordinary entries keep modeling evaluation, GPU, CAD and workers outside their static imports", () => {
  for (const entry of ["builtins/full.js", "core/index.js", "core/runtime.js"]) {
    const { local, bare } = staticGraph(entry);
    assert.ok(!local.some((file) => /core\/modeling\/|extensions\/modeling-/.test(file)), `${entry} eagerly imports modeling`);
    assert.ok(!bare.some((id) => /replicad|opencascade|three\/webgpu|three\/tsl/.test(id)));
  }
  const modeling = staticGraph("core/modeling/index.js");
  assert.ok(!modeling.local.some((file) => /meshOperators|extensions\/|sceneCapability/.test(file)));
  assert.ok(!modeling.bare.some((id) => /replicad|opencascade/.test(id)));
});

test("self-contained geometry workers do not bundle an unused WebGL renderer", () => {
  for (const file of ["core/geometry/geometry.worker.bundle.js", "core/modeling/modeling.worker.bundle.js"]) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(source, /WebGLRenderer:|Error creating WebGL context/);
  }
});

test("a plain cube does not request modeling services, a WASM kernel or a worker", async () => {
  const fetch = globalThis.fetch, worker = globalThis.Worker; let requests = 0, workers = 0;
  globalThis.fetch = () => { requests++; throw new Error("Unexpected network access"); };
  globalThis.Worker = class { constructor() { workers++; throw new Error("Unexpected Worker"); } };
  let session;
  try {
    session = await createRuntimeSceneSession({ objectList: [{ objType: "box", threeJsonId: "cube", geometry: { width: 1, height: 1, depth: 1 }, material: { type: "standard", color: "#ffffff" } }] });
    assert.equal(requests, 0); assert.equal(workers, 0);
  } finally { session?.dispose(); globalThis.fetch = fetch; if (worker === undefined) delete globalThis.Worker; else globalThis.Worker = worker; }
});

test("modeling public subpaths and optional CAD peers are declared without default kernel dependencies", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  for (const subpath of ["modeling", "modeling-cad", "modeling-webgpu"]) assert.ok(fs.existsSync(path.join(root, pkg.exports[`./${subpath}`])));
  for (const dependency of ["replicad", "replicad-opencascadejs"]) {
    assert.equal(pkg.dependencies?.[dependency], undefined);
    assert.equal(pkg.optionalDependencies?.[dependency], undefined);
    assert.equal(pkg.peerDependenciesMeta[dependency].optional, true);
  }
});

test("AI learns actual registered operators only when modeling is selected, not fictitious CAD support", () => {
  const basic = buildAgentCapabilityIndex(), selected = buildAgentCapabilityIndex({ selectedCapabilityIds: ["modelingGraph"] });
  assert.doesNotMatch(basic, /"id":"primitive.box"/);
  assert.match(selected, /"id":"mesh.deform"/); assert.match(selected, /model\.patch/);
  assert.doesNotMatch(selected, /"id":"cad.box"/);
  const registry = registerBuiltinModelingOperators(createModelingOperatorRegistry());
  registry.register({ id: "studio.custom", version: 1, outputs: { points: "points" }, backends: { cpu: () => ({ points: { type: "points", positions: [] } }) } });
  assert.match(buildAgentCapabilityIndex({ selectedCapabilityIds: ["modelingGraph"], modelingRegistry: registry }), /"id":"studio.custom"/);
  assert.doesNotMatch(selected, /"id":"studio.custom"/);
});

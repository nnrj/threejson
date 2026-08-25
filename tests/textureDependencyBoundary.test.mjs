import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { createBox } from "../core/builder/modelBuilder.js";
import { runSceneTexturePipeline } from "../core/texture/index.js";

const repoRoot = path.resolve(import.meta.dirname, "..");

test("threejson root/core entries do not statically load AI or service adapters", () => {
  const coreIndex = fs.readFileSync(path.join(repoRoot, "core/index.js"), "utf8");
  const fullEntry = fs.readFileSync(path.join(repoRoot, "builtins/full.js"), "utf8");
  assert.doesNotMatch(coreIndex, /core\/ai|\.\/ai\//);
  assert.doesNotMatch(fullEntry, /core\/ai|\.\/ai\//);
  assert.doesNotMatch(coreIndex, /from\s+["'][^"']*(?:webgpu|tslCode|particlesRaster|webglAdvancedPasses|extraControls)/i);
  assert.doesNotMatch(fullEntry, /(?:webgpu|tsl-code|particles-raster|postprocessing-webgl|controls-extra)/i);
  for (const file of [
    "core/texture/textureSlots.js",
    "core/texture/textureProvider.js",
    "core/texture/sceneTexturePipeline.js",
    "core/texture/runtimeTextureAssignment.js"
  ]) {
    const source = fs.readFileSync(path.join(repoRoot, file), "utf8");
    assert.doesNotMatch(source, /polyhaven|openverse|threebox-server/i, `${file} leaked a service adapter`);
  }
});

test("optional renderer and particle adapters stay behind dynamic capability loading", () => {
  const optionalLoader = fs.readFileSync(path.join(repoRoot, "core/capabilities/optionalCapabilityLoader.js"), "utf8");
  assert.match(optionalLoader, /import\("\.\.\/builder\/postprocess\/webglAdvancedPasses\.js"\)/);
  assert.match(optionalLoader, /import\("\.\.\/builder\/particle\/particlesRaster\.js"\)/);
  assert.match(optionalLoader, /import\("\.\.\/builder\/controls\/extraControls\.js"\)/);
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  assert.equal(pkg.exports["./webgpu"], "./webgpu/index.js");
  assert.equal(pkg.exports["./particles-raster"], "./core/builder/particle/particlesRaster.js");
});

test("published ThreeJSON dependency graph contains no texture search/generation/storage package", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const graph = JSON.stringify({
    dependencies: pkg.dependencies,
    peerDependencies: pkg.peerDependencies,
    optionalDependencies: pkg.optionalDependencies
  }).toLowerCase();
  assert.equal(graph.includes("polyhaven"), false);
  assert.equal(graph.includes("openverse"), false);
  assert.equal(graph.includes("r2"), false);
  assert.equal(graph.includes("image-generation"), false);
});

test("creating a plain cube performs no texture network request", () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests += 1; throw new Error("unexpected network request"); };
  try {
    const cube = createBox({
      threeJsonId: "plain-cube",
      objType: "box",
      geometry: { width: 1, height: 1, depth: 1 },
      material: { type: "standard", color: "#3366ff" }
    });
    assert.equal(cube?.isMesh, true);
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the texture pipeline is inert when no textureProvider is injected", async () => {
  let plannerCalls = 0;
  const result = await runSceneTexturePipeline({
    threeJsonId: "plain",
    objectList: [{ threeJsonId: "cube", objType: "box", material: { color: "#fff" } }]
  }, {
    planner: async () => { plannerCalls += 1; return { tasks: [] }; }
  });
  assert.equal(result.skipped, "provider_not_configured");
  assert.equal(plannerCalls, 0);
});

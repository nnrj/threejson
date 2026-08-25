import assert from "node:assert/strict";
import { test } from "node:test";

test("optional particle raster entry can load before core/index", async () => {
  await import("../core/builder/particle/particlesRaster.js");
  const core = await import("../core/index.js");
  assert.equal(typeof core.createJsonScene, "function");
  assert.equal(typeof core.trackDisposableResource, "function");
  assert.equal(typeof core.disposeTrackedResources, "function");
});

test("deep particleEmitterBuilder import does not throw TDZ", async () => {
  const mod = await import("../core/builder/particle/particleEmitterBuilder.js");
  assert.equal(typeof mod.deployParticleEmitter, "function");
});

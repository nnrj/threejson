import assert from "node:assert/strict";
import { test } from "node:test";

test("extension before core: particle-nebula then core/index does not throw on module load", async () => {
  await import("../extensions/particle-nebula/index.js");
  const core = await import("../core/index.js");
  assert.equal(typeof core.createJsonScene, "function");
  assert.equal(typeof core.trackDisposableResource, "function");
  assert.equal(typeof core.disposeTrackedResources, "function");
});

test("deep particleEmitterBuilder import does not throw TDZ", async () => {
  const mod = await import("../core/builder/particle/particleEmitterBuilder.js");
  assert.equal(typeof mod.deployParticleEmitter, "function");
});

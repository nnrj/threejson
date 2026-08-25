import test from "node:test";
import assert from "node:assert/strict";
import { ensureOptionalSceneCapabilitiesForPayload, sceneUsesRasterParticleSource } from "../core/capabilities/optionalCapabilityLoader.js";
import { getParticleSourceSampler } from "../core/builder/particle/particleSourceSampler.js";
import { getSceneCapability } from "../core/capabilities/sceneCapabilityManifest.js";

test("raster particle support stays optional until a raster source is requested", async () => {
  assert.equal(sceneUsesRasterParticleSource({ objectList: [{ objType: "particleEmitter", source: { type: "box" } }] }), false);
  const payload = { objectList: [{ objType: "particleEmitter", source: { type: "textMask" } }] };
  assert.equal(sceneUsesRasterParticleSource(payload), true);
  await ensureOptionalSceneCapabilitiesForPayload(payload);
  assert.equal(typeof getParticleSourceSampler("textMask"), "function");
  assert.equal(getSceneCapability("particleSources", "textMask").status, "stable");
});

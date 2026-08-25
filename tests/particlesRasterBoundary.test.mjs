import test from "node:test";
import assert from "node:assert/strict";
import { ensureOptionalSceneCapabilitiesForPayload, sceneUsesRasterParticleSource } from "../core/capabilities/optionalCapabilityLoader.js";
import { getParticleSourceSampler } from "../core/builder/particle/particleSourceSampler.js";
import { getSceneCapability } from "../core/capabilities/sceneCapabilityManifest.js";

test("raster particle support is stable but its implementation loads only when requested", async () => {
  const declaration = getSceneCapability("particleSources", "textMask");
  assert.equal(declaration.status, "stable");
  assert.equal(declaration.activation, "descriptor");
  assert.equal(sceneUsesRasterParticleSource({ objectList: [{ objType: "particleEmitter", source: { type: "box" } }] }), false);
  const payload = { objectList: [{ objType: "particleEmitter", source: { type: "textMask" } }] };
  assert.equal(sceneUsesRasterParticleSource(payload), true);
  await ensureOptionalSceneCapabilitiesForPayload(payload);
  assert.equal(typeof getParticleSourceSampler("textMask"), "function");
  assert.equal(getSceneCapability("particleSources", "textMask").status, "stable");
});

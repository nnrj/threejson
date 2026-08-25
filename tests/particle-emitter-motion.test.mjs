import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildWeatherParticleEmitterRecord
} from "../domains/weather/weatherPresets.js";
import { normalizeParticleEmitterV2 } from "../core/builder/particle/particleV2Descriptor.js";

test("weather rain preset drift velocity points downward", () => {
  const rain = normalizeParticleEmitterV2(buildWeatherParticleEmitterRecord("rain", { emission: { count: 10 } }));
  assert.equal(rain.emission.count, 10);
  assert.ok(rain.particle.velocity.y < 0, "rain should fall downward");
  assert.equal(rain.particle.velocity.y, -14);
});

test("weather snow preset drift velocity points downward", () => {
  const snow = normalizeParticleEmitterV2(buildWeatherParticleEmitterRecord("snow", { emission: { count: 10 } }));
  assert.ok(snow.particle.velocity.y < 0, "snow should fall downward");
});

test("legacy flat particle fields are not interpreted as Particle V2", () => {
  assert.throws(
    () => normalizeParticleEmitterV2({ objType: "particleEmitter", count: 9, motion: { type: "drift" } }),
    (error) => error?.code === "E_PARTICLE_SCHEMA_V1_REMOVED"
  );
});

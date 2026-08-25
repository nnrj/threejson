import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildWeatherParticleEmitterRecord,
  isWeatherHandler,
  WEATHER_PARTICLE_PRESETS
} from "../domains/weather/weatherPresets.js";

test("isWeatherHandler recognizes presets", () => {
  assert.equal(isWeatherHandler("rain"), true);
  assert.equal(isWeatherHandler("unknown"), false);
});

test("buildWeatherParticleEmitterRecord merges V2 overrides", () => {
  const rec = buildWeatherParticleEmitterRecord("rain", {
    emission: { count: 99 },
    position: { x: 10, y: 20, z: 0 }
  });
  assert.ok(rec);
  assert.equal(rec.emission.count, 99);
  assert.equal(rec.position.x, 10);
  assert.equal(rec.particle.velocity.y, -14);
});

test("embers preset uses a V2 billboard sprite and lifecycle", () => {
  const embers = WEATHER_PARTICLE_PRESETS.embers;
  assert.equal(embers.render.type, "billboard");
  assert.ok(String(embers.render.sprite).includes("wind_hot"));
  assert.equal(embers.particle.opacityOverLife.length, 3);
});

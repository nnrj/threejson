import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildWeatherPointsRecord,
  isWeatherHandler,
  WEATHER_HANDLER_PRESETS
} from "../domains/weather/weatherPresets.js";

test("isWeatherHandler recognizes presets", () => {
  assert.equal(isWeatherHandler("rain"), true);
  assert.equal(isWeatherHandler("unknown"), false);
});

test("buildWeatherPointsRecord merges overrides", () => {
  const rec = buildWeatherPointsRecord("rain", {
    count: 99,
    position: { x: 10, y: 20, z: 0 }
  });
  assert.ok(rec);
  assert.equal(rec.count, 99);
  assert.equal(rec.position.x, 10);
  assert.equal(rec.motion.type, "drift");
});

test("embers preset includes scrollUv motion and texture", () => {
  const embers = WEATHER_HANDLER_PRESETS.embers;
  assert.ok(Array.isArray(embers.motion));
  assert.equal(embers.motion[1].type, "scrollUv");
  assert.ok(String(embers.material.textureUrl).includes("wind_hot"));
});

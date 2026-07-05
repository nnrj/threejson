import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hasPointsMotion,
  resolveDriftVelocityFromRecord
} from "../core/builder/particle/particleComputeUtil.js";
import { buildWeatherPointsRecord } from "../domains/weather/weatherPresets.js";

test("hasPointsMotion detects drift and twinkle configs", () => {
  assert.equal(hasPointsMotion({ type: "drift", speed: 1 }), true);
  assert.equal(hasPointsMotion([{ type: "drift" }, { type: "scrollUv" }]), true);
  assert.equal(hasPointsMotion(""), false);
  assert.equal(hasPointsMotion(null), false);
});

test("weather rain preset drift velocity points downward", () => {
  const rain = buildWeatherPointsRecord("rain", { count: 10 });
  const velocity = resolveDriftVelocityFromRecord(rain);
  assert.ok(velocity);
  assert.ok(velocity.y < 0, "rain should fall downward");
  assert.equal(velocity.y, -14);
});

test("weather snow preset drift velocity points downward", () => {
  const snow = buildWeatherPointsRecord("snow", { count: 10 });
  const velocity = resolveDriftVelocityFromRecord(snow);
  assert.ok(velocity);
  assert.ok(velocity.y < 0, "snow should fall downward");
});

test("emitter.velocity is used when motion is absent", () => {
  const velocity = resolveDriftVelocityFromRecord({
    emitter: { velocity: { x: 0, y: -1, z: 0 }, speed: 9 }
  });
  assert.equal(velocity, null);
});

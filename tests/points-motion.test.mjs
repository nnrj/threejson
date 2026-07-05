import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizePointsMotion,
  normalizeMotionType,
  resolveDriftDirection,
  computeWrapSpanAlongDirection,
  computeDriftPositions,
  computeTwinkleOpacity
} from "../core/util/pointsMotionUtil.js";

test("normalizePointsMotion accepts string shorthand", () => {
  assert.deepEqual(normalizePointsMotion("drift"), [{ type: "drift" }]);
});

test("normalizePointsMotion accepts array of motions", () => {
  const list = normalizePointsMotion([
    { type: "drift", speed: 2 },
    "twinkle"
  ]);
  assert.equal(list.length, 2);
  assert.equal(list[0].type, "drift");
  assert.equal(list[1].type, "twinkle");
});

test("normalizeMotionType maps scroll aliases", () => {
  assert.equal(normalizeMotionType("scroll_uv"), "scrollUv");
});

test("resolveDriftDirection uses rise and fall presets", () => {
  assert.deepEqual(resolveDriftDirection({ type: "rise" }), { x: 0, y: 1, z: 0 });
  assert.deepEqual(resolveDriftDirection({ type: "fall" }), { x: 0, y: -1, z: 0 });
});

test("computeDriftPositions wraps along Y when enabled", () => {
  const base = new Float32Array([0, 0, 0, 0, 10, 0]);
  const phases = new Float32Array([0, 0]);
  const half = { x: 50, y: 40, z: 50 };
  const out = computeDriftPositions(
    base,
    phases,
    { x: 0, y: -1, z: 0 },
    10,
    100,
    true,
    half
  );
  assert.ok(Number.isFinite(out[1]));
  assert.ok(Number.isFinite(out[4]));
});

test("computeWrapSpanAlongDirection is positive for box", () => {
  const span = computeWrapSpanAlongDirection(
    { x: 10, y: 20, z: 5 },
    { x: 0, y: 1, z: 0 }
  );
  assert.equal(span, 40);
});

test("computeTwinkleOpacity oscillates between min and max", () => {
  const a = computeTwinkleOpacity(0, 2, 0.2, 1, 0);
  const b = computeTwinkleOpacity(Math.PI, 2, 0.2, 1, 0);
  assert.ok(a >= 0.2 && a <= 1);
  assert.ok(b >= 0.2 && b <= 1);
  assert.notEqual(a, b);
});

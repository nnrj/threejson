import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPositionsFloat32Array,
  buildPositionsFromExplicitArray,
  resolvePointsCount,
  resolvePointsBlending
} from "../core/builder/pointsBuilder.js";

test("resolvePointsCount prefers explicit positions length", () => {
  assert.equal(resolvePointsCount({ positions: [[0, 0, 0], [1, 1, 1]] }), 2);
  assert.equal(resolvePointsCount({ count: 99, positions: [[0, 0, 0]] }), 1);
});

test("resolvePointsCount uses count when no positions", () => {
  assert.equal(resolvePointsCount({ count: 10 }), 10);
  assert.equal(resolvePointsCount({}), 0);
});

test("buildPositionsFromExplicitArray accepts arrays and objects", () => {
  const arr = buildPositionsFromExplicitArray([
    [1, 2, 3],
    { x: 4, y: 5, z: 6 }
  ]);
  assert.ok(arr);
  assert.equal(arr.length, 6);
  assert.equal(arr[0], 1);
  assert.equal(arr[3], 4);
});

test("buildPositionsFloat32Array random fill matches count", () => {
  const buf = buildPositionsFloat32Array({
    count: 5,
    bounds: { width: 10, height: 10, depth: 10 }
  });
  assert.ok(buf);
  assert.equal(buf.length, 15);
});

test("resolvePointsBlending maps additive", async () => {
  const THREE = await import("three");
  assert.equal(resolvePointsBlending("additive"), THREE.AdditiveBlending);
  assert.equal(resolvePointsBlending(""), THREE.NormalBlending);
});

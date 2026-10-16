import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPositionsFloat32Array,
  buildPositionsFromExplicitArray,
  resolvePointsCount,
  resolvePointsBlending,
  buildPointsMaterial
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

test("buildPositionsFloat32Array supports spherical shell distribution", () => {
  const buf = buildPositionsFloat32Array({
    count: 20,
    distribution: { type: "shell", radius: 10, thickness: 2 }
  });
  assert.ok(buf);
  assert.equal(buf.length, 60);
  for (let i = 0; i < buf.length; i += 3) {
    const r = Math.hypot(buf[i], buf[i + 1], buf[i + 2]);
    assert.ok(r >= 9 && r <= 11, `expected radius in shell, got ${r}`);
  }
});

test("resolvePointsBlending maps additive", async () => {
  const THREE = await import("three");
  assert.equal(resolvePointsBlending("additive"), THREE.AdditiveBlending);
  assert.equal(resolvePointsBlending(""), THREE.NormalBlending);
});

test("compact point size/color do not turn tiny stars into default-size squares", () => {
  const record = { size: .09, color: "#cfe2ff", material: { transparent: true, opacity: .9 } };
  const before = JSON.stringify(record), material = buildPointsMaterial(record);
  try {
    assert.equal(material.size, .09);
    assert.equal(material.color.getHexString(), "cfe2ff");
    assert.equal(material.opacity, .9);
    assert.equal(JSON.stringify(record), before);
  } finally { material.dispose(); }
});

test("explicit point material settings and legacy defaults retain priority", () => {
  const explicit = buildPointsMaterial({ size: 3, color: "red", material: { size: 0, color: "blue" } });
  const legacy = buildPointsMaterial({});
  try {
    assert.equal(explicit.size, 0);
    assert.equal(explicit.color.getHexString(), "0000ff");
    assert.equal(legacy.size, 4);
  } finally { explicit.dispose(); legacy.dispose(); }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCurveFromPathDef } from "../core/util/tubePath.js";

class Vector3 {
  constructor(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
}

class CatmullRomCurve3 {
  constructor(points, closed, curveType, tension) {
    this.points = points;
    this.closed = closed;
    this.curveType = curveType;
    this.tension = tension;
  }
}

const THREE = { Vector3, CatmullRomCurve3 };

test("buildCurveFromPathDef returns null without enough points", () => {
  assert.equal(buildCurveFromPathDef({ points: [{ x: 0, y: 0, z: 0 }] }, THREE), null);
  assert.equal(buildCurveFromPathDef(null, THREE), null);
});

test("buildCurveFromPathDef builds catmullrom from object points", () => {
  const curve = buildCurveFromPathDef({
    type: "catmullRom",
    points: [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 5, z: 0 },
      { x: 20, y: 0, z: 5 }
    ],
    closed: false,
    tension: 0.4
  }, THREE);
  assert.ok(curve);
  assert.equal(curve.points.length, 3);
  assert.equal(curve.points[1].x, 10);
  assert.equal(curve.tension, 0.4);
});

test("buildCurveFromPathDef accepts array points", () => {
  const curve = buildCurveFromPathDef({
    points: [[0, 0, 0], [1, 2, 3]]
  }, THREE);
  assert.ok(curve);
  assert.equal(curve.points[1].y, 2);
});

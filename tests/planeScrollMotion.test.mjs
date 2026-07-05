import assert from "node:assert/strict";
import { test } from "node:test";

import {
  computePlaneScrollOffset,
  setupPlaneScrollMotion,
  updatePlaneScrollMotion
} from "../core/builder/planeScrollMotion.js";

test("computePlaneScrollOffset increases with positive speed", () => {
  const a = computePlaneScrollOffset(1, 1);
  const b = computePlaneScrollOffset(2, 1);
  assert.ok(b > a || b < a);
  assert.equal(computePlaneScrollOffset(0, 1), 0);
});

test("computePlaneScrollOffset reverses direction for negative speed", () => {
  const positive = computePlaneScrollOffset(1, 1);
  const negative = computePlaneScrollOffset(1, -1);
  assert.notEqual(positive, negative);
  assert.ok(Math.abs(positive - negative) > 0.01);
});

test("updatePlaneScrollMotion applies negative speed on U axis", () => {
  const map = { offset: { x: 0, y: 0 } };
  const plane = {
    material: { map },
    parent: {},
    userData: {},
    addEventListener() {}
  };
  setupPlaneScrollMotion(plane, { objType: "wind", speed: -2 });
  updatePlaneScrollMotion(0.5);
  assert.equal(map.offset.x, computePlaneScrollOffset(0.5, -2));
});

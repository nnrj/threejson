import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readObjJsonFromUserData,
  shouldSkipObjType,
  aabbOverlaps,
  intervalsOverlap
} from "../core/util/spatialQueryUtil.js";

test("readObjJsonFromUserData returns objJson object", () => {
  assert.deepEqual(readObjJsonFromUserData({ objJson: { name: "a" } }), { name: "a" });
  assert.equal(readObjJsonFromUserData({}), null);
  assert.equal(readObjJsonFromUserData(null), null);
});

test("shouldSkipObjType respects Set", () => {
  const skip = new Set(["floor", "points"]);
  assert.equal(shouldSkipObjType("floor", skip), true);
  assert.equal(shouldSkipObjType("box", skip), false);
});

test("aabbOverlaps detects intersection", () => {
  const a = { minX: 0, minY: 0, minZ: 0, maxX: 2, maxY: 2, maxZ: 2 };
  const b = { minX: 1, minY: 1, minZ: 1, maxX: 3, maxY: 3, maxZ: 3 };
  const c = { minX: 5, minY: 5, minZ: 5, maxX: 6, maxY: 6, maxZ: 6 };
  assert.equal(aabbOverlaps(a, b), true);
  assert.equal(aabbOverlaps(a, c), false);
});

test("intervalsOverlap on one axis", () => {
  assert.equal(intervalsOverlap(0, 1, 1, 2), true);
  assert.equal(intervalsOverlap(0, 1, 2, 3), false);
});

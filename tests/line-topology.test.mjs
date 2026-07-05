import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeLineTopology } from "../core/util/lineTopology.js";

test("normalizeLineTopology defaults to line", () => {
  assert.equal(normalizeLineTopology({}), "line");
  assert.equal(normalizeLineTopology({ topology: "line" }), "line");
});

test("normalizeLineTopology accepts segments aliases", () => {
  assert.equal(normalizeLineTopology({ topology: "lineSegments" }), "lineSegments");
  assert.equal(normalizeLineTopology({ lineTopology: "segments" }), "lineSegments");
});

test("normalizeLineTopology accepts loop aliases", () => {
  assert.equal(normalizeLineTopology({ topology: "lineLoop" }), "lineLoop");
  assert.equal(normalizeLineTopology({ topology: "loop" }), "lineLoop");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  jsonSpecifiesFpsField,
  normalizeFpsValue,
  resolveRenderLoopFpsPolicy
} from "../core/util/renderLoopPolicy.js";

test("jsonSpecifiesFpsField detects fps/lowFps only when explicitly present", () => {
  assert.equal(jsonSpecifiesFpsField({}), false);
  assert.equal(jsonSpecifiesFpsField({ autoResize: true }), false);
  assert.equal(jsonSpecifiesFpsField({ fps: 30 }), true);
  assert.equal(jsonSpecifiesFpsField({ lowFps: false }), true);
});

test("resolveRenderLoopFpsPolicy falls back to user policy when scene omits both fields", () => {
  const out = resolveRenderLoopFpsPolicy(
    { autoResize: true, firstAutoResize: true },
    { fps: 48, lowFps: true, overrideSceneRenderLoop: false }
  );
  assert.equal(out.fps, 48);
  assert.equal(out.lowFps, true);
});

test("resolveRenderLoopFpsPolicy merges by field when not overriding", () => {
  const out = resolveRenderLoopFpsPolicy(
    { lowFps: true },
    { fps: 72, lowFps: false, overrideSceneRenderLoop: false }
  );
  assert.equal(out.lowFps, true);
  assert.equal(out.fps, 72);
});

test("resolveRenderLoopFpsPolicy uses user policy when override enabled", () => {
  const out = resolveRenderLoopFpsPolicy(
    { fps: 24, lowFps: true },
    { fps: 60, lowFps: false, overrideSceneRenderLoop: true }
  );
  assert.equal(out.fps, 60);
  assert.equal(out.lowFps, false);
});

test("normalizeFpsValue falls back for invalid values", () => {
  assert.equal(normalizeFpsValue(undefined, 60), 60);
  assert.equal(normalizeFpsValue("bad", 60), 60);
  assert.equal(normalizeFpsValue(0, 60), 60);
  assert.equal(normalizeFpsValue(-1, 60), 60);
  assert.equal(normalizeFpsValue(59.5, 60), 59.5);
});

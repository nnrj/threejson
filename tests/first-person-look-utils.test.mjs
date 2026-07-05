import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blendLook,
  clampLookDelta,
  clampPitch,
  DEFAULT_LOOK_PITCH_LIMIT,
  isSmoothLookEnabled,
  resolveFirstPersonLookLimits,
  resolveLookSensitivity,
  resolveLookSmoothing
} from "../core/handler/controls/firstPersonLookUtils.js";

test("resolveLookSensitivity defaults to 0.001", () => {
  assert.equal(resolveLookSensitivity({}), 0.001);
  assert.equal(resolveLookSensitivity({ lookSensitivity: 0.0025 }), 0.0025);
});

test("resolveFirstPersonLookLimits derives polar angles from lookPitchLimit", () => {
  const limits = resolveFirstPersonLookLimits({ lookPitchLimit: 1.396 });
  assert.ok(Math.abs(limits.minPolarAngle - (Math.PI / 2 - 1.396)) < 1e-9);
  assert.ok(Math.abs(limits.maxPolarAngle - (Math.PI / 2 + 1.396)) < 1e-9);
  assert.equal(limits.pitchLimit, 1.396);
});

test("resolveFirstPersonLookLimits explicit polar overrides pitch limit derivation", () => {
  const limits = resolveFirstPersonLookLimits({
    lookPitchLimit: 1.396,
    minPolarAngle: 0.2,
    maxPolarAngle: 2.8
  });
  assert.equal(limits.minPolarAngle, 0.2);
  assert.equal(limits.maxPolarAngle, 2.8);
});

test("clampLookDelta limits per-frame mouse movement", () => {
  assert.deepEqual(clampLookDelta(200, -300, 120), { movementX: 120, movementY: -120 });
  assert.deepEqual(clampLookDelta(10, 5, 120), { movementX: 10, movementY: 5 });
});

test("blendLook returns frame-rate aware factor", () => {
  const blend = blendLook(1 / 60, 0.06);
  assert.ok(blend > 0 && blend < 1);
  assert.equal(blendLook(0, 0.06), 0);
});

test("clampPitch respects symmetric limit", () => {
  assert.equal(clampPitch(2, DEFAULT_LOOK_PITCH_LIMIT), DEFAULT_LOOK_PITCH_LIMIT);
  assert.equal(clampPitch(-2, DEFAULT_LOOK_PITCH_LIMIT), -DEFAULT_LOOK_PITCH_LIMIT);
  assert.equal(clampPitch(0.5, DEFAULT_LOOK_PITCH_LIMIT), 0.5);
});

test("isSmoothLookEnabled only when lookSmoothing > 0", () => {
  assert.equal(isSmoothLookEnabled({}), false);
  assert.equal(isSmoothLookEnabled({ lookSmoothing: 0 }), false);
  assert.equal(isSmoothLookEnabled({ lookSmoothing: 0.18 }), true);
  assert.equal(resolveLookSmoothing({ lookSmoothing: 1.5 }), 1);
});

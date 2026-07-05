import assert from "node:assert/strict";
import test from "node:test";
import { Tween } from "@tweenjs/tween.js";
import { createTween, updateEngineTweens } from "../core/compat/adapters/tween.js";

test("createTween registers tween in engine group and updateEngineTweens advances values", () => {
  const target = { x: 0 };
  createTween(target).to({ x: 1 }, 1000).start(0);
  updateEngineTweens(500);
  assert.equal(target.x, 0.5);
});

test("tween without group registration is not updated by updateEngineTweens", () => {
  const target = { x: 0 };
  new Tween(target).to({ x: 1 }, 1000).start(0);
  updateEngineTweens(500);
  assert.equal(target.x, 0);
});

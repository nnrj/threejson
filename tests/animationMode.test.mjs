import { test } from "node:test";
import assert from "node:assert/strict";
import { getAnimationMode } from "../core/util/animationMode.js";

test("getAnimationMode reads objJson.animationMode", () => {
  const o = { userData: { objJson: { animationMode: "mixer" } } };
  assert.equal(getAnimationMode(o), "mixer");
});

test("getAnimationMode returns undefined when absent", () => {
  assert.equal(getAnimationMode({ userData: { objJson: {} } }), undefined);
  assert.equal(getAnimationMode({ userData: {} }), undefined);
});

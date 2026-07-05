import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveControlsType,
  createControlsFromDescriptor,
  applyControlsConfig
} from "../core/builder/controlsBuilder.js";

test("resolveControlsType defaults to orbit", () => {
  assert.equal(resolveControlsType({}), "orbit");
  assert.equal(resolveControlsType({ type: "orbit" }), "orbit");
  assert.equal(resolveControlsType({ type: "firstPerson" }), "firstPerson");
});

test("createControlsFromDescriptor returns null when disabled", () => {
  assert.equal(createControlsFromDescriptor(null, null, { enabled: false }), null);
});

test("applyControlsConfig does not require target for firstPerson", () => {
  const fp = {
    threeJsonControlsKind: "firstPerson",
    enabled: true,
    moveSpeed: 4,
    eyeHeight: 1.6,
    update() {}
  };
  assert.doesNotThrow(() => {
    applyControlsConfig(fp, { type: "firstPerson", moveSpeed: 6, eyeHeight: 1.8 });
  });
  assert.equal(fp.moveSpeed, 6);
  assert.equal(fp.eyeHeight, 1.8);
});

test("resolveControlsType recognizes fly", () => {
  assert.equal(resolveControlsType({ type: "fly" }), "fly");
});

test("applyControlsConfig fly does not call update without delta", () => {
  let updateCalls = 0;
  const controls = {
    threeJsonControlsKind: "fly",
    movementSpeed: 10,
    rollSpeed: 0.5,
    update() {
      updateCalls += 1;
    }
  };
  applyControlsConfig(controls, { type: "fly", movementSpeed: 12, rollSpeed: 0.25 });
  assert.equal(updateCalls, 0);
  assert.equal(controls.movementSpeed, 12);
  assert.equal(controls.rollSpeed, 0.25);
});

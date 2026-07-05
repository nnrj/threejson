import test from "node:test";
import assert from "node:assert/strict";
import { listMaterialSlotsForDescriptor } from "../core/util/materialDescriptorWalk.js";

test("listMaterialSlotsForDescriptor: singular material", () => {
  const slots = listMaterialSlotsForDescriptor({
    objType: "box",
    material: { type: "standard", color: "#fff" }
  });
  assert.equal(slots.length, 1);
  assert.equal(slots[0].pointer, "/material");
  assert.match(slots[0].label, /六面共用/);
});

test("listMaterialSlotsForDescriptor: six materials", () => {
  const slots = listMaterialSlotsForDescriptor({
    objType: "box",
    materials: Array.from({ length: 6 }, (_, i) => ({ color: `#${i}${i}${i}` }))
  });
  assert.equal(slots.length, 6);
  assert.equal(slots[0].pointer, "/materials/0");
  assert.match(slots[0].label, /\+X/);
});

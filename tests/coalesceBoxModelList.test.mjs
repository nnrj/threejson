import assert from "node:assert/strict";
import { test } from "node:test";

import { coalesceBoxModelList } from "../core/handler/boxModelListCoalescer.js";

function makeAirConditioningEntry(x, z) {
  return {
    instanceCode: "airConditioning",
    objType: "box",
    name: "空调",
    geometry: { width: 6, height: 20, depth: 12 },
    position: { x, y: 10, z },
    rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
    scale: { scaleX: 1, scaleY: 1, scaleZ: 1 },
    materials: [{ type: "standard", color: "#8A8A8A" }]
  };
}

test("coalesceBoxModelList merges instanceCode into transforms", () => {
  const list = [
    makeAirConditioningEntry(-3, -12),
    makeAirConditioningEntry(21, -12),
    makeAirConditioningEntry(-3, 12),
    makeAirConditioningEntry(21, 12)
  ];
  const once = coalesceBoxModelList(list);
  assert.equal(once.length, 1);
  assert.equal(once[0].instance, true);
  assert.equal(once[0].transforms.length, 4);
});

test("double coalesceBoxModelList preserves all instance transforms", () => {
  const list = [
    makeAirConditioningEntry(-3, -12),
    makeAirConditioningEntry(21, -12),
    makeAirConditioningEntry(-3, 12),
    makeAirConditioningEntry(21, 12)
  ];
  const twice = coalesceBoxModelList(coalesceBoxModelList(list));
  assert.equal(twice.length, 1);
  assert.equal(twice[0].transforms.length, 4);
  const zValues = twice[0].transforms.map((t) => t.position.z).sort((a, b) => a - b);
  assert.deepEqual(zValues, [-12, -12, 12, 12]);
  const xValues = twice[0].transforms.map((t) => t.position.x).sort((a, b) => a - b);
  assert.deepEqual(xValues, [-3, -3, 21, 21]);
});

test("coalesceBoxModelList merges mergeCode into single merge record", () => {
  const list = [
    {
      mergeCode: "shellSide",
      name: "panelA",
      geometry: { width: 2, height: 10, depth: 20 },
      material: { type: "standard", color: "#111" },
      position: { x: 0, y: 0, z: 0 },
      rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
      scale: { scaleX: 1, scaleY: 1, scaleZ: 1 }
    },
    {
      mergeCode: "shellSide",
      name: "panelB",
      geometry: { width: 2, height: 10, depth: 20 },
      material: { type: "standard", color: "#222" },
      position: { x: 5, y: 0, z: 0 },
      rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
      scale: { scaleX: 1, scaleY: 1, scaleZ: 1 },
      businessInfo: { tag: "b" }
    },
    { name: "standalone", geometry: { width: 1, height: 1, depth: 1 } }
  ];
  const out = coalesceBoxModelList(list);
  assert.equal(out.length, 2);
  const merged = out.find((item) => item.merge === true);
  assert.ok(merged);
  assert.equal(merged.mergeCode, "shellSide");
  assert.equal(merged.geometryArr.length, 2);
  assert.equal(merged.businessInfoArr[1].tag, "b");
});

test("coalesceBoxModelList skips already instance records", () => {
  const premerged = {
    instance: true,
    instanceCode: "x",
    transforms: [{ position: { x: 1, y: 0, z: 0 }, rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 }, scale: { scaleX: 1, scaleY: 1, scaleZ: 1 } }],
    combineArr: [{ joins: [], inters: [], holes: [] }],
    businessInfoArr: [{}]
  };
  const out = coalesceBoxModelList([premerged]);
  assert.equal(out.length, 1);
  assert.equal(out[0].transforms.length, 1);
});

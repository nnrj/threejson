import assert from "node:assert/strict";
import { test } from "node:test";

import { createCabinet, createCabinetJson } from "../domains/device/cabinet/cabinetFactory.js";
import { computeHingeOffsetFromCenter } from "../domains/door/doorDescriptor.js";
import { createPort, createPortJson } from "../domains/port/portFactory.js";
import { migrateGroupDescriptorToSubScene } from "../core/handler/subSceneHierarchy.js";

test("createCabinetJson emits subScene instead of group boxModelList", () => {
  const json = createCabinetJson({ name: "cab-test" });
  assert.ok(json);
  assert.ok(Array.isArray(json.subScene));
  assert.ok(json.subScene.length >= 4);
  assert.equal(json.boxModelList, undefined);
});

test("migrateGroupDescriptorToSubScene moves nested group children", () => {
  const group = {
    objType: "group",
    boxModelList: [{ name: "wall", objType: "box", geometry: { width: 1, height: 1, depth: 1 } }],
    subGroup: [{ objType: "group", boxModelList: [{ name: "inner", objType: "sphere", geometry: { radius: 1 } }] }]
  };
  migrateGroupDescriptorToSubScene(group);
  assert.equal(group.boxModelList, undefined);
  assert.equal(group.subGroup, undefined);
  assert.equal(group.subScene.length, 2);
  assert.equal(group.subScene[1].subScene.length, 1);
});

test("createPortJson emits subScene for dock crane composite", () => {
  const json = createPortJson({
    objType: "dockCrane",
    geometry: { width: 60, length: 90, height: 100 }
  });
  assert.ok(json?.subScene?.length > 0);
  assert.equal(json.boxModelList, undefined);
});

test("createCabinetJson structure is deployable as group descriptor", () => {
  const json = createCabinetJson({ name: "cab-deployable", slots: { total: 9 }, devices: [] });
  assert.equal(json.objType, "deviceCabinet");
  assert.ok(Array.isArray(json.subScene));
});

test("createCabinetJson double front door uses door domain assemblies", () => {
  const json = createCabinetJson({
    doors: [{ side: "front", leafCount: 2 }],
    geometry: { width: 70, length: 90, height: 150 }
  });
  const frontDoor = (json.subScene || []).find((c) => c.name === "front-door");
  assert.ok(frontDoor);
  const assemblies = frontDoor.subScene || [];
  assert.equal(assemblies.length, 2);
  const left = assemblies.find((d) => d.subScene?.[0]?.doorType === "left");
  const right = assemblies.find((d) => d.subScene?.[0]?.doorType === "right");
  assert.ok(left && right);
  assert.ok(left.position.x < right.position.x);
  const wallDepth = 1.5;
  const innerW = 70 - 2 * wallDepth;
  assert.equal(left.subScene[0].geometry.width, innerW / 2);
  assert.equal(right.subScene[0].geometry.width, innerW / 2);
});

test("createCabinetJson back double door places leaf hinges on opposite sides", () => {
  const width = 6;
  const json = createCabinetJson({
    geometry: { width, length: 12, height: 20 },
    doors: [{ side: "back", swing: "right", leafCount: 2 }],
    devices: [],
    slots: { total: 9 }
  });
  const backDoor = (json.subScene || []).find((c) => c.name === "back-door");
  assert.ok(backDoor);
  const assemblies = backDoor.subScene || backDoor.subGroup || [];
  assert.equal(assemblies.length, 2);
  const left = assemblies.find((d) => d.subScene?.[0]?.doorType === "left" || d.boxModelList?.[0]?.doorType === "left");
  const right = assemblies.find((d) => d.subScene?.[0]?.doorType === "right" || d.boxModelList?.[0]?.doorType === "right");
  assert.ok(left && right);
  const wallDepth = 0.2;
  const innerW = width - 2 * wallDepth;
  assert.equal(left.position.x, innerW / 2);
  assert.equal(right.position.x, -innerW / 2);
  const leftLeaf = left.subScene?.[0] || left.boxModelList?.[0];
  const rightLeaf = right.subScene?.[0] || right.boxModelList?.[0];
  assert.equal(leftLeaf.hingeSide, "right");
  assert.equal(rightLeaf.hingeSide, "left");
  assert.equal(leftLeaf.mountSide, "back");
  assert.equal(leftLeaf.openDirection, "outward");
  assert.equal(leftLeaf.openAngleDeg, 130);
  const leftCenter = left.position.x - computeHingeOffsetFromCenter(leftLeaf).x;
  const rightCenter = right.position.x - computeHingeOffsetFromCenter(rightLeaf).x;
  assert.equal(leftCenter, innerW / 4);
  assert.equal(rightCenter, -innerW / 4);
});

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createCabinetJson,
  resolveCabinetSlotRailTextureUrl
} from "../domains/device/cabinet/cabinetFactory.js";
import {
  buildCabinetNumPanel,
  CABINET_NUM_PANEL_NAME,
  createCabNumPosition,
  getCabNumScaleRatio
} from "../domains/device/cabinet/cabinetDoorBuilder.js";
import { computeHingeOffsetFromCenter } from "../domains/door/doorDescriptor.js";

function collectSlotRails(group) {
  const out = [];
  const walk = (list) => {
    for (const item of list || []) {
      if (item?.name === "cabinet-slot-rail") {
        out.push(item);
      }
      walk(item?.subScene);
    }
  };
  walk(group?.subScene);
  walk(group?.boxModelList);
  return out;
}

test("small cabinet U-slot rails stay on left and right, not merged in center", () => {
  const group = createCabinetJson({
    geometry: { width: 6, length: 12, height: 20 },
    slots: { total: 9 },
    devices: []
  });
  const tips = collectSlotRails(group);
  assert.equal(tips.length, 2);
  const xs = tips.map((t) => t.position.x).sort((a, b) => a - b);
  assert.ok(xs[0] < -0.2, "left rail should sit on negative x");
  assert.ok(xs[1] > 0.2, "right rail should sit on positive x");
  assert.ok(xs[1] - xs[0] > 0.8, "rails should be separated inside cavity");
  for (const tip of tips) {
    assert.ok(tip.geometry.width < 1, "rail width should scale down for narrow cabinets");
    assert.ok(tip.geometry.height > 10, "rail should still span most of cabinet height");
  }
});

test("U-slot rail textures use cabinet_{u}u_{side}.png from slots.total", () => {
  assert.match(resolveCabinetSlotRailTextureUrl("left", 9), /cabinet_9u_left\.png$/);
  assert.match(resolveCabinetSlotRailTextureUrl("right", 9), /cabinet_9u_right\.png$/);
  assert.match(resolveCabinetSlotRailTextureUrl("left", 24), /cabinet_24u_left\.png$/);
  assert.match(resolveCabinetSlotRailTextureUrl("right", 24), /cabinet_24u_right\.png$/);

  const group = createCabinetJson({
    geometry: { width: 6, length: 12, height: 20 },
    slots: { total: 9 },
    devices: []
  });
  const tips = collectSlotRails(group);
  assert.equal(tips.length, 2);
  const left = tips.find((t) => t.position.x < 0);
  const right = tips.find((t) => t.position.x > 0);
  assert.match(left.material.textureUrl, /cabinet_9u_left\.png$/);
  assert.match(right.material.textureUrl, /cabinet_9u_right\.png$/);
});

test("brand infoPanel stays behind front door inner face", () => {
  const group = createCabinetJson({
    geometry: { width: 6, length: 12, height: 20 },
    doors: [{ side: "front", type: "right" }],
    devices: [
      {
        name: "计算节点",
        geometry: { width: 5.8, length: 11.8, height: 0.48 },
        position: { x: 0, y: 13.97, z: 0 },
        businessInfo: { brandName: "Huawei" }
      }
    ],
    slots: { total: 9 }
  });
  const device = (group.subScene || []).find((x) => x.objType === "device");
  const panel = (device?.subScene || []).find((x) => x.objType === "infoPanel");
  assert.ok(panel, "brand panel should exist");
  const frontInnerZ = 12 / 2 - 0.2;
  const panelFrontZ =
    (device.position?.z || 0) + panel.panel.position.z + panel.panel.geometry.depth / 2;
  assert.ok(
    panelFrontZ <= frontInnerZ - 0.01,
    `panel front ${panelFrontZ} should be inside door at ${frontInnerZ}`
  );
});

test("rack devices with explicit geometry clamp to interior footprint", () => {
  const group = createCabinetJson({
    geometry: { width: 6, length: 12, height: 20 },
    doors: [{ side: "front", swing: "right", leafCount: 1 }],
    devices: [
      {
        deviceType: "server",
        uStart: 28,
        uSize: 1,
        name: "计算节点",
        brandName: "Huawei",
        geometry: { width: 5.8, length: 11.8, height: 0.48 }
      }
    ],
    slots: { total: 9, unitHeight: 0.48, bottomMargin: 0.77 }
  });
  const device = (group.subScene || []).find((x) => x.objType === "device");
  const mesh =
    device?.boxModelList?.[0] ||
    (device?.subScene || []).find((x) => x.geometry?.width != null);
  assert.ok(mesh?.geometry);
  assert.ok(Math.abs(mesh.geometry.width - 5.44) < 1e-6);
  assert.ok(Math.abs(mesh.geometry.depth - 11.44) < 1e-6);
});

test("rack devices without geometry scale to cabinet interior footprint", () => {
  const group = createCabinetJson({
    geometry: { width: 6, length: 12, height: 20 },
    doors: [],
    devices: [{ deviceType: "server", uStart: 28, uSize: 1, name: "计算节点", brandName: "Huawei" }],
    slots: { total: 9, unitHeight: 0.48, bottomMargin: 0.77 }
  });
  const device = (group.subScene || []).find((x) => x.objType === "device");
  assert.ok(device, "device group should exist");
  const mesh =
    device.boxModelList?.[0] ||
    (device.subScene || []).find((x) => x.geometry?.width != null);
  assert.ok(mesh?.geometry, "device mesh geometry should exist");
  assert.ok(mesh.geometry.width < 10, "device width should fit narrow cabinet cavity");
  assert.ok(mesh.geometry.depth < 20, "device depth should fit cabinet interior");
  assert.ok(Math.abs(mesh.geometry.width - 5.44) < 1e-6);
  assert.ok(Math.abs(mesh.geometry.depth - 11.44) < 1e-6);
  assert.ok(mesh.geometry.width < 6 - 0.4, "device width should sit inside wall cavity");
  assert.ok(mesh.geometry.depth < 12 - 0.4, "device depth should sit inside wall cavity");
});

test("front door cab num panel scales and sits on door face", () => {
  const doorHeight = 20;
  const ratio = getCabNumScaleRatio(doorHeight);
  assert.ok(ratio < 0.2, "small cabinet door should use scaled-down cab num panel");

  const position = createCabNumPosition({ x: 0, y: 0, z: 0 }, doorHeight, 1);
  assert.ok(position.y > 0, "cab num should sit above door base, not below cabinet");
  assert.ok(position.y < doorHeight, "cab num should stay within door height");
  assert.ok(position.z > 0, "cab num should offset toward front of door");

  const panel = buildCabinetNumPanel("01", position, ratio);
  assert.equal(panel.panelBoxType, "plane");
  assert.equal(panel.panel.material.side, undefined);
  assert.ok(panel.panel.geometry.width < 2, "panel width should scale with door height");
  assert.equal(panel.panel.geometry.width, 6.5 * ratio);

  const group = createCabinetJson({
    geometry: { width: 6, length: 12, height: 20 },
    cabLabel: "01",
    doors: [{ side: "front", swing: "right", leafCount: 1 }],
    devices: [],
    slots: { total: 9 }
  });
  const frontDoor = (group.subScene || []).find((x) => String(x.name || "").includes("front-door"));
  assert.ok(frontDoor, "front door assembly should exist");
  const cabNumPanel =
    frontDoor.infoPanelList?.[0] ||
    (frontDoor.subScene || []).find((x) => x.text === "01");
  assert.ok(cabNumPanel, "cab num panel should attach to front door assembly");
  assert.equal(cabNumPanel.panelBoxType, "plane");
  assert.equal(cabNumPanel.name, CABINET_NUM_PANEL_NAME);
  assert.equal(cabNumPanel.text, "01");
  assert.equal(cabNumPanel.textAlign, "center");
  assert.equal(cabNumPanel.textVerticalAlign, "middle");
  assert.equal(cabNumPanel.opacity, 1);
  assert.ok(cabNumPanel.panel.geometry.width < 2);
  assert.ok(cabNumPanel.panel.position.y > 0);
});

test("front right swing door hinge assembly centers opening at deploy", () => {
  const width = 6;
  const length = 12;
  const group = createCabinetJson({
    geometry: { width, length, height: 20 },
    doors: [{ side: "front", swing: "right", leafCount: 1 }],
    devices: [],
    slots: { total: 9 }
  });
  const doorAsm = (group.subScene || []).find((x) => String(x.name || "").includes("front-door"));
  assert.ok(doorAsm, "front door assembly should exist");
  const leaf = doorAsm.subScene?.find((x) => x.objType === "door") || doorAsm.boxModelList?.[0];
  assert.ok(leaf, "door leaf should exist");
  const wallDepth = 0.2;
  assert.equal(doorAsm.position?.x, width / 2 - wallDepth);
  assert.equal(leaf.hingeSide, "right");
  assert.equal(leaf.mountSide, "front");
  assert.equal(leaf.openDirection, "outward");
  assert.equal(leaf.openAngleDeg, 130);
  const hingeOffset = computeHingeOffsetFromCenter(leaf);
  const centerX = (doorAsm.position?.x || 0) - hingeOffset.x;
  assert.ok(Math.abs(centerX) < 1e-6, `door opening should center on cabinet x=0, got ${centerX}`);
});

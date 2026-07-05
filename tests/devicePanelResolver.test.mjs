import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import { buildInfoPanelObject, normalizeInfoPanelDescriptor } from "../core/builder/infoPanelBuilder.js";
import { registerObject } from "../core/handler/objectRegistry.js";
import {
  appendDevicePanelSubScene,
  buildDefaultInfoPanelFromInfo,
  resolveDevicePanelBinding,
  resolveDevicePanelBehaviorConfig,
  resolveDevicePanelTriggerConfig,
  resolveDevicePanelKeyboardTrigger,
  hasDevicePanelBinding,
  DEVICE_PANEL_NAME
} from "../domains/device/devicePanelResolver.js";

test("prepareDevicePanelDescriptor converts world panel.position to subScene local", () => {
  const binding = resolveDevicePanelBinding({
    threeJsonId: "ups-a",
    position: { x: -50, y: 8, z: -18 },
    geometry: { width: 8, depth: 10, height: 16 },
    infoPanel: {
      type: "html",
      text: "UPS A",
      topDistance: 9,
      panel: { position: { x: -50, y: 33, z: -18 } }
    }
  });
  assert.deepEqual(binding?.panelDescriptor?.panel?.position, { x: 0, y: 25, z: 0 });
});

test("prepareDevicePanelDescriptor keeps explicit local panel.position", () => {
  const binding = resolveDevicePanelBinding({
    threeJsonId: "ups-b",
    position: { x: -50, y: 8, z: 18 },
    geometry: { width: 8, depth: 10, height: 16 },
    infoPanel: {
      type: "html",
      text: "UPS B",
      panel: { position: { x: 0, y: 25, z: 0 } }
    }
  });
  assert.deepEqual(binding?.panelDescriptor?.panel?.position, { x: 0, y: 25, z: 0 });
});

test("resolveDevicePanelBinding priority: devicePanelRef over info over infoPanel", () => {
  const external = resolveDevicePanelBinding({
    threeJsonId: "ups-a",
    infoPanel: { type: "html", text: "inline" },
    info: "shorthand",
    devicePanelRef: "external-panel"
  });
  assert.equal(external?.mode, "externalRef");
  assert.equal(external?.devicePanelRef, "external-panel");
  assert.equal(external?.panelDescriptor, undefined);

  const shorthand = resolveDevicePanelBinding({
    threeJsonId: "ups-b",
    info: "<div>ups</div>",
    infoPanel: { type: "html", text: "ignored" }
  });
  assert.equal(shorthand?.mode, "infoShorthand");
  assert.equal(shorthand?.devicePanelRef, "ups-b__infoPanel");

  const inline = resolveDevicePanelBinding({
    threeJsonId: "ups-c",
    infoPanel: { type: "html", text: "inline" }
  });
  assert.equal(inline?.mode, "inline");
  assert.equal(inline?.devicePanelRef, "ups-c__infoPanel");
  assert.equal(inline?.panelDescriptor?.threeJsonId, "ups-c__infoPanel");
  assert.equal(inline?.panelDescriptor?.name, DEVICE_PANEL_NAME);
});

test("resolveDevicePanelBinding assigns stable panel id when device lacks threeJsonId", () => {
  const binding = resolveDevicePanelBinding({
    infoPanel: { type: "text", text: "UPS", visible: false }
  });
  assert.ok(binding?.devicePanelRef);
  assert.equal(binding?.panelDescriptor?.threeJsonId, binding?.devicePanelRef);
  assert.equal(binding?.panelDescriptor?.name, DEVICE_PANEL_NAME);
});

test("appendDevicePanelSubScene writes devicePanelRef and subScene list", () => {
  const groupObj = { name: "ups" };
  const record = {
    threeJsonId: "ups-c",
    infoPanel: { type: "text", text: "UPS", visible: false }
  };
  const binding = appendDevicePanelSubScene(groupObj, record);
  assert.equal(binding?.mode, "inline");
  assert.equal(record.devicePanelRef, "ups-c__infoPanel");
  assert.equal(groupObj.infoPanelList.length, 1);
  assert.equal(groupObj.infoPanelList[0].name, DEVICE_PANEL_NAME);
});

test("external ref binds to existing shared Object3D id", () => {
  const scene = new THREE.Scene();
  const shared = normalizeInfoPanelDescriptor({
    threeJsonId: "shared-panel",
    name: "infoPanel",
    text: "shared",
    type: "text"
  });
  const mesh = buildInfoPanelObject(shared, { isTexture: true });
  scene.add(mesh);
  registerObject(mesh, shared, { recursive: false });
  const record = { threeJsonId: "ac-1", devicePanelRef: "shared-panel" };
  const binding = resolveDevicePanelBinding(record);
  assert.equal(binding?.devicePanelRef, "shared-panel");
  const groupObj = { name: "ac" };
  appendDevicePanelSubScene(groupObj, record);
  assert.equal(record.devicePanelRef, "shared-panel");
  assert.equal(groupObj.infoPanelList, undefined);
});

test("invalid devicePanelRef does not fallback to infoPanel", () => {
  const groupObj = { name: "ups" };
  const record = {
    threeJsonId: "ups-bad",
    devicePanelRef: "typo-id",
    infoPanel: { type: "html", text: "should not deploy" }
  };
  const binding = resolveDevicePanelBinding(record);
  assert.equal(binding?.mode, "externalRef");
  assert.equal(binding?.devicePanelRef, "typo-id");
  assert.equal(binding?.panelDescriptor, undefined);
  appendDevicePanelSubScene(groupObj, record);
  assert.equal(record.devicePanelRef, "typo-id");
  assert.equal(groupObj.infoPanelList, undefined);
});

test("buildDefaultInfoPanelFromInfo creates sprite html panel", () => {
  const panel = buildDefaultInfoPanelFromInfo({
    threeJsonId: "ups-d",
    info: "<div>load</div>",
    geometry: { height: 16 },
    position: { x: 1, y: 8, z: 2 }
  }, "ups-d__infoPanel");
  assert.equal(panel.name, DEVICE_PANEL_NAME);
  assert.equal(panel.panelBoxType, "sprite");
  assert.equal(panel.visible, true);
  assert.equal(panel.threeJsonId, "ups-d__infoPanel");
});

test("resolveDevicePanelTriggerConfig accepts none for show and hide", () => {
  assert.deepEqual(resolveDevicePanelTriggerConfig({}), {
    show: "hover",
    hide: "mouseleave",
    hideDelayMs: 200
  });
  assert.deepEqual(resolveDevicePanelTriggerConfig({
    panelShowTrigger: "none",
    panelHideTrigger: "dblclick"
  }), {
    show: "none",
    hide: "dblclick",
    hideDelayMs: 200
  });
  assert.deepEqual(resolveDevicePanelTriggerConfig({
    panelShowTrigger: "click",
    panelHideTrigger: "none"
  }), {
    show: "click",
    hide: "none",
    hideDelayMs: 200
  });
});

test("resolveDevicePanelBehaviorConfig reads panel visibility and panel hide shorthand", () => {
  const behavior = resolveDevicePanelBehaviorConfig({
    panelShowTrigger: "hover",
    panelHideTrigger: "panel.dblclick",
    panelHideDelayMs: 350,
    infoPanel: {
      type: "text",
      text: "UPS",
      visible: false,
      dismissTrigger: "click"
    }
  });
  assert.equal(behavior.initialVisible, false);
  assert.equal(behavior.show, "hover");
  assert.equal(behavior.hide, "panel.dblclick");
  assert.equal(behavior.hideDelayMs, 350);
  assert.equal(behavior.panelDismissTrigger, "click");
  assert.equal(behavior.hasExplicitPanelDismissTrigger, true);
  assert.equal(behavior.hideFromPanel, true);
});

test("resolveDevicePanelKeyboardTrigger returns trimmed key or null", () => {
  assert.equal(resolveDevicePanelKeyboardTrigger({ devicePanelKeyboardTrigger: "P" }), "P");
  assert.equal(resolveDevicePanelKeyboardTrigger({ devicePanelKeyboardTrigger: "  " }), null);
  assert.equal(resolveDevicePanelKeyboardTrigger({}), null);
});

test("hasDevicePanelBinding detects infoPanel shorthand", () => {
  assert.equal(hasDevicePanelBinding({ infoPanel: { type: "text", text: "x" } }), true);
  assert.equal(hasDevicePanelBinding({ name: "plain-box" }), false);
});

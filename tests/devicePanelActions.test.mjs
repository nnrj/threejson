import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import { buildInfoPanelObject, normalizeInfoPanelDescriptor } from "../core/builder/infoPanelBuilder.js";
import {
  clearObjectRegistry,
  registerObject
} from "../core/handler/objectRegistry.js";
import {
  attachEventListenerManager,
  clearAllEventBindings,
  createEventListenerManager,
  getBindings
} from "../core/runtime/eventMechanism/index.js";
import { bindDevicePanelActionTriggers } from "../domains/device/devicePanelActions.js";
import { DEVICE_PANEL_NAME } from "../domains/device/devicePanelResolver.js";
import "../builtins/register.js";

function makeDeviceHost(record) {
  const host = new THREE.Group();
  host.userData.objJson = {
    objType: "domain",
    domain: "device.ups",
    ...record
  };
  registerObject(host, host.userData.objJson, { recursive: false });
  return host;
}

function deployDevicePanel(scene, host, panelId, extra = {}) {
  const descriptor = normalizeInfoPanelDescriptor({
    threeJsonId: panelId,
    objType: "infoPanel",
    name: DEVICE_PANEL_NAME,
    type: "text",
    text: "panel",
    visible: false,
    panel: {
      geometry: { width: 20, height: 10, depth: 1 },
      position: { x: 0, y: 0, z: 0 }
    },
    ...extra
  });
  const panel = buildInfoPanelObject(descriptor, { isTexture: true });
  panel.visible = descriptor.visible !== false;
  scene.add(panel);
  registerObject(panel, descriptor, { recursive: false });
  host.userData.objJson.devicePanelRef = panelId;
  return panel;
}

test("device panel dblclick trigger derives one toggle action binding", async () => {
  clearAllEventBindings();
  clearObjectRegistry();
  const scene = new THREE.Scene();
  const host = makeDeviceHost({
    threeJsonId: "ups-action",
    panelShowTrigger: "dblclick",
    panelHideTrigger: "dblclick",
    infoPanel: { type: "text", text: "ups", visible: false }
  });
  scene.add(host);
  const panel = deployDevicePanel(scene, host, "ups-action__infoPanel");
  const manager = createEventListenerManager();

  bindDevicePanelActionTriggers(scene, { manager, sceneToken: "device-panel-actions" });

  const bindings = getBindings("ups-action", "dblclick");
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].payload?.eventConfig?.action?.type, "device.togglePanel");
  await manager.dispatchPlatformEvent("ups-action", "dblclick", { scene });
  assert.equal(panel.visible, true);
  await manager.dispatchPlatformEvent("ups-action", "dblclick", { scene });
  assert.equal(panel.visible, false);

  manager.dispose();
  clearAllEventBindings();
  clearObjectRegistry();
});

test("device panel panel.click hide binding respects dismissTrigger priority", () => {
  clearAllEventBindings();
  clearObjectRegistry();
  const scene = new THREE.Scene();
  const hostA = makeDeviceHost({
    threeJsonId: "panel-click-a",
    panelHideTrigger: "panel.click",
    infoPanel: { type: "text", text: "a", visible: true }
  });
  const hostB = makeDeviceHost({
    threeJsonId: "panel-click-b",
    panelHideTrigger: "panel.click",
    infoPanel: { type: "text", text: "b", visible: true, dismissTrigger: "click" }
  });
  scene.add(hostA);
  scene.add(hostB);
  deployDevicePanel(scene, hostA, "panel-click-a__infoPanel");
  deployDevicePanel(scene, hostB, "panel-click-b__infoPanel", { dismissTrigger: "click" });
  const manager = createEventListenerManager();

  bindDevicePanelActionTriggers(scene, { manager, sceneToken: "device-panel-actions" });

  assert.equal(getBindings("panel-click-a__infoPanel", "click").length, 1);
  assert.equal(getBindings("panel-click-b__infoPanel", "click").length, 0);

  manager.dispose();
  clearAllEventBindings();
  clearObjectRegistry();
});

test("device panel panel.click hide binds after lazy deploy", async () => {
  clearAllEventBindings();
  clearObjectRegistry();
  const scene = new THREE.Scene();
  const host = makeDeviceHost({
    threeJsonId: "lazy-panel-hide",
    panelShowTrigger: "dblclick",
    panelHideTrigger: "panel.click",
    infoPanel: { type: "text", text: "lazy", visible: false }
  });
  scene.add(host);
  const manager = createEventListenerManager();

  bindDevicePanelActionTriggers(scene, { manager, sceneToken: "device-panel-actions" });
  assert.equal(getBindings("lazy-panel-hide__infoPanel", "click").length, 0);

  const panel = deployDevicePanel(scene, host, "lazy-panel-hide__infoPanel");
  assert.equal(getBindings("lazy-panel-hide__infoPanel", "click").length, 0);

  await manager.dispatchPlatformEvent("lazy-panel-hide", "dblclick", {
    scene,
    manager,
    sceneToken: "device-panel-actions"
  });

  assert.equal(panel.visible, true);
  assert.equal(getBindings("lazy-panel-hide__infoPanel", "click").length, 1);

  await manager.dispatchPlatformEvent("lazy-panel-hide__infoPanel", "click", {
    scene,
    manager,
    sceneToken: "device-panel-actions"
  });
  assert.equal(panel.visible, false);

  manager.dispose();
  clearAllEventBindings();
  clearObjectRegistry();
});

test("device panel fix:false wires dismiss when panel visible at bind time", async () => {
  clearAllEventBindings();
  clearObjectRegistry();
  const scene = new THREE.Scene();
  const host = makeDeviceHost({
    threeJsonId: "ups-visible-dismiss",
    panelShowTrigger: "dblclick",
    panelHideTrigger: "dblclick",
    infoPanel: { type: "text", text: "ups", visible: true, fix: false }
  });
  scene.add(host);
  const panel = deployDevicePanel(scene, host, "ups-visible-dismiss__infoPanel", {
    fix: false,
    visible: true
  });
  const manager = createEventListenerManager();
  attachEventListenerManager(manager, "ups-visible-dismiss");

  bindDevicePanelActionTriggers(scene, { manager, sceneToken: "ups-visible-dismiss" });

  const dismissBindings = getBindings("ups-visible-dismiss__infoPanel", "dblclick");
  assert.equal(dismissBindings.length, 1);
  assert.equal(dismissBindings[0].payload?.builtin, "infoPanel.dismiss");

  await manager.dispatchPlatformEvent("ups-visible-dismiss__infoPanel", "dblclick", {
    scene,
    manager,
    sceneToken: "ups-visible-dismiss",
    object: panel
  });
  assert.equal(panel.visible, false);

  manager.dispose();
  clearAllEventBindings();
  clearObjectRegistry();
});

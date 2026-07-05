import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import { buildInfoPanelObject, normalizeInfoPanelDescriptor } from "../core/builder/infoPanelBuilder.js";
import { registerObject, rebuildObjectRegistryFromScene, getObjectByThreeJsonId } from "../core/handler/objectRegistry.js";
import { DEVICE_PANEL_NAME } from "../domains/device/devicePanelResolver.js";
import {
  ensureDevicePanelDeployed,
  handleDevicePanelDblClick,
  resolveDevicePanelHostRoot,
  bindDevicePanelKeyboardTriggers,
  showDevicePanel,
  hideDevicePanel
} from "../domains/device/devicePanelRuntime.js";

function makeHostMesh(record) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(10, 20, 10),
    new THREE.MeshBasicMaterial()
  );
  mesh.position.set(1, 2, 3);
  mesh.userData.objJson = { ...record };
  return mesh;
}

function deployInlineDevicePanel(scene, host, panelId) {
  const descriptor = normalizeInfoPanelDescriptor({
    threeJsonId: panelId,
    name: DEVICE_PANEL_NAME,
    type: "text",
    text: "panel",
    visible: false,
    panel: {
      geometry: { width: 20, height: 10, depth: 1 },
      position: { x: 0, y: 0, z: 0 }
    }
  });
  const mesh = buildInfoPanelObject(descriptor, { isTexture: true });
  scene.add(mesh);
  registerObject(mesh, descriptor, { recursive: false });
  host.userData.objJson.devicePanelRef = panelId;
  return mesh;
}

test("resolveDevicePanelHostRoot prefers device domain root", () => {
  const child = new THREE.Mesh();
  const domainRoot = new THREE.Group();
  domainRoot.userData.objJson = { objType: "domain", domain: "device.ups" };
  domainRoot.add(child);
  assert.equal(resolveDevicePanelHostRoot(child), domainRoot);
});

test("resolveDevicePanelHostRoot falls back to inline infoPanel host", () => {
  const host = makeHostMesh({
    threeJsonId: "building-a",
    infoPanel: { type: "text", text: "hello", panel: { geometry: { width: 1, height: 1, depth: 1 } } }
  });
  assert.equal(resolveDevicePanelHostRoot(host), host);
});

test("ensureDevicePanelDeployed backfills devicePanelRef for pre-deployed panel", async () => {
  const scene = new THREE.Scene();
  const host = makeHostMesh({
    threeJsonId: "port-dispatch-center",
    infoPanel: {
      type: "text",
      text: "dispatch",
      panel: { geometry: { width: 20, height: 10, depth: 1 }, position: { x: 0, y: 0, z: 0 } }
    }
  });
  scene.add(host);
  deployInlineDevicePanel(scene, host, "port-dispatch-center__infoPanel");
  const panelId = await ensureDevicePanelDeployed(scene, host);
  assert.equal(panelId, "port-dispatch-center__infoPanel");
  assert.equal(host.userData.objJson.devicePanelRef, panelId);
});

test("handleDevicePanelDblClick toggles deployed panel when trigger is dblclick", async () => {
  const scene = new THREE.Scene();
  const host = makeHostMesh({
    threeJsonId: "port-power-station",
    panelShowTrigger: "dblclick",
    panelHideTrigger: "dblclick",
    infoPanel: {
      type: "text",
      text: "power",
      panel: { geometry: { width: 20, height: 10, depth: 1 }, position: { x: 0, y: 0, z: 0 } }
    }
  });
  scene.add(host);
  const panel = deployInlineDevicePanel(scene, host, "port-power-station__infoPanel");
  assert.ok(getObjectByThreeJsonId("port-power-station__infoPanel"));
  assert.equal(showDevicePanel(host, true), true);
  hideDevicePanel(host);
  assert.equal(panel.visible, false);
  await handleDevicePanelDblClick(scene, host);
  assert.equal(panel.visible, true);
  await handleDevicePanelDblClick(scene, host);
  assert.equal(panel.visible, false);
});

test("bindDevicePanelKeyboardTriggers toggles panel on matching key", async () => {
  const scene = new THREE.Scene();
  const host = makeHostMesh({
    threeJsonId: "port-weather-tower",
    devicePanelKeyboardTrigger: "w",
    infoPanel: {
      type: "text",
      text: "weather",
      panel: { geometry: { width: 20, height: 10, depth: 1 }, position: { x: 0, y: 0, z: 0 } }
    }
  });
  scene.add(host);
  const panel = deployInlineDevicePanel(scene, host, "port-weather-tower__infoPanel");
  showDevicePanel(host, true);
  assert.equal(panel.visible, true);
  /** @type {((event: { key?: string }) => void)|null} */
  let keyHandler = null;
  const target = {
    addEventListener(type, fn) {
      if (type === "keydown") {
        keyHandler = fn;
      }
    },
    removeEventListener() {}
  };
  const cleanup = bindDevicePanelKeyboardTriggers(scene, { target });
  assert.ok(typeof cleanup === "function");
  assert.ok(typeof keyHandler === "function");
  keyHandler({ key: "w" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(panel.visible, false);
  cleanup();
});

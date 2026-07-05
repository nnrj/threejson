import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import {
  addBinding,
  clearAllEventBindings,
  createCanvasRaycastEventHost,
  createEventListenerManager,
  getBindings,
  pickObjectFromNativeEvent,
  resolveThreeJsonIdFromPick
} from "../core/runtime/eventMechanism/index.js";
import { bindDevicePanelActionTriggers } from "../domains/device/devicePanelActions.js";
import { registerObject, clearObjectRegistry } from "../core/handler/objectRegistry.js";
import { buildInfoPanelObject, normalizeInfoPanelDescriptor } from "../core/builder/infoPanelBuilder.js";
import { DEVICE_PANEL_NAME } from "../domains/device/devicePanelResolver.js";
import "../builtins/register.js";

test("resolveThreeJsonIdFromPick prefers domain root over child shell box", () => {
  const root = new THREE.Group();
  root.userData.objJson = {
    objType: "domain",
    domain: "device.ups",
    threeJsonId: "ups-root"
  };
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial()
  );
  shell.userData.objJson = {
    objType: "box",
    threeJsonId: "ups-shell-face"
  };
  root.add(shell);

  addBinding({
    threeJsonId: "ups-root",
    eventName: "dblclick",
    source: "runtime",
    objType: "domain",
    domainKey: "device.ups",
    executorKind: "core",
    payload: { actions: [{ type: "device.togglePanel", target: "self" }] }
  });

  assert.equal(resolveThreeJsonIdFromPick(shell, "dblclick"), "ups-root");

  clearAllEventBindings();
});

test("resolveThreeJsonIdFromPick prefers domain binding over infoPanel on dblclick", () => {
  const root = new THREE.Group();
  root.userData.objJson = {
    objType: "domain",
    domain: "device.ups",
    threeJsonId: "ups-root"
  };
  const panel = new THREE.Sprite(new THREE.SpriteMaterial());
  panel.userData.objJson = {
    objType: "infoPanel",
    threeJsonId: "ups-root__infoPanel"
  };
  root.add(panel);

  addBinding({
    threeJsonId: "ups-root",
    eventName: "dblclick",
    source: "runtime",
    objType: "domain",
    domainKey: "device.ups",
    executorKind: "core",
    payload: { actions: [{ type: "device.togglePanel", target: "self" }] }
  });

  assert.equal(resolveThreeJsonIdFromPick(panel, "dblclick"), "ups-root");

  clearAllEventBindings();
});

test("resolveThreeJsonIdFromPick prefers door dblclick binding over cabNumPanel on same chain", () => {
  const hinge = new THREE.Group();
  hinge.userData.objJson = {
    objType: "door",
    threeJsonId: "cab-a__door-front"
  };
  const panel = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.1), new THREE.MeshBasicMaterial());
  panel.userData.objJson = {
    objType: "infoPanel",
    name: "cabNumPanel",
    threeJsonId: "cab-a__door-front__num"
  };
  hinge.add(panel);

  addBinding({
    threeJsonId: "cab-a__door-front",
    eventName: "dblclick",
    source: "runtime",
    objType: "door",
    executorKind: "core",
    payload: { actions: [{ type: "door.toggle", target: "self" }] }
  });

  assert.equal(resolveThreeJsonIdFromPick(panel, "dblclick"), "cab-a__door-front");
  assert.equal(resolveThreeJsonIdFromPick(panel, "pointerover"), "cab-a__door-front__num");

  clearAllEventBindings();
});

test("pickObjectFromNativeEvent uses nearest hit and does not pick bound door behind wall", () => {
  clearAllEventBindings();

  const scene = new THREE.Scene();
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(10, 10, 0.2),
    new THREE.MeshBasicMaterial()
  );
  wall.position.set(0, 0, 1);
  wall.userData.objJson = {
    objType: "box",
    name: "room-wall",
    threeJsonId: "room-wall-1"
  };
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(2, 4, 0.1),
    new THREE.MeshBasicMaterial()
  );
  door.position.set(0, 0, 2);
  door.userData.objJson = {
    objType: "door",
    threeJsonId: "cab-a__door-front"
  };
  scene.add(wall);
  scene.add(door);

  addBinding({
    threeJsonId: "cab-a__door-front",
    eventName: "dblclick",
    source: "runtime",
    objType: "door",
    executorKind: "core",
    payload: { actions: [{ type: "door.toggle", target: "self" }] }
  });

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 0, -5);
  camera.lookAt(0, 0, 2);
  camera.updateMatrixWorld(true);

  const canvas = {
    getBoundingClientRect() {
      return { width: 100, height: 100, left: 0, top: 0 };
    }
  };
  const event = { clientX: 50, clientY: 50 };
  const pickOpts = { eventName: "dblclick", resolveFromObject: resolveThreeJsonIdFromPick };

  const picked = pickObjectFromNativeEvent(event, canvas, camera, scene, pickOpts);
  assert.equal(picked, wall);
  assert.equal(resolveThreeJsonIdFromPick(picked, "dblclick"), "room-wall-1");
  assert.equal(getBindings("room-wall-1", "dblclick").length, 0);

  clearAllEventBindings();
});

test("pickObjectFromNativeEvent pierces pickThrough container shell to bound door sibling", () => {
  clearAllEventBindings();

  const scene = new THREE.Scene();
  const cabinetRoot = new THREE.Group();
  cabinetRoot.userData.objJson = {
    objType: "domain",
    domain: "device.cabinet",
    threeJsonId: "cab-a",
    pickThroughRaycast: true
  };
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(10, 10, 0.2),
    new THREE.MeshBasicMaterial()
  );
  shell.position.set(0, 0, 1);
  shell.userData.objJson = { objType: "box", name: "cabinetFront" };
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(2, 4, 0.1),
    new THREE.MeshBasicMaterial()
  );
  door.position.set(0, 0, 2);
  door.userData.objJson = {
    objType: "door",
    threeJsonId: "cab-a__door-front"
  };
  cabinetRoot.add(shell);
  cabinetRoot.add(door);
  scene.add(cabinetRoot);

  addBinding({
    threeJsonId: "cab-a__door-front",
    eventName: "dblclick",
    source: "runtime",
    objType: "door",
    executorKind: "core",
    payload: { actions: [{ type: "door.toggle", target: "self" }] }
  });

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 0, -5);
  camera.lookAt(0, 0, 2);
  camera.updateMatrixWorld(true);

  const canvas = {
    getBoundingClientRect() {
      return { width: 100, height: 100, left: 0, top: 0 };
    }
  };
  const event = { clientX: 50, clientY: 50 };
  const pickOpts = { eventName: "dblclick", resolveFromObject: resolveThreeJsonIdFromPick };

  const picked = pickObjectFromNativeEvent(event, canvas, camera, scene, pickOpts);
  assert.equal(picked, door);
  assert.equal(resolveThreeJsonIdFromPick(picked, "dblclick"), "cab-a__door-front");

  clearAllEventBindings();
});

test("pickObjectFromNativeEvent does not pierce pickThrough root to binding outside container", () => {
  clearAllEventBindings();

  const scene = new THREE.Scene();
  const cabinetRoot = new THREE.Group();
  cabinetRoot.userData.objJson = {
    objType: "domain",
    domain: "device.cabinet",
    threeJsonId: "cab-a",
    pickThroughRaycast: true
  };
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(10, 10, 0.2),
    new THREE.MeshBasicMaterial()
  );
  shell.position.set(0, 0, 1);
  shell.userData.objJson = { objType: "box", name: "cabinetShell" };
  cabinetRoot.add(shell);
  scene.add(cabinetRoot);

  const rearDoor = new THREE.Mesh(
    new THREE.BoxGeometry(2, 4, 0.1),
    new THREE.MeshBasicMaterial()
  );
  rearDoor.position.set(0, 0, 3);
  rearDoor.userData.objJson = {
    objType: "door",
    threeJsonId: "cab-b__door-front"
  };
  scene.add(rearDoor);

  addBinding({
    threeJsonId: "cab-b__door-front",
    eventName: "dblclick",
    source: "runtime",
    objType: "door",
    executorKind: "core",
    payload: { actions: [{ type: "door.toggle", target: "self" }] }
  });

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 0, -5);
  camera.lookAt(0, 0, 3);
  camera.updateMatrixWorld(true);

  const canvas = {
    getBoundingClientRect() {
      return { width: 100, height: 100, left: 0, top: 0 };
    }
  };
  const event = { clientX: 50, clientY: 50 };
  const pickOpts = { eventName: "dblclick", resolveFromObject: resolveThreeJsonIdFromPick };

  const picked = pickObjectFromNativeEvent(event, canvas, camera, scene, pickOpts);
  assert.equal(picked, shell);
  assert.equal(getBindings(resolveThreeJsonIdFromPick(picked, "dblclick"), "dblclick").length, 0);

  clearAllEventBindings();
});

test("pickObjectFromNativeEvent without pickThrough keeps UPS shell as first hit", () => {
  clearAllEventBindings();

  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.userData.objJson = {
    objType: "domain",
    domain: "device.ups",
    threeJsonId: "ups-root"
  };
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(8, 8, 8),
    new THREE.MeshBasicMaterial()
  );
  shell.userData.objJson = { objType: "box", threeJsonId: "ups-shell" };
  root.add(shell);
  scene.add(root);

  addBinding({
    threeJsonId: "ups-root",
    eventName: "dblclick",
    source: "runtime",
    objType: "domain",
    domainKey: "device.ups",
    executorKind: "core",
    payload: { actions: [{ type: "device.togglePanel", target: "self" }] }
  });

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 0, -20);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  const canvas = {
    getBoundingClientRect() {
      return { width: 100, height: 100, left: 0, top: 0 };
    }
  };
  const event = { clientX: 50, clientY: 50 };
  const pickOpts = { eventName: "dblclick", resolveFromObject: resolveThreeJsonIdFromPick };

  const picked = pickObjectFromNativeEvent(event, canvas, camera, scene, pickOpts);
  assert.equal(picked, shell);
  assert.equal(resolveThreeJsonIdFromPick(picked, "dblclick"), "ups-root");

  clearAllEventBindings();
});

test("device panel toggle works when dispatch uses domain id resolved from shell pick", async () => {
  clearAllEventBindings();
  clearObjectRegistry();

  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.userData.objJson = {
    objType: "domain",
    domain: "device.ups",
    threeJsonId: "ups-shell-toggle",
    panelShowTrigger: "dblclick",
    panelHideTrigger: "dblclick",
    infoPanel: { type: "text", text: "ups", visible: false }
  };
  registerObject(root, root.userData.objJson, { recursive: false });

  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(8, 16, 10),
    new THREE.MeshBasicMaterial()
  );
  shell.userData.objJson = {
    objType: "box",
    threeJsonId: "ups-shell-child"
  };
  root.add(shell);
  scene.add(root);

  const descriptor = normalizeInfoPanelDescriptor({
    threeJsonId: "ups-shell-toggle__infoPanel",
    objType: "infoPanel",
    name: DEVICE_PANEL_NAME,
    type: "text",
    text: "panel",
    visible: false,
    panel: {
      geometry: { width: 20, height: 10, depth: 1 },
      position: { x: 0, y: 0, z: 0 }
    }
  });
  const panel = buildInfoPanelObject(descriptor, { isTexture: true });
  panel.visible = descriptor.visible !== false;
  scene.add(panel);
  registerObject(panel, descriptor, { recursive: false });
  root.userData.objJson.devicePanelRef = "ups-shell-toggle__infoPanel";

  const manager = createEventListenerManager();
  bindDevicePanelActionTriggers(scene, { manager, sceneToken: "canvas-pick-toggle" });
  assert.equal(getBindings("ups-shell-toggle", "dblclick").length, 1);

  const pickedId = resolveThreeJsonIdFromPick(shell, "dblclick");
  assert.equal(pickedId, "ups-shell-toggle");

  const handled = await manager.dispatchPlatformEvent(pickedId, "dblclick", { scene, manager });
  assert.equal(handled, true);
  assert.equal(panel.visible, true);

  await manager.dispatchPlatformEvent(pickedId, "dblclick", { scene, manager, object: shell });
  assert.equal(panel.visible, false);

  manager.dispose();
  clearAllEventBindings();
  clearObjectRegistry();
});

test("getDispatchContext exposes manager and sceneToken from sceneRuntime.eventMechanism", () => {
  const manager = createEventListenerManager();
  const scene = new THREE.Scene();
  const canvas = {
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect() {
      return { width: 100, height: 100, left: 0, top: 0 };
    }
  };
  const host = createCanvasRaycastEventHost({
    canvas,
    scene,
    sceneRuntime: {
      scene,
      eventMechanism: {
        manager,
        sceneToken: "room-show-events"
      }
    }
  });
  assert.equal(host.getDispatchContext().manager, manager);
  assert.equal(host.getDispatchContext().sceneToken, "room-show-events");
  assert.equal(host.getDispatchContext().scene, scene);
  manager.dispose();
});

test("device panel dismissTrigger wires after canvas-style toggle dispatch", async () => {
  clearAllEventBindings();
  clearObjectRegistry();

  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.userData.objJson = {
    objType: "domain",
    domain: "device.ups",
    threeJsonId: "ups-dismiss",
    panelShowTrigger: "dblclick",
    panelHideTrigger: "dblclick",
    infoPanel: { type: "text", text: "ups", visible: false, fix: false }
  };
  registerObject(root, root.userData.objJson, { recursive: false });
  scene.add(root);

  const descriptor = normalizeInfoPanelDescriptor({
    threeJsonId: "ups-dismiss__infoPanel",
    objType: "infoPanel",
    name: DEVICE_PANEL_NAME,
    type: "text",
    text: "panel",
    visible: false,
    fix: false,
    panel: {
      geometry: { width: 20, height: 10, depth: 1 },
      position: { x: 0, y: 0, z: 0 }
    }
  });
  const panel = buildInfoPanelObject(descriptor, { isTexture: true });
  panel.visible = descriptor.visible !== false;
  scene.add(panel);
  registerObject(panel, descriptor, { recursive: false });
  root.userData.objJson.devicePanelRef = "ups-dismiss__infoPanel";

  const canvas = {
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect() {
      return { width: 100, height: 100, left: 0, top: 0 };
    }
  };
  const sceneRuntime = { scene, eventMechanism: null };
  const host = createCanvasRaycastEventHost({ canvas, scene, sceneRuntime });
  const manager = createEventListenerManager({ host });
  sceneRuntime.eventMechanism = { manager, sceneToken: "canvas-dismiss" };

  bindDevicePanelActionTriggers(scene, { manager, sceneToken: "canvas-dismiss" });
  assert.equal(getBindings("ups-dismiss__infoPanel", "dblclick").length, 1);

  const canvasCtx = host.getDispatchContext();
  assert.equal(canvasCtx.manager, manager);
  assert.equal(canvasCtx.sceneToken, "canvas-dismiss");

  await manager.dispatchPlatformEvent("ups-dismiss", "dblclick", canvasCtx);
  assert.equal(panel.visible, true);
  assert.equal(getBindings("ups-dismiss__infoPanel", "dblclick").length, 1);
  assert.equal(getBindings("ups-dismiss__infoPanel", "dblclick")[0].payload?.builtin, "infoPanel.dismiss");

  await manager.dispatchPlatformEvent("ups-dismiss__infoPanel", "dblclick", canvasCtx);
  assert.equal(panel.visible, false);

  manager.dispose();
  clearAllEventBindings();
  clearObjectRegistry();
});

test("getDispatchContext exposes manager and sceneToken from sceneRuntime.eventMechanism", () => {
  const manager = createEventListenerManager();
  const scene = new THREE.Scene();
  const canvas = {
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect() {
      return { width: 100, height: 100, left: 0, top: 0 };
    }
  };
  const host = createCanvasRaycastEventHost({
    canvas,
    scene,
    sceneRuntime: {
      scene,
      eventMechanism: {
        manager,
        sceneToken: "room-show-events"
      }
    }
  });
  assert.equal(host.getDispatchContext().manager, manager);
  assert.equal(host.getDispatchContext().sceneToken, "room-show-events");
  assert.equal(host.getDispatchContext().scene, scene);
  manager.dispose();
});

test("device panel dismissTrigger wires after canvas-style toggle dispatch", async () => {
  clearAllEventBindings();
  clearObjectRegistry();

  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.userData.objJson = {
    objType: "domain",
    domain: "device.ups",
    threeJsonId: "ups-dismiss",
    panelShowTrigger: "dblclick",
    panelHideTrigger: "dblclick",
    infoPanel: { type: "text", text: "ups", visible: false, fix: false }
  };
  registerObject(root, root.userData.objJson, { recursive: false });
  scene.add(root);

  const descriptor = normalizeInfoPanelDescriptor({
    threeJsonId: "ups-dismiss__infoPanel",
    objType: "infoPanel",
    name: DEVICE_PANEL_NAME,
    type: "text",
    text: "panel",
    visible: false,
    fix: false,
    panel: {
      geometry: { width: 20, height: 10, depth: 1 },
      position: { x: 0, y: 0, z: 0 }
    }
  });
  const panel = buildInfoPanelObject(descriptor, { isTexture: true });
  panel.visible = descriptor.visible !== false;
  scene.add(panel);
  registerObject(panel, descriptor, { recursive: false });
  root.userData.objJson.devicePanelRef = "ups-dismiss__infoPanel";

  const canvas = {
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect() {
      return { width: 100, height: 100, left: 0, top: 0 };
    }
  };
  const sceneRuntime = { scene, eventMechanism: null };
  const host = createCanvasRaycastEventHost({ canvas, scene, sceneRuntime });
  const manager = createEventListenerManager({ host });
  sceneRuntime.eventMechanism = { manager, sceneToken: "canvas-dismiss" };

  bindDevicePanelActionTriggers(scene, { manager, sceneToken: "canvas-dismiss" });
  assert.equal(getBindings("ups-dismiss__infoPanel", "dblclick").length, 1);

  const canvasCtx = host.getDispatchContext();
  assert.equal(canvasCtx.manager, manager);
  assert.equal(canvasCtx.sceneToken, "canvas-dismiss");

  await manager.dispatchPlatformEvent("ups-dismiss", "dblclick", canvasCtx);
  assert.equal(panel.visible, true);
  assert.equal(getBindings("ups-dismiss__infoPanel", "dblclick").length, 1);
  assert.equal(getBindings("ups-dismiss__infoPanel", "dblclick")[0].payload?.builtin, "infoPanel.dismiss");

  await manager.dispatchPlatformEvent("ups-dismiss__infoPanel", "dblclick", canvasCtx);
  assert.equal(panel.visible, false);

  manager.dispose();
  clearAllEventBindings();
  clearObjectRegistry();
});

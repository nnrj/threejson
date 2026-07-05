import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import { buildInfoPanelObject, normalizeInfoPanelDescriptor } from "../core/builder/infoPanelBuilder.js";
import {
  setInfoPanelVisibleByThreeJsonId,
  updateInfoPanel
} from "../core/handler/infoPanelRuntime.js";
import { clearObjectRegistry, getObjectByThreeJsonId, registerObject } from "../core/handler/objectRegistry.js";
import {
  bindSceneEventRuntime,
  clearAllEventBindings,
  getBindings,
  wireInfoPanelDismissTriggerForObject
} from "../core/runtime/eventMechanism/index.js";

/**
 * @param {THREE.Scene} scene
 * @param {object} raw
 * @returns {import("three").Object3D}
 */
function deployTestInfoPanel(scene, raw) {
  const descriptor = normalizeInfoPanelDescriptor(raw);
  const object3D = buildInfoPanelObject(descriptor, { isTexture: true });
  object3D.visible = descriptor.visible !== false;
  scene.add(object3D);
  registerObject(object3D, descriptor, { recursive: false });
  return object3D;
}

test("deploy registers object and applies visible false", () => {
  clearObjectRegistry();
  const scene = new THREE.Scene();
  const panel = deployTestInfoPanel(scene, {
    threeJsonId: "panel-test-1",
    text: "hello",
    visible: false
  });
  assert.equal(panel.visible, false);
  assert.equal(getObjectByThreeJsonId("panel-test-1"), panel);
  assert.equal(panel.name, "infoPanel");
});

test("setInfoPanelVisibleByThreeJsonId toggles visibility", () => {
  clearObjectRegistry();
  const scene = new THREE.Scene();
  deployTestInfoPanel(scene, {
    threeJsonId: "panel-test-2",
    text: "hello",
    visible: false
  });
  assert.equal(setInfoPanelVisibleByThreeJsonId("panel-test-2", true), true);
  assert.equal(getObjectByThreeJsonId("panel-test-2")?.visible, true);
});

test("omit fix does not wire dismiss binding", async () => {
  clearAllEventBindings();
  clearObjectRegistry();
  const scene = new THREE.Scene();
  const handle = await bindSceneEventRuntime(scene, { sceneToken: "omit-fix" });
  deployTestInfoPanel(scene, {
    threeJsonId: "panel-omit-fix",
    name: "infoPanel",
    type: "text",
    text: "static",
    visible: true
  });
  wireInfoPanelDismissTriggerForObject(getObjectByThreeJsonId("panel-omit-fix"), {
    manager: handle.manager,
    sceneToken: "omit-fix"
  });
  assert.equal(getBindings("panel-omit-fix", "dblclick").length, 0);
  await handle.dispose();
  clearAllEventBindings();
  clearObjectRegistry();
});

test("late-deployed info panels wire dismiss when fix false", async () => {
  clearAllEventBindings();
  clearObjectRegistry();
  const scene = new THREE.Scene();
  const handle = await bindSceneEventRuntime(scene, { sceneToken: "sync-dismiss" });
  deployTestInfoPanel(scene, {
    threeJsonId: "env-panel-sync",
    name: "infoPanel",
    type: "text",
    text: "env",
    fix: false,
    visible: true
  });
  wireInfoPanelDismissTriggerForObject(getObjectByThreeJsonId("env-panel-sync"), {
    manager: handle.manager,
    sceneToken: "sync-dismiss"
  });
  const bindings = getBindings("env-panel-sync", "dblclick");
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].payload?.builtin, "infoPanel.dismiss");
  await handle.dispose();
  clearAllEventBindings();
  clearObjectRegistry();
});

test("updateInfoPanel rebinds dismiss when fix changes", async () => {
  clearAllEventBindings();
  clearObjectRegistry();
  const scene = new THREE.Scene();
  const handle = await bindSceneEventRuntime(scene, { sceneToken: "rebind-fix" });
  deployTestInfoPanel(scene, {
    threeJsonId: "panel-rebind",
    name: "infoPanel",
    type: "text",
    text: "env",
    fix: false,
    visible: true
  });
  wireInfoPanelDismissTriggerForObject(getObjectByThreeJsonId("panel-rebind"), {
    manager: handle.manager,
    sceneToken: "rebind-fix"
  });
  assert.equal(getBindings("panel-rebind", "dblclick").length, 1);
  await updateInfoPanel("panel-rebind", { fix: true }, { scene });
  assert.equal(getBindings("panel-rebind", "dblclick").length, 0);
  await handle.dispose();
  clearAllEventBindings();
  clearObjectRegistry();
});

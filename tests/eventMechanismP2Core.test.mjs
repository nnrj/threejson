import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import { clearObjectRegistry, registerObject } from "../core/handler/objectRegistry.js";
import { resolveBindSceneEvents } from "../core/runtime/eventMechanism/resolveBindSceneEvents.js";
import { isEventScriptReference } from "../core/runtime/eventMechanism/scriptReference.js";
import { resolveInfoPanelDismissTrigger } from "../core/runtime/eventMechanism/infoPanelDismissTrigger.js";
import { resolveEventScriptMode } from "../core/runtime/eventMechanism/eventScript/config.js";
import { resolveEventScriptSource } from "../core/runtime/eventMechanism/resolveEventScriptSource.js";
import {
  addBinding,
  clearAllEventBindings,
  createEventListenerManager,
  getBindings,
  normalizeEventActions,
  registerEventAction,
  _restoreEventActionRegistryForTests,
  _snapshotEventActionRegistryForTests
} from "../core/runtime/eventMechanism/index.js";

test("resolveBindSceneEvents merges JSON and caller options", () => {
  assert.equal(resolveBindSceneEvents({}, null, {}), true);
  assert.equal(
    resolveBindSceneEvents({ sceneConfig: { interaction: { bindSceneEvents: false } } }, null, {}),
    false
  );
  assert.equal(
    resolveBindSceneEvents({ sceneConfig: { interaction: { bindSceneEvents: false } } }, null, {
      bindSceneEvents: true
    }),
    true
  );
});

test("isEventScriptReference detects lib and http URLs", () => {
  assert.equal(isEventScriptReference("lib://script-a"), true);
  assert.equal(isEventScriptReference("https://example.com/a.dsl"), true);
  assert.equal(isEventScriptReference("./scripts/a.dsl"), true);
  assert.equal(isEventScriptReference("/assets/scripts/a.dsl"), true);
  assert.equal(isEventScriptReference("self.moveBy(1,0,0)"), false);
});

test("isEventScriptReference treats // and /* script comments as inline", () => {
  assert.equal(isEventScriptReference("// EventScript DSL\nself.moveBy(1,0,0)"), false);
  assert.equal(isEventScriptReference("/* block */\nself.moveBy(1,0,0)"), false);
});

test("resolveInfoPanelDismissTrigger respects fix primary and dismissTrigger advanced", () => {
  assert.equal(resolveInfoPanelDismissTrigger({ fix: true }), "none");
  assert.equal(resolveInfoPanelDismissTrigger({ fix: true, dismissTrigger: "dblclick" }), "none");
  assert.equal(resolveInfoPanelDismissTrigger({ fix: false }), "dblclick");
  assert.equal(resolveInfoPanelDismissTrigger({ fix: false, dismissTrigger: "none" }), "dblclick");
  assert.equal(resolveInfoPanelDismissTrigger({ fix: false, dismissTrigger: "click" }), "click");
  assert.equal(resolveInfoPanelDismissTrigger({ dismissTrigger: "click" }), "none");
  assert.equal(resolveInfoPanelDismissTrigger({}), "none");
});

test("resolveEventScriptMode prefers per-event mode", () => {
  assert.equal(resolveEventScriptMode({ eventScript: { mode: "dsl" } }, { mode: "javascript" }), "javascript");
  assert.equal(resolveEventScriptMode({ eventScript: { mode: "javascript" } }, { mode: "dsl" }), "dsl");
});

test("resolveEventScriptSource reads URL from unified script field", async () => {
  const hit = await resolveEventScriptSource(
    { script: "lib://missing-token" },
    { threeJsonId: "tj-a", eventName: "click" }
  );
  assert.equal(hit, null);
});

test("normalizeEventActions prepends action shorthand before actions array", () => {
  const actions = normalizeEventActions({
    action: { type: "object.moveBy", delta: { x: 1 } },
    actions: [
      { type: "object.toggleVisible" },
      { type: "object.setVisible", visible: true }
    ]
  });
  assert.deepEqual(actions.map((a) => a.type), [
    "object.moveBy",
    "object.toggleVisible",
    "object.setVisible"
  ]);
});

test("ELM executes domain, actions, script, handler in order", async () => {
  const snapshot = _snapshotEventActionRegistryForTests();
  clearAllEventBindings();
  clearObjectRegistry();
  const calls = [];
  registerEventAction("test.order", () => {
    calls.push("action");
  });
  const manager = createEventListenerManager({
    coreBindingExecutor: async () => {
      calls.push("script");
    }
  });
  const object = new THREE.Mesh();
  object.userData.objJson = {
    threeJsonId: "order-box",
    objType: "box"
  };
  registerObject(object, object.userData.objJson, { recursive: false });
  addBinding({
    threeJsonId: "order-box",
    eventName: "click",
    source: "json",
    objType: "box",
    executorKind: "core",
    payload: {
      actions: [{ type: "test.order" }],
      scriptText: "noop",
      eventConfig: {
        action: { type: "test.order" },
        script: "noop"
      }
    }
  });
  addBinding({
    threeJsonId: "order-box",
    eventName: "click",
    source: "runtime",
    objType: "box",
    executorKind: "core",
    payload: {
      handler: () => calls.push("handler")
    }
  });
  await manager.dispatchPlatformEvent("order-box", "click");
  assert.deepEqual(calls, ["action", "script", "handler"]);
  manager.dispose();
  clearAllEventBindings();
  clearObjectRegistry();
  _restoreEventActionRegistryForTests(snapshot);
});

test("continueOnError lets later actions and script continue", async () => {
  const snapshot = _snapshotEventActionRegistryForTests();
  clearAllEventBindings();
  clearObjectRegistry();
  const calls = [];
  registerEventAction("test.fail", () => {
    calls.push("fail");
    throw new Error("boom");
  });
  registerEventAction("test.next", () => {
    calls.push("next");
  });
  const manager = createEventListenerManager({
    coreBindingExecutor: async () => {
      calls.push("script");
    }
  });
  const object = new THREE.Mesh();
  object.userData.objJson = {
    threeJsonId: "continue-box",
    objType: "box"
  };
  registerObject(object, object.userData.objJson, { recursive: false });
  addBinding({
    threeJsonId: "continue-box",
    eventName: "click",
    source: "json",
    objType: "box",
    executorKind: "core",
    payload: {
      actions: [
        { type: "test.fail", continueOnError: true },
        { type: "test.next" }
      ],
      scriptText: "noop",
      eventConfig: {
        actions: [
          { type: "test.fail", continueOnError: true },
          { type: "test.next" }
        ],
        script: "noop"
      }
    }
  });
  await manager.dispatchPlatformEvent("continue-box", "click");
  assert.deepEqual(calls, ["fail", "next", "script"]);
  manager.dispose();
  clearAllEventBindings();
  clearObjectRegistry();
  _restoreEventActionRegistryForTests(snapshot);
});

test("object.patch action defaults to sync descriptor mutation", async () => {
  clearAllEventBindings();
  clearObjectRegistry();
  const manager = createEventListenerManager();
  const object = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: "#ffffff" })
  );
  object.userData.objJson = {
    threeJsonId: "patch-box",
    objType: "box",
    position: { x: 0, y: 0, z: 0 }
  };
  registerObject(object, object.userData.objJson, { recursive: false });
  addBinding({
    threeJsonId: "patch-box",
    eventName: "click",
    source: "json",
    objType: "box",
    executorKind: "core",
    payload: {
      actions: [{ type: "object.patch", partial: { position: { x: 2, y: 0, z: 0 } } }],
      eventConfig: {
        action: { type: "object.patch", partial: { position: { x: 2, y: 0, z: 0 } } }
      }
    }
  });
  await manager.dispatchPlatformEvent("patch-box", "click");
  assert.equal(object.position.x, 2);
  assert.deepEqual(object.userData.objJson.position, { x: 2, y: 0, z: 0 });
  manager.dispose();
  clearAllEventBindings();
  clearObjectRegistry();
});

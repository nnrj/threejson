import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import { clearObjectRegistry, registerObject, unregisterObject } from "../core/handler/objectRegistry.js";
import { setUserDataObjJson } from "../core/handler/objectDescriptorAttach.js";
import {
  addBinding,
  attachEventListenerManager,
  bindEvent,
  buildBindingMetadataFromObject,
  clearAllEventBindings,
  clearBindingsForScene,
  clearBindingsForThreeJsonId,
  createEventListenerManager,
  deriveExecutorKind,
  detachEventListenerManager,
  getBindings,
  getEventBindingRegistrySnapshot,
  getThreeJsonIdsWithBindingsForEvent,
  isEventAllowedForObjType,
  isPlatformEventName,
  listObjTypeEventCapabilities,
  removeBinding,
  unbindEvent
} from "../core/runtime/eventMechanism/index.js";
import { registerDomain } from "../core/handler/businessDomainRegistry.js";

test("platform event catalog rejects unknown names", () => {
  assert.ok(isPlatformEventName("click"));
  assert.ok(isPlatformEventName("scene.ready"));
  assert.ok(isPlatformEventName("scene.dispose"));
  assert.ok(isPlatformEventName("object.ready"));
  assert.ok(isPlatformEventName("object.dispose"));
  assert.ok(isPlatformEventName("pointerover"));
  assert.ok(isPlatformEventName("pointerout"));
  assert.equal(isPlatformEventName("door.open"), false);
  assert.equal(isPlatformEventName(""), false);
});

test("objType capability registry seeds box and domain subsets", () => {
  assert.ok(isEventAllowedForObjType("box", "click"));
  assert.ok(isEventAllowedForObjType("box", "pointerover"));
  assert.ok(isEventAllowedForObjType("domain", "pointerout"));
  assert.ok(isEventAllowedForObjType("box", "object.ready"));
  assert.ok(isEventAllowedForObjType("box", "scene.ready"));
  assert.ok(isEventAllowedForObjType("domain", "scene.ready"));
  assert.ok(isEventAllowedForObjType("camera", "scene.dispose"));
  assert.ok(isEventAllowedForObjType("light", "scene.ready"));
  assert.equal(isEventAllowedForObjType("camera", "object.ready"), false);
  assert.ok(listObjTypeEventCapabilities("box").includes("dblclick"));
  assert.ok(listObjTypeEventCapabilities("box").includes("pointerover"));
  assert.ok(listObjTypeEventCapabilities("box").includes("object.dispose"));
});

test("deriveExecutorKind uses generic domain rule without domain special cases", () => {
  assert.equal(deriveExecutorKind({ objType: "box" }), "core");
  assert.equal(deriveExecutorKind({ objType: "domain", domain: "door" }), "domain");
  assert.equal(deriveExecutorKind({ objType: "door", domain: "door" }), "core");
});

test("eventBindingRegistry indexes by eventName and clears by threeJsonId", () => {
  clearAllEventBindings();
  const entry = addBinding({
    threeJsonId: "tj-box-1",
    eventName: "click",
    source: "runtime",
    objType: "box",
    executorKind: "core",
    payload: { handler: () => {} }
  });
  assert.ok(entry);
  assert.equal(getBindings("tj-box-1", "click").length, 1);
  assert.deepEqual(getThreeJsonIdsWithBindingsForEvent("click"), ["tj-box-1"]);
  assert.equal(clearBindingsForThreeJsonId("tj-box-1"), 1);
  assert.equal(getBindings("tj-box-1", "click").length, 0);
  assert.equal(getEventBindingRegistrySnapshot().bindingCount, 0);
});

test("clearBindingsForScene removes only tagged bindings", () => {
  clearAllEventBindings();
  addBinding({
    threeJsonId: "tj-a",
    eventName: "click",
    source: "runtime",
    objType: "box",
    executorKind: "core",
    sceneToken: "scene-1"
  });
  addBinding({
    threeJsonId: "tj-b",
    eventName: "click",
    source: "runtime",
    objType: "box",
    executorKind: "core",
    sceneToken: "scene-2"
  });
  assert.equal(clearBindingsForScene("scene-1"), 1);
  assert.equal(getBindings("tj-a").length, 0);
  assert.equal(getBindings("tj-b").length, 1);
  clearAllEventBindings();
});

test("bindEvent resolves objectRegistry target and activates ELM refcount", () => {
  clearObjectRegistry();
  clearAllEventBindings();
  const manager = createEventListenerManager();
  attachEventListenerManager(manager, "demo-scene");

  const box = new THREE.Mesh();
  setUserDataObjJson(box, {
    threeJsonId: "tj-demo-box",
    objType: "box",
    name: "demo-box"
  });
  registerObject(box, box.userData.objJson, { recursive: false });

  let calls = 0;
  const bindingId = bindEvent("tj-demo-box", "click", () => {
    calls += 1;
  }, { manager });
  assert.ok(bindingId);
  assert.equal(manager.getActivationRefcount("click"), 1);

  return manager.dispatchPlatformEvent("tj-demo-box", "click").then((handled) => {
    assert.equal(handled, true);
    assert.equal(calls, 1);
    assert.ok(unbindEvent(bindingId, { manager }));
    assert.equal(manager.getActivationRefcount("click"), 0);
    manager.dispose();
    detachEventListenerManager();
    clearObjectRegistry();
    clearAllEventBindings();
  });
});

test("ELM dispatches domain bindings via executeBoundEvent contract", async () => {
  clearAllEventBindings();
  const manager = createEventListenerManager();
  const domainId = "testEventMechanismElm";
  let domainCalls = 0;

  registerDomain({
    id: domainId,
    api: {},
    executeBoundEvent: async (ctx) => {
      domainCalls += 1;
      assert.equal(ctx.eventName, "dblclick");
      assert.equal(ctx.domainKey, domainId);
      assert.equal(ctx.threeJsonId, "tj-door-root");
    }
  });

  addBinding({
    threeJsonId: "tj-door-root",
    eventName: "dblclick",
    source: "runtime",
    objType: "domain",
    domainKey: domainId,
    executorKind: "domain",
    payload: { trigger: "explicit" }
  });
  manager.notifyBindingAdded("dblclick");

  const handled = await manager.dispatchPlatformEvent("tj-door-root", "dblclick");
  assert.equal(handled, true);
  assert.equal(domainCalls, 1);
  manager.dispose();
  clearAllEventBindings();
});

test("unregisterObject lifecycle clears bindings via clearBindingsForThreeJsonId", () => {
  clearObjectRegistry();
  clearAllEventBindings();
  const mesh = new THREE.Mesh();
  setUserDataObjJson(mesh, { threeJsonId: "tj-life", objType: "box", name: "life-box" });
  registerObject(mesh, mesh.userData.objJson, { recursive: false });
  addBinding({
    threeJsonId: "tj-life",
    eventName: "click",
    source: "json",
    objType: "box",
    executorKind: "core",
    payload: { scriptText: "noop" }
  });
  unregisterObject(mesh, { recursive: false });
  assert.equal(clearBindingsForThreeJsonId("tj-life"), 1);
  assert.equal(getBindings("tj-life").length, 0);
  clearObjectRegistry();
});

test("buildBindingMetadataFromObject reads userData.objJson", () => {
  const object = new THREE.Group();
  setUserDataObjJson(object, {
    threeJsonId: "tj-meta",
    objType: "domain",
    domain: "device.cabinet"
  });
  const meta = buildBindingMetadataFromObject(object);
  assert.deepEqual(meta, {
    threeJsonId: "tj-meta",
    objType: "domain",
    domainKey: "device.cabinet",
    executorKind: "domain"
  });
});

test("removeBinding returns removed entry for unbind refcount", () => {
  clearAllEventBindings();
  const manager = createEventListenerManager();
  const entry = addBinding({
    threeJsonId: "tj-rm",
    eventName: "click",
    source: "runtime",
    objType: "box",
    executorKind: "core"
  });
  manager.notifyBindingAdded("click");
  const removed = removeBinding(entry.id);
  assert.equal(removed?.id, entry.id);
  manager.notifyBindingRemoved(removed.eventName);
  assert.equal(manager.getActivationRefcount("click"), 0);
  manager.dispose();
  clearAllEventBindings();
});

import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import { clearObjectRegistry, registerObject } from "../core/handler/objectRegistry.js";
import { setUserDataObjJson } from "../core/handler/objectDescriptorAttach.js";
import { registerDomain } from "../core/handler/businessDomainRegistry.js";
import {
  addBinding,
  bindEvent,
  bindEventsFromRecord,
  bindSceneEventRuntime,
  clearAllEventBindings,
  collectRejectedEventConfigs,
  createEventListenerManager,
  getBindings,
  getRejectedEventConfigReason
} from "../core/runtime/eventMechanism/index.js";

test("rejects legacy events.handler strings", () => {
  const reason = getRejectedEventConfigReason({ handler: "door.toggle" });
  assert.ok(reason?.includes("handler strings"));
  const reasons = collectRejectedEventConfigs({
    click: { handler: "door.toggle" },
    dblclick: { script: "noop" }
  }, "tj-x");
  assert.equal(reasons.length, 1);
  assert.ok(reasons[0].includes("click"));
});

test("bindEventsFromRecord binds inline script from JSON", async () => {
  clearObjectRegistry();
  clearAllEventBindings();
  const manager = createEventListenerManager();
  const mesh = new THREE.Mesh();
  setUserDataObjJson(mesh, {
    threeJsonId: "tj-json-box",
    objType: "box",
    events: {
      click: {
        script: "self.moveBy(-1,0,0)"
      },
      invalid: {
        handler: "legacy"
      }
    }
  });
  registerObject(mesh, mesh.userData.objJson, { recursive: false });

  const ids = await bindEventsFromRecord(mesh, { manager, sceneToken: "s1" });
  assert.equal(ids.length, 1);
  const bindings = getBindings("tj-json-box", "click");
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].source, "json");
  assert.equal(bindings[0].payload.scriptText, "self.moveBy(-1,0,0)");
  assert.equal(manager.getActivationRefcount("click"), 1);
  manager.dispose();
  clearAllEventBindings();
  clearObjectRegistry();
});

test("bindSceneEventRuntime wires scene and supports rebind", async () => {
  clearObjectRegistry();
  clearAllEventBindings();
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh();
  setUserDataObjJson(mesh, {
    threeJsonId: "tj-scene-box",
    objType: "box",
    events: {
      click: { script: "v1" }
    }
  });
  scene.add(mesh);
  registerObject(mesh, mesh.userData.objJson, { recursive: false });

  const handle = await bindSceneEventRuntime(scene, { sceneToken: "demo-token" });
  assert.equal(handle.bindingIds.length, 1);
  assert.equal(getBindings("tj-scene-box", "click")[0].payload.scriptText, "v1");

  mesh.userData.objJson.events.click.script = "v2";
  const reboundIds = await handle.rebind();
  assert.equal(reboundIds.length, 1);
  assert.equal(getBindings("tj-scene-box", "click")[0].payload.scriptText, "v2");

  await handle.dispose();
  assert.equal(getBindings("tj-scene-box").length, 0);
  clearObjectRegistry();
});

test("bindEvent supports batch target selectors", () => {
  clearObjectRegistry();
  clearAllEventBindings();
  const manager = createEventListenerManager();

  const a = new THREE.Mesh();
  setUserDataObjJson(a, { threeJsonId: "tj-a", objType: "box" });
  registerObject(a, a.userData.objJson, { recursive: false });

  const b = new THREE.Mesh();
  setUserDataObjJson(b, { threeJsonId: "tj-b", objType: "box" });
  registerObject(b, b.userData.objJson, { recursive: false });

  const ids = bindEvent(["tj-a", "tj-b"], "click", () => {}, { manager });
  assert.ok(Array.isArray(ids));
  assert.equal(ids.length, 2);
  manager.dispose();
  clearAllEventBindings();
  clearObjectRegistry();
});

test("domain executeBoundEvent is invoked through ELM dispatch", async () => {
  clearAllEventBindings();
  const domainId = "testEventMechanism";
  registerDomain({
    id: domainId,
    api: {},
    executeBoundEvent: async (ctx) => {
      ctx.payload.received = true;
    }
  });

  const manager = createEventListenerManager();
  const root = new THREE.Group();
  setUserDataObjJson(root, {
    threeJsonId: "tj-domain-root",
    objType: "domain",
    domain: domainId
  });
  clearObjectRegistry();
  registerObject(root, root.userData.objJson, { recursive: false });

  const payload = { marker: 1 };
  bindEvent("tj-domain-root", "dblclick", payload, { manager });
  await manager.dispatchPlatformEvent("tj-domain-root", "dblclick");
  assert.equal(payload.received, true);
  manager.dispose();
  clearAllEventBindings();
  clearObjectRegistry();
});

test("ELM canvas listener without pick resolver does not broadcast bindings", async () => {
  clearAllEventBindings();
  let calls = 0;
  /** @type {{ _handler?: (ev: object) => void, addEventListener: Function, removeEventListener: Function }} */
  const canvas = {
    addEventListener(_event, handler) {
      canvas._handler = handler;
    },
    removeEventListener() {}
  };
  const manager = createEventListenerManager({ host: { canvas } });
  addBinding({
    threeJsonId: "tj-no-broadcast",
    eventName: "click",
    source: "runtime",
    objType: "box",
    executorKind: "core",
    payload: { handler: () => { calls += 1; } }
  });
  manager.notifyBindingAdded("click");
  assert.equal(typeof canvas._handler, "function");
  canvas._handler({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 0);
  manager.dispose();
  clearAllEventBindings();
});

test("ELM canvas listener dispatches only picked threeJsonId", async () => {
  clearAllEventBindings();
  let calls = 0;
  /** @type {{ _handler?: (ev: object) => void, addEventListener: Function, removeEventListener: Function }} */
  const canvas = {
    addEventListener(_event, handler) {
      canvas._handler = handler;
    },
    removeEventListener() {}
  };
  const manager = createEventListenerManager({
    host: {
      canvas,
      resolvePickThreeJsonId(_eventName, _nativeEvent) {
        return "tj-picked";
      }
    }
  });
  addBinding({
    threeJsonId: "tj-picked",
    eventName: "click",
    source: "runtime",
    objType: "box",
    executorKind: "core",
    payload: { handler: () => { calls += 1; } }
  });
  addBinding({
    threeJsonId: "tj-other",
    eventName: "click",
    source: "runtime",
    objType: "box",
    executorKind: "core",
    payload: { handler: () => { calls += 10; } }
  });
  manager.notifyBindingAdded("click");
  canvas._handler({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 1);
  manager.dispose();
  clearAllEventBindings();
});

import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import { clearObjectRegistry, registerObject } from "../core/handler/objectRegistry.js";
import { setUserDataObjJson } from "../core/handler/objectDescriptorAttach.js";
import { registerDomain } from "../core/handler/businessDomainRegistry.js";
import { registerAssetLibrary } from "../core/cache/assetRegistry.js";
import {
  addBinding,
  clearAllEventBindings,
  createCoreBindingExecutor,
  createEventListenerManager,
  parseEventScript,
  partitionBindingsForExecution,
  resolveEventScriptSource,
  runEventScript,
  runJavaScriptEventScript
} from "../core/runtime/eventMechanism/index.js";

test("parseEventScript supports self.moveBy and await wait", () => {
  const ast = parseEventScript("self.moveBy(-1, 0, 0)\nawait wait(10)\nself.moveBy(1, 0, 0)");
  assert.equal(ast.body.length, 3);
  assert.equal(ast.body[1].type, "AwaitWait");
});

test("parseEventScript supports unary minus on identifiers", () => {
  const ast = parseEventScript("var nudge = 28\nself.moveBy(-nudge, 0, 0)");
  assert.equal(ast.body.length, 2);
  const moveCall = ast.body[1].expression;
  assert.equal(moveCall.type, "CallExpression");
  assert.equal(moveCall.args[0].type, "UnaryExpression");
  assert.equal(moveCall.args[0].operator, "-");
});

test("runEventScript applies unary minus variable in moveBy", async () => {
  clearObjectRegistry();
  const mesh = new THREE.Mesh();
  setUserDataObjJson(mesh, {
    threeJsonId: "tj-unary-minus",
    objType: "box",
    position: { x: 0, y: 0, z: 0 }
  });
  mesh.position.set(0, 0, 0);
  registerObject(mesh, mesh.userData.objJson, { recursive: false });

  await runEventScript(
    "var nudge = 28\nself.moveBy(-nudge, 0, 0)",
    { object: mesh, threeJsonId: "tj-unary-minus", eventName: "click" }
  );
  assert.equal(mesh.position.x, -28);
  clearObjectRegistry();
});

test("runJavaScriptEventScript supports await wait in script body", async () => {
  clearObjectRegistry();
  const mesh = new THREE.Mesh();
  setUserDataObjJson(mesh, {
    threeJsonId: "tj-js-await",
    objType: "box",
    position: { x: 0, y: 0, z: 0 }
  });
  mesh.position.set(0, 0, 0);
  registerObject(mesh, mesh.userData.objJson, { recursive: false });

  await runJavaScriptEventScript(
    "self.moveBy(3, 0, 0);\nawait wait(1);\nself.moveBy(2, 0, 0);",
    { object: mesh, threeJsonId: "tj-js-await", eventName: "click" }
  );
  assert.equal(mesh.position.x, 5);
  clearObjectRegistry();
});

test("runEventScript moves host object via moveBy", async () => {
  clearObjectRegistry();
  const mesh = new THREE.Mesh();
  setUserDataObjJson(mesh, {
    threeJsonId: "tj-move",
    objType: "box",
    position: { x: 0, y: 0, z: 0 }
  });
  mesh.position.set(0, 0, 0);
  registerObject(mesh, mesh.userData.objJson, { recursive: false });

  await runEventScript("self.moveBy(5, 2, -1)", { object: mesh, threeJsonId: "tj-move", eventName: "click" });
  assert.equal(mesh.position.x, 5);
  assert.equal(mesh.position.y, 2);
  assert.equal(mesh.position.z, -1);
  clearObjectRegistry();
});

test("runEventScript resolves $('token') variable", async () => {
  clearObjectRegistry();
  const host = new THREE.Mesh();
  setUserDataObjJson(host, { threeJsonId: "tj-host", objType: "box", position: { x: 0, y: 0, z: 0 } });
  registerObject(host, host.userData.objJson, { recursive: false });

  const target = new THREE.Mesh();
  setUserDataObjJson(target, {
    threeJsonId: "tj-target",
    objType: "box",
    refName: "target-box",
    visible: true
  });
  target.visible = true;
  registerObject(target, target.userData.objJson, { recursive: false });

  await runEventScript(
    "var panel = $('target-box')\npanel.visible = false",
    { object: host, threeJsonId: "tj-host", eventName: "click" }
  );
  assert.equal(target.visible, false);
  clearObjectRegistry();
});

test("resolveEventScriptSource resolves lib:// eventScript entries", async () => {
  registerAssetLibrary([
    {
      threeJsonId: "script-click-move",
      assetKind: "eventScript",
      source: "self.moveBy(1,0,0)"
    }
  ]);
  const resolved = await resolveEventScriptSource({
    scriptUrl: "lib://script-click-move"
  }, { threeJsonId: "tj-lib" });
  assert.equal(resolved?.kind, "lib");
  assert.equal(resolved?.source, "self.moveBy(1,0,0)");
});

test("core binding executor runs JSON script binding", async () => {
  clearObjectRegistry();
  clearAllEventBindings();
  const mesh = new THREE.Mesh();
  setUserDataObjJson(mesh, {
    threeJsonId: "tj-exec",
    objType: "box",
    position: { x: 0, y: 0, z: 0 }
  });
  mesh.position.set(0, 0, 0);
  registerObject(mesh, mesh.userData.objJson, { recursive: false });

  const manager = createEventListenerManager({
    coreBindingExecutor: createCoreBindingExecutor()
  });
  addBinding({
    threeJsonId: "tj-exec",
    eventName: "click",
    source: "json",
    objType: "box",
    executorKind: "core",
    payload: { scriptText: "self.moveBy(10, 0, 0)" }
  });
  manager.notifyBindingAdded("click");
  await manager.dispatchPlatformEvent("tj-exec", "click");
  assert.equal(mesh.position.x, 10);
  manager.dispose();
  clearAllEventBindings();
  clearObjectRegistry();
});

test("partitionBindingsForExecution orders domain before script", () => {
  const domainBinding = {
    id: "d1",
    executorKind: "domain",
    payload: { trigger: true }
  };
  const scriptBinding = {
    id: "s1",
    executorKind: "domain",
    payload: { scriptText: "noop" }
  };
  const parts = partitionBindingsForExecution([scriptBinding, domainBinding]);
  assert.deepEqual(
    parts.domainBindings.map((b) => b.id),
    ["d1"]
  );
  assert.deepEqual(
    parts.scriptBindings.map((b) => b.id),
    ["s1"]
  );
});

test("ELM runs domain executeBoundEvent before script on same event", async () => {
  clearAllEventBindings();
  const order = [];
  const domainId = "testEventOrder";
  registerDomain({
    id: domainId,
    api: {},
    executeBoundEvent: async () => {
      order.push("domain");
    }
  });

  addBinding({
    threeJsonId: "tj-order",
    eventName: "click",
    source: "runtime",
    objType: "domain",
    domainKey: domainId,
    executorKind: "domain",
    payload: { trigger: true }
  });
  addBinding({
    threeJsonId: "tj-order",
    eventName: "click",
    source: "json",
    objType: "domain",
    domainKey: domainId,
    executorKind: "domain",
    payload: { scriptText: "self.moveBy(0,0,0)" }
  });

  const manager = createEventListenerManager({
    coreBindingExecutor: async () => {
      order.push("script");
    }
  });
  manager.notifyBindingAdded("click");

  const mesh = new THREE.Mesh();
  setUserDataObjJson(mesh, { threeJsonId: "tj-order", objType: "domain", domain: domainId });
  registerObject(mesh, mesh.userData.objJson, { recursive: false });

  await manager.dispatchPlatformEvent("tj-order", "click", { object: mesh });
  assert.deepEqual(order, ["domain", "script"]);
  manager.dispose();
  clearAllEventBindings();
  clearObjectRegistry();
});

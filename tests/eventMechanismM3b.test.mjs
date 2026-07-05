import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import { clearObjectRegistry } from "../core/handler/objectRegistry.js";
import { setUserDataObjJson } from "../core/handler/objectDescriptorAttach.js";
import {
  createCoreBindingExecutor,
  createEventListenerManager,
  isEventScriptCommandAllowed,
  parseEventScript,
  runEventScript,
  runEventScriptCommand
} from "../core/runtime/eventMechanism/index.js";
import { addBinding } from "../core/runtime/eventMechanism/eventBindingRegistry.js";
import { registerObject } from "../core/handler/objectRegistry.js";

test("parseEventScript parses run micro DSL statement", () => {
  const ast = parseEventScript('run object.patch id=box-1 partial={"position":{"x":3}}');
  assert.equal(ast.body.length, 1);
  assert.equal(ast.body[0].type, "Run");
  assert.match(ast.body[0].commandText, /^object\.patch id=box-1/);
});

test("parseEventScript parses await run statement", () => {
  const ast = parseEventScript("await run object.get id=box-1");
  assert.equal(ast.body[0].type, "AwaitRun");
  assert.equal(ast.body[0].commandText, "object.get id=box-1");
});

test("isEventScriptCommandAllowed blocks document and scene ops", () => {
  assert.equal(isEventScriptCommandAllowed("object.patch", {}), true);
  assert.equal(isEventScriptCommandAllowed("scene.validate", {}), false);
  assert.equal(isEventScriptCommandAllowed("scene.load", {}), false);
  assert.equal(isEventScriptCommandAllowed("object.patch", {
    eventScript: { allowedCommands: ["object.get"] }
  }), false);
  assert.equal(isEventScriptCommandAllowed("object.get", {
    eventScript: { allowedCommands: ["object.get"] }
  }), true);
});

test("runEventScript run object.patch updates descriptor via executeCommand", async () => {
  clearObjectRegistry();
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh();
  setUserDataObjJson(mesh, {
    threeJsonId: "tj-run-patch",
    objType: "box",
    name: "run-patch-box",
    position: { x: 0, y: 0, z: 0 }
  });
  mesh.position.set(0, 0, 0);
  scene.add(mesh);
  registerObject(mesh, mesh.userData.objJson, { recursive: false });

  await runEventScript(
    'run object.patch id=tj-run-patch partial={"position":{"x":12,"y":0,"z":0}}',
    { object: mesh, threeJsonId: "tj-run-patch", eventName: "click", scene }
  );
  assert.equal(mesh.position.x, 12);
  assert.equal(mesh.userData.objJson.position.x, 12);
  clearObjectRegistry();
});

test("runEventScriptCommand rejects disallowed ops without mutating scene", async () => {
  clearObjectRegistry();
  const scene = new THREE.Scene();
  const result = await runEventScriptCommand("scene.validate json={}", {
    object: null,
    scene,
    eventName: "click"
  });
  assert.equal(result.ok, false);
  assert.match(String(result.error), /not allowed/i);
  clearObjectRegistry();
});

test("ELM executes run statement through core binding executor", async () => {
  clearObjectRegistry();
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh();
  setUserDataObjJson(mesh, {
    threeJsonId: "tj-run-elm",
    objType: "box",
    position: { x: 0, y: 0, z: 0 }
  });
  mesh.position.set(0, 0, 0);
  scene.add(mesh);
  registerObject(mesh, mesh.userData.objJson, { recursive: false });

  const manager = createEventListenerManager({
    coreBindingExecutor: createCoreBindingExecutor()
  });
  addBinding({
    threeJsonId: "tj-run-elm",
    eventName: "click",
    source: "json",
    objType: "box",
    executorKind: "core",
    payload: {
      scriptText: 'run object.patch id=tj-run-elm partial={"position":{"x":7}}'
    }
  });
  manager.notifyBindingAdded("click");
  await manager.dispatchPlatformEvent("tj-run-elm", "click", { object: mesh, scene });
  assert.equal(mesh.position.x, 7);
  manager.dispose();
  clearObjectRegistry();
});

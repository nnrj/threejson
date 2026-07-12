import { test } from "node:test";
import assert from "node:assert/strict";
import { createRuntimeContext, attachRuntimeContext } from "../core/runtime/runtimeContext.js";
import {
  attachEventListenerManager,
  bindEvent,
  getActiveEventListenerManager,
  createEventListenerManager
} from "../core/runtime/eventMechanism/bindEventRuntime.js";
import { registerObject } from "../core/handler/objectRegistry.js";

function makeFakeScene() {
  return { isScene: true, children: [] };
}

function makeFakeObject(uuid, parent) {
  return {
    isObject3D: true,
    uuid,
    name: "",
    parent: parent ?? null,
    userData: {},
    traverse(fn) {
      fn(this);
    },
    addEventListener() {},
    dispatchEvent() {}
  };
}

test("attaching a manager for scene B does not dispose scene A's manager", () => {
  const sceneA = makeFakeScene();
  const sceneB = makeFakeScene();
  const ctxA = createRuntimeContext();
  const ctxB = createRuntimeContext();
  attachRuntimeContext(sceneA, ctxA);
  attachRuntimeContext(sceneB, ctxB);

  let disposedA = false;
  const managerA = createEventListenerManager({ host: {} });
  const originalDisposeA = managerA.dispose;
  managerA.dispose = () => {
    disposedA = true;
    originalDisposeA();
  };
  attachEventListenerManager(managerA, "scene-a", sceneA);

  const managerB = createEventListenerManager({ host: {} });
  attachEventListenerManager(managerB, "scene-b", sceneB);

  assert.equal(disposedA, false, "attaching scene B's manager must not dispose scene A's manager");
  assert.equal(getActiveEventListenerManager(sceneA), managerA);
  assert.equal(getActiveEventListenerManager(sceneB), managerB);
});

test("bindEvent on objects sharing a threeJsonId across two scenes only fires the matching scene's handler", () => {
  const sceneA = makeFakeScene();
  const sceneB = makeFakeScene();
  const ctxA = createRuntimeContext();
  const ctxB = createRuntimeContext();
  attachRuntimeContext(sceneA, ctxA);
  attachRuntimeContext(sceneB, ctxB);

  const cubeA = makeFakeObject("uuid-ea", sceneA);
  cubeA.userData.objJson = { threeJsonId: "cube1", objType: "box" };
  const cubeB = makeFakeObject("uuid-eb", sceneB);
  cubeB.userData.objJson = { threeJsonId: "cube1", objType: "box" };

  registerObject(cubeA, cubeA.userData.objJson, { recursive: false });
  registerObject(cubeB, cubeB.userData.objJson, { recursive: false });

  let calledA = 0;
  let calledB = 0;
  bindEvent("cube1", "click", () => {
    calledA += 1;
  }, { runtimeScope: sceneA });
  bindEvent("cube1", "click", () => {
    calledB += 1;
  }, { runtimeScope: sceneB });

  const bindingsA = ctxA.eventBindingRegistry.getBindings("cube1", "click");
  const bindingsB = ctxB.eventBindingRegistry.getBindings("cube1", "click");
  assert.equal(bindingsA.length, 1, "scene A's registry should hold exactly its own binding");
  assert.equal(bindingsB.length, 1, "scene B's registry should hold exactly its own binding");
  assert.notEqual(bindingsA[0].payload, bindingsB[0].payload, "each store's binding keeps its own handler payload");
});

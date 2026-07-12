import { test } from "node:test";
import assert from "node:assert/strict";
import { createRuntimeContext, attachRuntimeContext } from "../core/runtime/runtimeContext.js";
import { registerObject, unregisterObject, getObjectByThreeJsonId } from "../core/handler/objectRegistry.js";
import { getThreeJsonIdsInSystemBucket } from "../core/handler/bucketIndex.js";

function makeFakeScene() {
  return { isScene: true, children: [] };
}

function makeFakeObject(uuid, parent) {
  const listeners = {};
  return {
    isObject3D: true,
    uuid,
    name: "",
    parent: parent ?? null,
    userData: {},
    traverse(fn) {
      fn(this);
    },
    addEventListener(evt, fn) {
      (listeners[evt] ||= []).push(fn);
    },
    dispatchEvent(evt) {
      (listeners[evt.type] || []).forEach((fn) => fn(evt));
    }
  };
}

test("two RuntimeContexts keep independent object identity indices for the same threeJsonId", () => {
  const sceneA = makeFakeScene();
  const sceneB = makeFakeScene();
  const ctxA = createRuntimeContext();
  const ctxB = createRuntimeContext();
  attachRuntimeContext(sceneA, ctxA);
  attachRuntimeContext(sceneB, ctxB);

  const cubeA = makeFakeObject("uuid-a", sceneA);
  cubeA.userData.objJson = { threeJsonId: "cube1", objType: "box" };
  const cubeB = makeFakeObject("uuid-b", sceneB);
  cubeB.userData.objJson = { threeJsonId: "cube1", objType: "box" };

  registerObject(cubeA, cubeA.userData.objJson, { recursive: false });
  registerObject(cubeB, cubeB.userData.objJson, { recursive: false });

  assert.equal(getObjectByThreeJsonId("cube1", sceneA), cubeA);
  assert.equal(getObjectByThreeJsonId("cube1", sceneB), cubeB);
  assert.equal(ctxA.objectRegistry.getObjectByThreeJsonId("cube1"), cubeA);
  assert.equal(ctxB.objectRegistry.getObjectByThreeJsonId("cube1"), cubeB);
});

test("clearing one context's registry does not affect a sibling context", () => {
  const sceneA = makeFakeScene();
  const sceneB = makeFakeScene();
  const ctxA = createRuntimeContext();
  const ctxB = createRuntimeContext();
  attachRuntimeContext(sceneA, ctxA);
  attachRuntimeContext(sceneB, ctxB);

  const cubeA = makeFakeObject("uuid-a2", sceneA);
  cubeA.userData.objJson = { threeJsonId: "shared-id", objType: "box" };
  const cubeB = makeFakeObject("uuid-b2", sceneB);
  cubeB.userData.objJson = { threeJsonId: "shared-id", objType: "box" };

  registerObject(cubeA, cubeA.userData.objJson, { recursive: false });
  registerObject(cubeB, cubeB.userData.objJson, { recursive: false });

  ctxA.objectRegistry.clearObjectRegistry();

  assert.equal(getObjectByThreeJsonId("shared-id", sceneA), null);
  assert.equal(getObjectByThreeJsonId("shared-id", sceneB), cubeB);
});

test("unregister after detach (parent already null) still targets the correct context", () => {
  const sceneA = makeFakeScene();
  const sceneB = makeFakeScene();
  const ctxA = createRuntimeContext();
  const ctxB = createRuntimeContext();
  attachRuntimeContext(sceneA, ctxA);
  attachRuntimeContext(sceneB, ctxB);

  const cubeA = makeFakeObject("uuid-a3", sceneA);
  cubeA.userData.objJson = { threeJsonId: "detach-id", objType: "box" };
  const cubeB = makeFakeObject("uuid-b3", sceneB);
  cubeB.userData.objJson = { threeJsonId: "detach-id", objType: "box" };

  registerObject(cubeA, cubeA.userData.objJson, { recursive: false });
  registerObject(cubeB, cubeB.userData.objJson, { recursive: false });

  // Simulate Object3D.remove() having already nulled the parent before unregister runs
  // (the exact sequence used by sceneDescriptorBinding.js's redeployObject).
  cubeA.parent = null;
  unregisterObject(cubeA, { recursive: false, keepDescriptor: true });

  assert.equal(ctxA.objectRegistry.getObjectRegistrySnapshot().threeJsonIdCount, 0);
  assert.equal(ctxB.objectRegistry.getObjectByThreeJsonId("detach-id"), cubeB);
});

test("system bucket index isolation follows the same per-context boundary", () => {
  const sceneA = makeFakeScene();
  const sceneB = makeFakeScene();
  const ctxA = createRuntimeContext();
  const ctxB = createRuntimeContext();
  attachRuntimeContext(sceneA, ctxA);
  attachRuntimeContext(sceneB, ctxB);

  const domainA = makeFakeObject("uuid-da", sceneA);
  domainA.userData.objJson = { threeJsonId: "domain-1", objType: "domain" };
  registerObject(domainA, domainA.userData.objJson, { recursive: false });

  assert.deepEqual(getThreeJsonIdsInSystemBucket("domain", sceneA), ["domain-1"]);
  assert.deepEqual(getThreeJsonIdsInSystemBucket("domain", sceneB), []);
});

test("omitting runtimeScope keeps today's shared-default-store behavior", () => {
  const obj = { uuid: "uuid-legacy", name: "", parent: null, userData: {}, traverse(fn) { fn(this); } };
  obj.userData.objJson = { threeJsonId: "legacy-id", objType: "box" };
  registerObject(obj, obj.userData.objJson, { recursive: false });
  assert.equal(getObjectByThreeJsonId("legacy-id"), obj);
  unregisterObject(obj, { recursive: false });
  assert.equal(getObjectByThreeJsonId("legacy-id"), null);
});

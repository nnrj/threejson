import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import "../builtins/register.js";
import { clearObjectRegistry, registerObject, unregisterObject } from "../core/handler/objectRegistry.js";
import { setUserDataObjJson } from "../core/handler/objectDescriptorAttach.js";
import {
  attachEventListenerManager,
  addBinding,
  clearAllEventBindings,
  createEventListenerManager,
  detachEventListenerManager,
  getBindings,
  isEventAllowedForObjType,
  isPlatformEventName
} from "../core/runtime/eventMechanism/index.js";
import {
  buildObjectLifecyclePayload,
  isLifecycleEligibleObjType,
  isLifecycleEligibleRecord,
  notifyObjectReady,
  resolveObjectLifecycleCallbacks,
  resolveObjectLifecycleContext,
  resolveSceneLoadObjectLifecycle,
  resolveEnableObjectLifecycle,
  scenePayloadHasLifecycleEventBindings,
  runRecordDeployWithLifecycle
} from "../core/runtime/objectLifecycle/index.js";
import { deployGroupDescriptor } from "../core/handler/objectLoadHandler.js";
import {
  addObjectFromDescriptor,
  removeObjectById,
  removeObjectByIdAsync
} from "../core/runtime/sceneObjectCommands.js";
import { replayObjectReadyBindingsAfterBind } from "../core/runtime/objectLifecycle/objectLifecycleReplay.js";

test("platform catalog includes object lifecycle events", () => {
  assert.ok(isPlatformEventName("object.ready"));
  assert.ok(isPlatformEventName("object.dispose"));
});

test("lifecycle denylist excludes runtime objTypes", () => {
  assert.equal(isLifecycleEligibleObjType("box"), true);
  assert.equal(isLifecycleEligibleObjType("line"), true);
  assert.equal(isLifecycleEligibleObjType("camera"), false);
  assert.equal(isLifecycleEligibleObjType("pass"), false);
  assert.equal(isEventAllowedForObjType("box", "object.ready"), true);
  assert.equal(isEventAllowedForObjType("camera", "object.ready"), false);
});

test("isLifecycleEligibleRecord requires threeJsonId", () => {
  assert.equal(isLifecycleEligibleRecord({ objType: "box", threeJsonId: "a" }), true);
  assert.equal(isLifecycleEligibleRecord({ objType: "box" }), false);
});

test("resolveObjectLifecycleContext returns null without explicit lifecycle config", () => {
  assert.equal(resolveObjectLifecycleContext({}), null);
  assert.equal(resolveObjectLifecycleContext({ bindSceneEvents: true }), null);
});

test("resolveSceneLoadObjectLifecycle returns null for plain scene without hooks or bindings", () => {
  assert.equal(
    resolveSceneLoadObjectLifecycle(
      {},
      { objectList: [{ threeJsonId: "b1", objType: "box" }] }
    ),
    null
  );
});

test("resolveEnableObjectLifecycle reads JSON interaction.enableObjectLifecycle", () => {
  assert.equal(resolveEnableObjectLifecycle({}, null, {}), false);
  assert.equal(
    resolveEnableObjectLifecycle(
      { sceneConfig: { interaction: { enableObjectLifecycle: true } } },
      null,
      {}
    ),
    true
  );
  assert.equal(
    resolveEnableObjectLifecycle(
      { sceneConfig: { interaction: { enableObjectLifecycle: false } } },
      null,
      { enableObjectLifecycle: true }
    ),
    true
  );
  assert.equal(
    resolveEnableObjectLifecycle(
      { sceneConfig: { interaction: { enableObjectLifecycle: true } } },
      null,
      { enableObjectLifecycle: false }
    ),
    false
  );
});

test("resolveSceneLoadObjectLifecycle creates ctx when JSON enables enableObjectLifecycle", () => {
  const ctx = resolveSceneLoadObjectLifecycle(
    {},
    {
      sceneConfig: { interaction: { enableObjectLifecycle: true } },
      objectList: [{ threeJsonId: "b1", objType: "box" }]
    }
  );
  assert.ok(ctx);
  assert.equal(ctx.callbacks.onObjectDeployed, null);
  assert.equal(ctx.elmDispatchEnabled, true);
});

test("resolveSceneLoadObjectLifecycle creates ctx when caller passes enableObjectLifecycle", () => {
  const ctx = resolveSceneLoadObjectLifecycle(
    { enableObjectLifecycle: true },
    { objectList: [{ threeJsonId: "b1", objType: "box" }] }
  );
  assert.ok(ctx);
});

test("resolveSceneLoadObjectLifecycle creates ctx when JSON has object.ready binding", () => {
  const ctx = resolveSceneLoadObjectLifecycle(
    {},
    {
      objectList: [
        {
          threeJsonId: "b1",
          objType: "box",
          events: { "object.ready": { script: "noop()" } }
        }
      ]
    }
  );
  assert.ok(ctx);
  assert.equal(ctx.callbacks.onObjectDeployed, null);
  assert.equal(ctx.elmDispatchEnabled, true);
});

test("scenePayloadHasLifecycleEventBindings scans nested subScene", () => {
  assert.equal(
    scenePayloadHasLifecycleEventBindings({
      objectList: [
        {
          threeJsonId: "g1",
          objType: "group",
          subScene: [
            {
              threeJsonId: "b1",
              objType: "box",
              events: { "object.dispose": { script: "noop()" } }
            }
          ]
        }
      ]
    }),
    true
  );
});

test("scenePayloadHasLifecycleEventBindings scans friendly JSON lists", () => {
  assert.equal(
    scenePayloadHasLifecycleEventBindings({
      worldInfo: {
        boxModelList: [
          {
            threeJsonId: "friendly-lc-box",
            objType: "box",
            events: { "object.ready": { script: "noop" } }
          }
        ]
      }
    }),
    true
  );
});

test("runRecordDeployWithLifecycle stays sync when ctx exists only for ELM replay", () => {
  const lifecycleCtx = {
    callbacks: {},
    elmDispatchEnabled: true
  };
  let ran = false;
  const result = runRecordDeployWithLifecycle({ threeJsonId: "b1", objType: "box" }, lifecycleCtx, () => {
    ran = true;
  });
  assert.equal(ran, true);
  assert.ok(!(result && typeof result.then === "function"));
});

test("runRecordDeployWithLifecycle with null ctx runs deployFn synchronously", () => {
  let ran = false;
  const result = runRecordDeployWithLifecycle({ threeJsonId: "sb-1", objType: "statBar" }, null, () => {
    ran = true;
  });
  assert.equal(ran, true);
  assert.ok(!(result && typeof result.then === "function"));
});

test("runRecordDeployWithLifecycle keeps sync host hooks synchronous when hooks are sync", () => {
  const calls = [];
  const result = runRecordDeployWithLifecycle(
    { threeJsonId: "sync-hook-box", objType: "box" },
    {
      callbacks: {
        onObjectBeforeCreate: () => calls.push("before"),
        onObjectDeployed: () => calls.push("ready")
      },
      elmDispatchEnabled: false
    },
    () => {
      calls.push("deploy");
    }
  );
  assert.ok(!(result && typeof result.then === "function"));
  assert.deepEqual(calls, ["before", "deploy", "ready"]);
});

test("deployGroupDescriptor without lifecycle options deploys subScene synchronously", () => {
  const parent = new THREE.Group();
  const group = deployGroupDescriptor(parent, {
    objType: "group",
    threeJsonId: "g-stat-sync",
    subScene: [
      {
        objType: "box",
        threeJsonId: "g-stat-sync-box",
        geometry: { type: "BoxGeometry", width: 1, height: 1, depth: 1 }
      }
    ]
  });
  assert.ok(group, "group should be created");
  assert.ok(parent.children.includes(group), "group should attach immediately");
  let boxFound = false;
  group.traverse((node) => {
    if (node?.userData?.objJson?.threeJsonId === "g-stat-sync-box") {
      boxFound = true;
    }
  });
  assert.ok(boxFound, "subScene child should deploy synchronously");
});

test("runRecordDeployWithLifecycle invokes host hooks once", async () => {
  const calls = [];
  const record = { threeJsonId: "lc-box", objType: "box" };
  const lifecycleCtx = {
    callbacks: {
      onObjectBeforeCreate: () => {
        calls.push("before");
      },
      onObjectDeployed: () => {
        calls.push("ready");
      }
    },
    elmDispatchEnabled: false
  };
  await runRecordDeployWithLifecycle(record, lifecycleCtx, () => {
    calls.push("deploy");
  });
  assert.deepEqual(calls, ["before", "deploy", "ready"]);
});

test("dynamic addObjectFromDescriptor dispatches JSON object.ready without making add sync API async", async () => {
  clearObjectRegistry();
  clearAllEventBindings();
  const scriptCalls = [];
  const readyCalls = [];
  const manager = createEventListenerManager({
    coreBindingExecutor: async (ctx) => {
      scriptCalls.push(ctx.threeJsonId);
    }
  });
  attachEventListenerManager(manager, "lc-dynamic");
  manager.registerGlobalListener("object.ready", (ctx) => {
    readyCalls.push(ctx.threeJsonId);
  });

  const scene = new THREE.Scene();
  const res = addObjectFromDescriptor(scene, {
    objType: "box",
    threeJsonId: "lc-dynamic-ready",
    geometry: { width: 1, height: 1, depth: 1 },
    events: { "object.ready": { script: "markReady()" } }
  });

  assert.equal(res.ok, true);
  assert.ok(!(res && typeof res.then === "function"));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(readyCalls, ["lc-dynamic-ready"]);
  assert.equal(getBindings("lc-dynamic-ready", "object.ready").length, 1);
  assert.deepEqual(scriptCalls, ["lc-dynamic-ready"]);

  detachEventListenerManager();
  clearAllEventBindings();
  clearObjectRegistry();
});

test("removeObjectByIdAsync dispatches JSON object.dispose while sync removeObjectById stays sync", async () => {
  clearObjectRegistry();
  clearAllEventBindings();
  const scriptCalls = [];
  const disposeCalls = [];
  const manager = createEventListenerManager({
    coreBindingExecutor: async (ctx) => {
      scriptCalls.push(ctx.threeJsonId);
    }
  });
  attachEventListenerManager(manager, "lc-dispose");
  manager.registerGlobalListener("object.dispose", (ctx) => {
    disposeCalls.push(ctx.threeJsonId);
  });

  const scene = new THREE.Scene();
  const syncId = "lc-sync-dispose";
  assert.equal(
    addObjectFromDescriptor(scene, {
      objType: "box",
      threeJsonId: syncId,
      geometry: { width: 1, height: 1, depth: 1 },
      events: { "object.dispose": { script: "markDispose()" } }
    }).ok,
    true
  );
  const syncRemoved = removeObjectById(scene, syncId);
  assert.equal(syncRemoved.ok, true);
  assert.ok(!(syncRemoved && typeof syncRemoved.then === "function"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(disposeCalls, []);

  const asyncId = "lc-async-dispose";
  assert.equal(
    addObjectFromDescriptor(scene, {
      objType: "box",
      threeJsonId: asyncId,
      geometry: { width: 1, height: 1, depth: 1 },
      events: { "object.dispose": { script: "markDispose()" } }
    }).ok,
    true
  );
  const asyncRemoved = await removeObjectByIdAsync(scene, asyncId);
  assert.equal(asyncRemoved.ok, true);
  assert.deepEqual(disposeCalls, [asyncId]);
  assert.equal(getBindings(asyncId, "object.dispose").length, 1);
  assert.deepEqual(scriptCalls, [asyncId]);

  detachEventListenerManager();
  clearAllEventBindings();
  clearObjectRegistry();
});

test("replayObjectReadyBindingsAfterBind dispatches ELM only for bound ids", async () => {
  clearObjectRegistry();
  clearAllEventBindings();
  const manager = createEventListenerManager();
  attachEventListenerManager(manager, "lc-scene");

  const box = new THREE.Mesh();
  setUserDataObjJson(box, {
    threeJsonId: "lc-ready-box",
    objType: "box",
    events: {
      "object.ready": { script: "self.moveBy(0, 1, 0)" }
    }
  });
  registerObject(box, box.userData.objJson);

  const hostCalls = [];
  const otherCalls = [];
  const deployedHook = [];

  addBinding({
    threeJsonId: "lc-ready-box",
    eventName: "object.ready",
    source: "json",
    objType: "box",
    executorKind: "core",
    payload: { script: "" },
    sceneToken: "lc-scene"
  });

  manager.registerGlobalListener("object.ready", (ctx) => {
    if (ctx.threeJsonId === "lc-ready-box") {
      hostCalls.push("bound");
    }
    if (ctx.threeJsonId === "lc-other-box") {
      otherCalls.push("other");
    }
  });

  await replayObjectReadyBindingsAfterBind({
    sceneJsonRoot: {
      objectList: [
        { threeJsonId: "lc-ready-box", objType: "box", events: { "object.ready": { script: "noop" } } },
        { threeJsonId: "lc-missing", objType: "box", events: { "object.ready": { script: "noop" } } }
      ]
    },
    objectLifecycle: {
      callbacks: {
        onObjectDeployed: () => {
          deployedHook.push("host");
        }
      },
      elmDispatchEnabled: true
    }
  });

  assert.deepEqual(hostCalls, ["bound"]);
  assert.deepEqual(otherCalls, []);
  assert.deepEqual(deployedHook, []);

  detachEventListenerManager();
  unregisterObject(box);
  clearAllEventBindings();
});

test("notifyObjectReady skips replay host hook", async () => {
  const calls = [];
  const record = { threeJsonId: "lc-r", objType: "box" };
  await notifyObjectReady(
    record,
    {
      callbacks: {
        onObjectDeployed: () => {
          calls.push("host");
        }
      },
      elmDispatchEnabled: false
    },
    "replay"
  );
  assert.deepEqual(calls, []);
});

test("buildObjectLifecyclePayload resolves registry object", () => {
  clearObjectRegistry();
  const mesh = new THREE.Mesh();
  setUserDataObjJson(mesh, { threeJsonId: "p1", objType: "box" });
  registerObject(mesh, mesh.userData.objJson);
  const payload = buildObjectLifecyclePayload({ threeJsonId: "p1", objType: "box" });
  assert.equal(payload.object3D, mesh);
  clearObjectRegistry();
});

test("resolveObjectLifecycleCallbacks returns null for missing hooks", () => {
  const callbacks = resolveObjectLifecycleCallbacks({});
  assert.equal(callbacks.onObjectDeployed, null);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import "../builtins/register.js";
import { deployCabinet } from "../domains/device/cabinet/cabinetFactory.js";
import { bindDoorActionTriggers } from "../domains/door/doorEventActions.js";
import { invokeDomainBindSceneEvents } from "../core/runtime/eventMechanism/eventDomainContract.js";
import {
  clearAllEventBindings,
  createEventListenerManager,
  getBindings,
  pickObjectFromNativeEvent,
  resolveThreeJsonIdFromPick
} from "../core/runtime/eventMechanism/index.js";
import { updateEngineTweens } from "../core/compat/adapters/tween.js";
import { clearObjectRegistry, getObjectByThreeJsonId } from "../core/handler/objectRegistry.js";
import { resolveDoorForAnimation } from "../domains/door/doorKinematics.js";

function installMockDocument() {
  const prev = globalThis.document;
  globalThis.document = {
    createElement() {
      return {
        width: 64,
        height: 64,
        style: {},
        getContext() {
          return {
            scale() {},
            font: "",
            fillStyle: "",
            textAlign: "",
            textBaseline: "",
            fillRect() {},
            fillText() {},
            measureText(text) {
              return { width: String(text).length * 10 };
            }
          };
        }
      };
    },
    createElementNS(_ns, tag) {
      if (tag === "img") {
        return {
          src: "",
          addEventListener(type, fn) {
            if (type === "load" && typeof fn === "function") {
              setTimeout(fn, 0);
            }
          },
          removeEventListener() {}
        };
      }
      return {};
    },
    getElementById() {
      return { textContent: "", style: {} };
    }
  };
  return () => {
    globalThis.document = prev;
  };
}

test("deployCabinet front door pick and dblclick toggle", async () => {
  const restoreDoc = installMockDocument();
  clearAllEventBindings();
  clearObjectRegistry();
  try {
    const cabId = "cab-live-test";
    const scene = new THREE.Scene();
    deployCabinet(
      {
        threeJsonId: cabId,
        name: "cabinet",
        doors: [{ side: "front", swing: "right", leafCount: 1, label: { text: "01" } }],
        geometry: { width: 6, length: 12, height: 20 },
        devices: [{ deviceType: "server", uStart: 20, uSize: 2, name: "srv" }],
        slots: { total: 24, unitHeight: 0.48, bottomMargin: 0.77 },
        position: { x: -21, y: 0, z: -12 }
      },
      scene
    );

    const expectedId = `${cabId}__door-front`;
    const manager = createEventListenerManager({ sceneToken: "cab-live" });
    await invokeDomainBindSceneEvents("door", scene, { manager, sceneToken: "cab-live" });

    assert.equal(getBindings(expectedId, "dblclick").length, 1, "expected door.toggle binding");

    scene.updateMatrixWorld(true);
    const doorObj = getObjectByThreeJsonId(expectedId);
    assert.ok(doorObj, "door object in registry");
    const doorWorld = new THREE.Vector3();
    doorObj.getWorldPosition(doorWorld);

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
    camera.position.set(doorWorld.x, doorWorld.y, doorWorld.z - 30);
    camera.lookAt(doorWorld);
    camera.updateMatrixWorld(true);

    const canvas = {
      getBoundingClientRect() {
        return { width: 200, height: 200, left: 0, top: 0 };
      }
    };
    const pickOpts = { eventName: "dblclick", resolveFromObject: resolveThreeJsonIdFromPick };
    const picked = pickObjectFromNativeEvent({ clientX: 100, clientY: 100 }, canvas, camera, scene, pickOpts);
    const pickId = resolveThreeJsonIdFromPick(picked, "dblclick");

    assert.ok(picked, `expected pick mesh, doorWorld=${doorWorld.x},${doorWorld.y},${doorWorld.z}`);
    assert.ok(pickId, `expected pick id, picked objType=${picked?.userData?.objJson?.objType}`);
    assert.equal(pickId, expectedId, `expected door id, got ${pickId}`);

    const animRoot = getObjectByThreeJsonId(expectedId) ?? picked;
    const resolved = resolveDoorForAnimation(animRoot);
    assert.ok(resolved?.hinge);
    assert.ok(Math.abs(resolved.hinge.rotation.y) < 1e-6);

    await manager.dispatchPlatformEvent(pickId, "dblclick", { scene, object: picked, manager });
    updateEngineTweens(performance.now() + 2000);
    assert.ok(Math.abs(resolved.hinge.rotation.y) > 1e-3);

    manager.dispose();
  } finally {
    restoreDoc();
    clearAllEventBindings();
    clearObjectRegistry();
  }
});

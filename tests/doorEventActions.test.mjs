import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import {
  clearObjectRegistry,
  registerObject
} from "../core/handler/objectRegistry.js";
import {
  clearAllEventBindings,
  createEventListenerManager,
  getBindings
} from "../core/runtime/eventMechanism/index.js";
import { updateEngineTweens } from "../core/compat/adapters/tween.js";
import { bindDoorActionTriggers } from "../domains/door/doorEventActions.js";
import { resolveDoorForAnimation } from "../domains/door/doorKinematics.js";
import { createCabinetJson } from "../domains/device/cabinet/cabinetFactory.js";
import "../builtins/register.js";

function makeDoorLeaf(threeJsonId, extra = {}) {
  const hinge = new THREE.Group();
  hinge.name = "door-hinge";
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.1), new THREE.MeshBasicMaterial());
  leaf.userData.objJson = {
    objType: "door",
    threeJsonId,
    openAngleDeg: 90,
    ...extra
  };
  registerObject(leaf, leaf.userData.objJson, { recursive: false });
  hinge.add(leaf);
  return { hinge, leaf };
}

test("door dblclick trigger derives one door.toggle binding by default", async () => {
  clearAllEventBindings();
  clearObjectRegistry();
  const scene = new THREE.Scene();
  const { hinge, leaf } = makeDoorLeaf("entry-door-a");
  scene.add(hinge);
  const manager = createEventListenerManager();

  bindDoorActionTriggers(scene, { manager, sceneToken: "door-actions" });

  const bindings = getBindings("entry-door-a", "dblclick");
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].payload?.eventConfig?.action?.type, "door.toggle");

  const resolvedBefore = resolveDoorForAnimation(leaf);
  assert.ok(resolvedBefore);
  assert.ok(Math.abs(resolvedBefore.hinge.rotation.y) < 1e-6);

  await manager.dispatchPlatformEvent("entry-door-a", "dblclick", { scene });
  updateEngineTweens(performance.now() + 2000);
  assert.ok(Math.abs(resolvedBefore.hinge.rotation.y) > 1e-3);

  manager.dispose();
  clearAllEventBindings();
  clearObjectRegistry();
});

test("doorToggleTrigger none skips derived bind", () => {
  clearAllEventBindings();
  clearObjectRegistry();
  const scene = new THREE.Scene();
  const { hinge } = makeDoorLeaf("door-no-trigger", { doorToggleTrigger: "none" });
  scene.add(hinge);
  const manager = createEventListenerManager();

  bindDoorActionTriggers(scene, { manager, sceneToken: "door-actions" });

  assert.equal(getBindings("door-no-trigger", "dblclick").length, 0);
  assert.equal(getBindings("door-no-trigger", "click").length, 0);

  manager.dispose();
  clearAllEventBindings();
  clearObjectRegistry();
});

test("cabinet deploy root record is not bound for door toggle", () => {
  clearAllEventBindings();
  clearObjectRegistry();
  const scene = new THREE.Scene();
  const cabinet = new THREE.Group();
  cabinet.userData.objJson = {
    objType: "domain",
    domain: "device.cabinet",
    threeJsonId: "cabinet-root"
  };
  registerObject(cabinet, cabinet.userData.objJson, { recursive: false });
  scene.add(cabinet);
  const manager = createEventListenerManager();

  bindDoorActionTriggers(scene, { manager, sceneToken: "door-actions" });

  assert.equal(getBindings("cabinet-root", "dblclick").length, 0);

  manager.dispose();
  clearAllEventBindings();
  clearObjectRegistry();
});

test("explicit events.dblclick wins over derived door toggle bind", () => {
  clearAllEventBindings();
  clearObjectRegistry();
  const scene = new THREE.Scene();
  const { hinge, leaf } = makeDoorLeaf("door-explicit", {
    events: {
      dblclick: {
        action: { type: "object.setVisible", target: "self", visible: false }
      }
    }
  });
  scene.add(hinge);
  const manager = createEventListenerManager();

  bindDoorActionTriggers(scene, { manager, sceneToken: "door-actions" });

  assert.equal(getBindings("door-explicit", "dblclick").length, 0);

  manager.dispose();
  clearAllEventBindings();
  clearObjectRegistry();
});

test("createCabinetJson assigns stable threeJsonId on door leaves", () => {
  const json = createCabinetJson({
    threeJsonId: "cab-id-test",
    doors: [{ side: "front", swing: "right", leafCount: 1 }],
    geometry: { width: 6, length: 12, height: 20 },
    devices: [],
    slots: { total: 9 }
  });
  const leaves = [];
  function walk(node) {
    if (!node || typeof node !== "object") {
      return;
    }
    if (String(node.objType || "").toLowerCase() === "door") {
      leaves.push(node);
    }
    for (const key of ["subScene", "subGroup", "boxModelList"]) {
      const arr = node[key];
      if (Array.isArray(arr)) {
        for (const child of arr) {
          walk(child);
        }
      }
    }
  }
  walk(json);
  assert.equal(leaves.length, 1);
  assert.equal(leaves[0].threeJsonId, "cab-id-test__door-front");
});

test("cabinet door leaf with assigned id gets dblclick door.toggle binding", () => {
  clearAllEventBindings();
  clearObjectRegistry();
  const scene = new THREE.Scene();
  const { hinge, leaf } = makeDoorLeaf("cab-elm-test__door-front", {
    mountSide: "front",
    openAngleDeg: 90,
    hingeSide: "left"
  });
  scene.add(hinge);
  const manager = createEventListenerManager();
  bindDoorActionTriggers(scene, { manager, sceneToken: "door-actions" });
  assert.equal(getBindings("cab-elm-test__door-front", "dblclick").length, 1);
  manager.dispose();
  clearAllEventBindings();
  clearObjectRegistry();
});

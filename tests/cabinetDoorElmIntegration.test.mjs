import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import "../builtins/register.js";
import { deployCabinetDoorSubSceneChild } from "../domains/device/cabinet/cabinetSubSceneDeploy.js";
import { isDoorDescriptor } from "../domains/door/doorDescriptor.js";
import { resolveDoorForAnimation } from "../domains/door/doorKinematics.js";
import {
  invokeAllDomainBindSceneEvents,
  invokeDomainBindSceneEvents
} from "../core/runtime/eventMechanism/eventDomainContract.js";
import {
  clearAllEventBindings,
  createEventListenerManager,
  getBindings,
  pickObjectFromNativeEvent,
  resolveThreeJsonIdFromPick
} from "../core/runtime/eventMechanism/index.js";
import { updateEngineTweens } from "../core/compat/adapters/tween.js";
import { clearObjectRegistry, registerObject } from "../core/handler/objectRegistry.js";

function collectDoorLeaves(scene) {
  /** @type {Array<{ id: string, object: import("three").Object3D }>} */
  const out = [];
  scene.traverse((object3D) => {
    const record = object3D?.userData?.objJson;
    if (!record || !isDoorDescriptor(record)) {
      return;
    }
    const id = typeof record.threeJsonId === "string" ? record.threeJsonId.trim() : "";
    if (!id) {
      return;
    }
    out.push({ id, object: object3D });
  });
  return out;
}

function buildCabinetWithDoor(cabinetId) {
  const scene = new THREE.Scene();
  const cabinetRoot = new THREE.Group();
  cabinetRoot.userData.objJson = {
    objType: "domain",
    domain: "device.cabinet",
    threeJsonId: cabinetId,
    pickThroughRaycast: true
  };
  registerObject(cabinetRoot, cabinetRoot.userData.objJson, { recursive: false });

  const doorAssembly = new THREE.Group();
  doorAssembly.userData = { objJson: { cabinetDoorAssembly: true } };

  const doorRecord = {
    objType: "door",
    threeJsonId: `${cabinetId}__door-front`,
    doorType: "right",
    swing: "right",
    mountSide: "front",
    hingeSide: "left",
    openAngleDeg: 90,
    geometry: { width: 6, height: 20, depth: 0.2 },
    material: { type: "standard", color: "#D0D1C9" },
    position: { x: 0, y: 0, z: 2 }
  };
  assert.equal(deployCabinetDoorSubSceneChild(doorAssembly, doorRecord), true);

  const frontShell = new THREE.Mesh(
    new THREE.BoxGeometry(6, 20, 0.2),
    new THREE.MeshBasicMaterial()
  );
  frontShell.position.set(0, 0, 1);
  frontShell.userData.objJson = { objType: "box", name: "cabinetFront" };

  const sideShell = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 20, 12),
    new THREE.MeshBasicMaterial()
  );
  sideShell.position.set(-3.1, 0, 0);
  sideShell.userData.objJson = { objType: "box", name: "cabinetSide" };

  cabinetRoot.add(frontShell);
  cabinetRoot.add(doorAssembly);
  cabinetRoot.add(sideShell);
  scene.add(cabinetRoot);
  scene.updateMatrixWorld(true);

  return { scene, cabinetRoot, doorRecord };
}

test("cabinet door leaves get ELM dblclick bindings via domain peer bind", async () => {
  clearAllEventBindings();
  clearObjectRegistry();
  try {
    const cabinetId = "cab-elm-int";
    const { scene } = buildCabinetWithDoor(cabinetId);

    const leaves = collectDoorLeaves(scene);
    assert.ok(leaves.length >= 1, "expected at least one door leaf in scene");
    assert.equal(leaves[0].id, `${cabinetId}__door-front`);

    const manager = createEventListenerManager({ sceneToken: "cab-int" });
    const bindCtx = {
      manager,
      sceneToken: "cab-int",
      records: [
        {
          objType: "domain",
          domain: "device.cabinet",
          handler: "deployCabinet",
          threeJsonId: cabinetId
        }
      ]
    };
    await invokeAllDomainBindSceneEvents(scene, bindCtx);
    await invokeDomainBindSceneEvents("door", scene, bindCtx);

    for (const leaf of leaves) {
      const bindings = getBindings(leaf.id, "dblclick");
      assert.equal(bindings.length, 1, `expected binding on ${leaf.id}`);
      assert.equal(bindings[0].payload?.eventConfig?.action?.type, "door.toggle");
    }

    manager.dispose();
  } finally {
    clearAllEventBindings();
    clearObjectRegistry();
  }
});

test("cabinet wall pick does not resolve to door binding; door mesh pick toggles", async () => {
  clearAllEventBindings();
  clearObjectRegistry();
  try {
    const cabinetId = "cab-pick-int";
    const { scene } = buildCabinetWithDoor(cabinetId);
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);

    const leaves = collectDoorLeaves(scene);
    assert.ok(leaves.length >= 1);

    const manager = createEventListenerManager({ sceneToken: "cab-pick" });
    await invokeDomainBindSceneEvents("door", scene, {
      manager,
      sceneToken: "cab-pick"
    });

    camera.position.set(0, 0, -35);
    camera.lookAt(0, 0, 2);
    camera.updateMatrixWorld(true);

    const canvas = {
      getBoundingClientRect() {
        return { width: 200, height: 200, left: 0, top: 0 };
      }
    };
    const pickOpts = { eventName: "dblclick", resolveFromObject: resolveThreeJsonIdFromPick };

    const frontEvent = { clientX: 100, clientY: 100 };
    const frontPicked = pickObjectFromNativeEvent(frontEvent, canvas, camera, scene, pickOpts);
    const frontId = resolveThreeJsonIdFromPick(frontPicked, "dblclick");
    assert.ok(frontId && frontId.includes("__door-front"), `front pick should resolve to door, got ${frontId}`);

    camera.position.set(-35, 0, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const sideEvent = { clientX: 100, clientY: 100 };
    const sidePicked = pickObjectFromNativeEvent(sideEvent, canvas, camera, scene, pickOpts);
    const sideId = resolveThreeJsonIdFromPick(sidePicked, "dblclick");
    if (sideId) {
      assert.equal(getBindings(sideId, "dblclick").length, 0, "cabinet wall pick must not dispatch door.toggle");
    }

    const doorLeaf = leaves.find((leaf) => leaf.id.endsWith("__door-front"))?.object;
    assert.ok(doorLeaf);
    const resolvedBefore = resolveDoorForAnimation(doorLeaf);
    assert.ok(resolvedBefore);
    assert.ok(Math.abs(resolvedBefore.hinge.rotation.y) < 1e-6);

    await manager.dispatchPlatformEvent(frontId, "dblclick", { scene, object: frontPicked });
    updateEngineTweens(performance.now() + 2000);
    assert.ok(Math.abs(resolvedBefore.hinge.rotation.y) > 1e-3);

    manager.dispose();
  } finally {
    clearAllEventBindings();
    clearObjectRegistry();
  }
});

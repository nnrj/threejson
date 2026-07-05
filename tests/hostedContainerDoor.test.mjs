import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import {
  findCabinetRoot,
  findUpsRoot,
  pickHostedContainerDoorTarget,
  tryToggleCabinetDoorFromNode,
  tryToggleUpsDoorFromNode
} from "../core/host/hostedContainerDoor.js";
import { resolveDoorForAnimation } from "../domains/door/doorKinematics.js";
import { updateEngineTweens } from "../core/compat/adapters/tween.js";

test("findCabinetRoot and findUpsRoot resolve domain deploy roots", () => {
  const cab = new THREE.Group();
  cab.userData.objJson = { domain: "device.cabinet" };
  const ups = new THREE.Group();
  ups.userData.objJson = { domain: "device.ups" };
  const shell = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  cab.add(shell);
  assert.equal(findCabinetRoot(shell), cab);
  assert.equal(findUpsRoot(shell), null);
  const upsShell = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  ups.add(upsShell);
  assert.equal(findUpsRoot(upsShell), ups);
});

test("pickHostedContainerDoorTarget prefers door inside pickThrough UPS", () => {
  const upsRoot = new THREE.Group();
  upsRoot.userData.objJson = {
    objType: "domain",
    domain: "device.ups",
    pickThroughRaycast: true
  };
  const shell = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 0.2), new THREE.MeshBasicMaterial());
  shell.position.z = 1;
  const hinge = new THREE.Group();
  hinge.userData.objJson = { objType: "door", threeJsonId: "ups-a__door-front" };
  const door = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 0.1), new THREE.MeshBasicMaterial());
  door.position.z = 2;
  hinge.add(door);
  upsRoot.add(shell);
  upsRoot.add(hinge);

  const picked = pickHostedContainerDoorTarget([
    { object: shell, distance: 1 },
    { object: door, distance: 2 }
  ]);
  assert.equal(picked, door);
});

test("tryToggleUpsDoorFromNode toggles only when pick chain includes door", () => {
  const upsRoot = new THREE.Group();
  upsRoot.userData.objJson = { domain: "device.ups" };
  const hinge = new THREE.Group();
  hinge.userData.objJson = { objType: "door", threeJsonId: "ups-t__door-front" };
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.1), new THREE.MeshBasicMaterial());
  hinge.add(leaf);
  upsRoot.add(hinge);

  const shell = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  shell.userData.objJson = { objType: "box" };
  upsRoot.add(shell);

  assert.equal(tryToggleUpsDoorFromNode(shell), false);
  assert.equal(tryToggleUpsDoorFromNode(leaf), true);
  const resolved = resolveDoorForAnimation(hinge);
  updateEngineTweens(performance.now() + 2000);
  assert.ok(Math.abs(resolved.hinge.rotation.y) > 1e-3);
});

test("tryToggleCabinetDoorFromNode falls back to first door in cabinet", () => {
  const cabRoot = new THREE.Group();
  cabRoot.userData.objJson = { domain: "device.cabinet" };
  const hinge = new THREE.Group();
  hinge.userData.objJson = { objType: "door", threeJsonId: "cab-t__door-front" };
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.1), new THREE.MeshBasicMaterial());
  hinge.add(leaf);
  cabRoot.add(hinge);
  const shell = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  cabRoot.add(shell);

  assert.equal(tryToggleCabinetDoorFromNode(shell), true);
});

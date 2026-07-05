import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import {
  deployCabinetDoorInfoPanelChild,
  deployCabinetDoorSubSceneChild,
  findCabinetDoorHingeGroup
} from "../domains/device/cabinet/cabinetSubSceneDeploy.js";
import { resolveDoorForAnimation, resolveOpenRotationY } from "../domains/door/index.js";

test("cabinet door subScene deploy wraps leaf in hinge group", () => {
  const assembly = new THREE.Group();
  assembly.userData = { objJson: { cabinetDoorAssembly: true } };

  const deployed = deployCabinetDoorSubSceneChild(assembly, {
    objType: "door",
    doorType: "right",
    geometry: { width: 6, height: 20, depth: 0.2 },
    material: { type: "standard", color: "#D0D1C9" },
    position: { x: 0, y: 0, z: 0 }
  });
  assert.equal(deployed, true);
  assert.equal(assembly.children.length, 1);

  const hingeGroup = assembly.children[0];
  assert.equal(hingeGroup.type, "Group");
  assert.equal(hingeGroup.children.length, 1);

  const leaf = hingeGroup.children[0];
  assert.ok(leaf?.isMesh);
  assert.ok(Math.abs(leaf.position.x + 3) < 1e-6, "right door leaf should offset by half width inside hinge group");

  const resolved = resolveDoorForAnimation(leaf);
  assert.ok(resolved);
  assert.equal(resolved.hinge, hingeGroup);
  assert.equal(resolved.leaf, leaf);
});

test("cabinet door info panel deploys under hinge group", async () => {
  const prevDoc = globalThis.document;
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
    }
  };
  try {
    const assembly = new THREE.Group();
    assembly.userData = { objJson: { cabinetDoorAssembly: true } };

    const doorDeployed = deployCabinetDoorSubSceneChild(assembly, {
      objType: "door",
      doorType: "right",
      geometry: { width: 6, height: 20, depth: 0.2 },
      material: { type: "standard", color: "#D0D1C9" },
      position: { x: 0, y: 0, z: 0 }
    });
    assert.equal(doorDeployed, true);
    const hinge = findCabinetDoorHingeGroup(assembly);
    assert.ok(hinge);

    const panelDeployed = deployCabinetDoorInfoPanelChild(assembly, {
      objType: "infoPanel",
      text: "01",
      type: "text",
      panelBoxType: "box",
      panel: {
        geometry: { width: 1.3, height: 1.3, depth: 0.01 },
        position: { x: -3, y: 7.6, z: 0.28 },
        material: { color: "#3A8798" }
      }
    });
    assert.equal(panelDeployed, true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(hinge.children.length, 2);
    assert.ok(hinge.children.some((node) => node?.isMesh));
  } finally {
    globalThis.document = prevDoc;
  }
});

test("back-mounted cabinet door opens outward with negative yaw", () => {
  const assembly = new THREE.Group();
  assembly.userData = { objJson: { cabinetDoorAssembly: true } };

  deployCabinetDoorSubSceneChild(assembly, {
    objType: "door",
    doorType: "left",
    swing: "left",
    hingeSide: "right",
    mountSide: "back",
    openDirection: "outward",
    geometry: { width: 3, height: 20, depth: 0.2 },
    material: { type: "standard", color: "#D0D1C9" },
    position: { x: 0, y: 0, z: 0 }
  });

  const leaf = assembly.children[0]?.children[0];
  const resolved = resolveDoorForAnimation(leaf);
  assert.ok(resolved);
  assert.ok(resolveOpenRotationY(resolved.descriptor) < 0);
});

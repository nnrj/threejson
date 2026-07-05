import { test } from "node:test";
import assert from "node:assert/strict";

import * as THREE from "three";
import "../builtins/register.js";
import {
  applyDoorMaterial,
  computeHingeOffsetFromCenter,
  createDoorJson,
  DOOR_OPEN_ANGLE_PRESETS,
  isDoorDescriptor,
  resolveOpenRotationY
} from "../domains/door/doorDescriptor.js";
import { createDoor } from "../domains/door/index.js";
import { isDomainDeployRootObjJson } from "../core/handler/domainDeployDescriptor.js";
import { collectObjectListFromScene } from "../core/util/sceneToJson.js";

test("createDoorJson sets canonical objType door", () => {
  const json = createDoorJson({
    name: "test-door",
    doorType: "right",
    glassKind: "clear"
  });
  assert.equal(json.objType, "door");
  assert.equal(json.doorType, "right");
  assert.equal(json.glassKind, "clear");
  assert.equal(json.type, undefined);
  assert.equal(json.businessInfo?.businessName, undefined);
  assert.equal(json.material.transparent, true);
});

test("isDoorDescriptor accepts flat door and domain deploy shell", () => {
  assert.equal(isDoorDescriptor({ objType: "door" }), true);
  assert.equal(isDoorDescriptor({
    objType: "domain",
    domain: "door",
    handler: "addToScene",
    items: [{ objType: "door", name: "glass-door" }]
  }), true);
  assert.equal(isDoorDescriptor({ objType: "box", businessInfo: { businessName: "door" } }), false);
  assert.equal(isDoorDescriptor({ type: "door" }), false);
});

test("createDoor attaches flat door persistSource on deploy root", () => {
  const group = createDoor({
    name: "glass-door",
    doorType: "left",
    glassKind: "clear",
    threeJsonId: "door-test-1"
  });
  assert.ok(group);
  const shell = group.userData.objJson;
  assert.equal(shell.objType, "door");
  assert.equal(shell.domain, "door");
  assert.equal(shell.handler, "addToScene");
  assert.equal(shell.threeJsonId, "door-test-1");
  assert.equal(shell.name, "glass-door");
  assert.equal(shell.items, undefined);
  assert.equal(isDomainDeployRootObjJson(shell), false);
  assert.deepEqual(group.userData.persistSource, shell);
  assert.equal(group.children[0]?.userData?.objJson?.objType, "door");
});

test("createDoor group position equals JSON hinge position at group origin", () => {
  const hinge = { x: -24.6, y: 9, z: -5 };
  const group = createDoor({
    doorType: "left",
    geometry: { width: 0.2, depth: 5, height: 19 },
    rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
    position: hinge
  });
  assert.ok(group);
  assert.equal(group.position.x, hinge.x);
  assert.equal(group.position.y, hinge.y);
  assert.equal(group.position.z, hinge.z);
});

test("collectObjectListFromScene preserves deployed door for snapshot round-trip", () => {
  const scene = new THREE.Scene();
  const group = createDoor({
    name: "snapshot-door",
    doorType: "right",
    glassKind: "clear",
    threeJsonId: "door-snap-1",
    position: { x: 10, y: 5, z: -2 }
  });
  scene.add(group);
  const list = collectObjectListFromScene(scene);
  assert.equal(list.length, 1);
  assert.equal(list[0].objType, "door");
  assert.equal(list[0].domain, "door");
  assert.equal(list[0].name, "snapshot-door");
  assert.equal(list[0].position.x, 10);
  assert.equal(list[0].position.y, 5);
  assert.equal(list[0].position.z, -2);
  assert.equal(list[0].items, undefined);
  assert.equal(list[0].subScene, undefined);
});

test("createDoorJson with textureUrl defaults textureFace all and keeps single material", () => {
  const json = createDoorJson({
    glassKind: "clear",
    material: { textureUrl: "/assets/textures/building/door/left_door.png" }
  });
  assert.equal(json.textureFace, "all");
  assert.equal(json.material.textureUrl, "/assets/textures/building/door/left_door.png");
  assert.equal(json.material.opacity, 0.85);
  assert.equal(json.material.transparent, true);
  assert.equal(json.materials, undefined);
});

test("createDoorJson with textureFace exterior applies single-face materials", () => {
  const json = createDoorJson({
    textureFace: "exterior",
    glassKind: "clear",
    geometry: { width: 9, depth: 0.25, height: 19 },
    exteriorFace: "-z",
    material: { textureUrl: "/assets/textures/building/door/left_door.png" }
  });
  assert.equal(json.textureFace, "exterior");
  assert.equal(json.material, undefined);
  assert.equal(json.materials?.length, 6);
  assert.equal(json.materials[5].textureUrl, "/assets/textures/building/door/left_door.png");
  assert.equal(json.materials[5].opacity, 0.85);
  assert.equal(json.materials[5].transparent, true);
  assert.equal(json.materials[4].textureUrl, undefined);
});

test("createDoorJson respects user materials array over textureFace", () => {
  const materials = Array.from({ length: 6 }, (_, i) => ({
    type: "standard",
    color: `#${i}${i}${i}`,
    textureUrl: i === 3 ? "/custom.png" : undefined
  }));
  const json = createDoorJson({
    textureFace: "exterior",
    materials,
    material: { textureUrl: "/ignored.png" }
  });
  assert.deepEqual(json.materials, materials);
  assert.equal(json.material?.textureUrl, "/ignored.png");
});

test("createDoorJson cabinet front door textures exterior +Z face only", () => {
  const json = createDoorJson({
    panelKind: "textured",
    mountSide: "front",
    geometry: { width: 6, height: 20, depth: 0.5 },
    material: {
      color: "#D0D1C9",
      textureUrl: "/assets/textures/device/cabinet/cabinet_left_door.png"
    }
  });
  assert.equal(json.materials[4].textureUrl, "/assets/textures/device/cabinet/cabinet_left_door.png");
  assert.equal(json.textureFace, "exterior");
  assert.equal(json.materials[5].color, "#1a1a1a");
  assert.equal(json.materials[0].color, "#1a1a1a");
  assert.equal(json.materials[4].transparent, false);
  assert.equal(json.materials[4].opacity, 1);
  assert.equal(json.materials[5].textureUrl, undefined);
});

test("createDoorJson cabinet back door textures exterior -Z face only", () => {
  const json = createDoorJson({
    panelKind: "textured",
    mountSide: "back",
    geometry: { width: 6, height: 20, depth: 0.5 },
    material: {
      color: "#D0D1C9",
      textureUrl: "/assets/textures/device/cabinet/cabinet_right_door.png"
    }
  });
  assert.equal(json.materials[5].textureUrl, "/assets/textures/device/cabinet/cabinet_right_door.png");
  assert.equal(json.materials[4].textureUrl, undefined);
});

test("createDoorJson without textureUrl keeps clear glass preset", () => {
  const json = createDoorJson({ glassKind: "clear" });
  assert.equal(json.material.opacity, 0.35);
});

test("applyDoorMaterial doorPanel preset keeps base metalness and roughness", () => {
  const material = applyDoorMaterial(
    {
      type: "standard",
      color: "#ffffff",
      textureUrl: "/assets/textures/device/cabinet/cabinet_left_door.png",
      metalness: 0.35,
      roughness: 0.55
    },
    { panelKind: "glass", glassKind: "clear" }
  );
  assert.equal(material.opacity, 0.85);
  assert.equal(material.metalness, 0.35);
  assert.equal(material.roughness, 0.55);
  assert.equal(material.color, "#ffffff");
});

test("computeHingeOffsetFromCenter uses depth for wall-aligned doors", () => {
  const left = computeHingeOffsetFromCenter({
    doorType: "left",
    geometry: { width: 0.2, depth: 5, height: 19 },
    scale: { scaleX: 1, scaleY: 1, scaleZ: 1 }
  });
  assert.equal(left.x, 0);
  assert.equal(left.y, 0);
  assert.equal(left.z, -2.5);

  const right = computeHingeOffsetFromCenter({
    doorType: "right",
    geometry: { width: 0.2, depth: 5, height: 19 },
    scale: { scaleX: 1, scaleY: 1, scaleZ: 1 }
  });
  assert.equal(right.z, 2.5);
});

test("computeHingeOffsetFromCenter honors hingeSide independent of doorType", () => {
  const leftHinge = computeHingeOffsetFromCenter({
    doorType: "left",
    hingeSide: "right",
    geometry: { width: 6, depth: 0.2, height: 20 }
  });
  assert.equal(leftHinge.x, 3);

  const rightHinge = computeHingeOffsetFromCenter({
    doorType: "right",
    hingeSide: "left",
    geometry: { width: 6, depth: 0.2, height: 20 }
  });
  assert.equal(rightHinge.x, -3);
});

test("resolveOpenRotationY keeps cabinet front/back doors on legacy swing sign", () => {
  const frontLeft = resolveOpenRotationY({
    doorType: "left",
    hingeSide: "left",
    mountSide: "front",
    openDirection: "outward"
  });
  const backLeft = resolveOpenRotationY({
    doorType: "left",
    hingeSide: "right",
    mountSide: "back",
    openDirection: "outward"
  });
  const sideRight = resolveOpenRotationY({
    doorType: "right",
    hingeSide: "left",
    mountSide: "left",
    openDirection: "outward"
  });
  assert.ok(frontLeft < 0);
  assert.ok(backLeft < 0);
  assert.ok(sideRight < 0);
});

test("resolveOpenRotationY honors openAngleDeg", () => {
  const angle = resolveOpenRotationY({
    doorType: "left",
    openAngleDeg: 45
  });
  assert.ok(Math.abs(angle + (45 * Math.PI) / 180) < 1e-9);
});

test("normalizeOpenAngleDeg falls back to preset default", () => {
  assert.equal(DOOR_OPEN_ANGLE_PRESETS.cabinet, 130);
  assert.equal(DOOR_OPEN_ANGLE_PRESETS.room, 108);
});

test("computeHingeOffsetFromCenter uses width for cabinet doors", () => {
  const left = computeHingeOffsetFromCenter({
    doorType: "left",
    geometry: { width: 70, depth: 2, height: 150 },
    scale: { scaleX: 1, scaleY: 1, scaleZ: 1 }
  });
  assert.equal(left.x, -35);
  assert.equal(left.z, 0);

  const right = computeHingeOffsetFromCenter({
    doorType: "right",
    geometry: { width: 70, depth: 2, height: 150 }
  });
  assert.equal(right.x, 35);
});

test("leaf mesh local offset places door panel center relative to hinge group", () => {
  const hinge = { x: -24.6, y: 9, z: -5 };
  const offset = computeHingeOffsetFromCenter({
    doorType: "left",
    geometry: { width: 0.2, depth: 5, height: 19 },
    scale: { scaleX: 1, scaleY: 1, scaleZ: 1 }
  });
  const group = createDoor({
    doorType: "left",
    geometry: { width: 0.2, depth: 5, height: 19 },
    position: hinge,
    rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 }
  });
  assert.ok(group?.children[0]);
  const mesh = group.children[0];
  assert.equal(mesh.position.x, -offset.x);
  assert.equal(mesh.position.y, -offset.y);
  assert.equal(mesh.position.z, -offset.z);
});

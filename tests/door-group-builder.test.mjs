import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createDoorGroupJson,
  normalizeLeafCount,
  normalizePanelKind,
  normalizeSwing
} from "../domains/door/doorGroupBuilder.js";
import { resolveCabinetDoorTexture } from "../domains/device/cabinet/cabinetDoorBuilder.js";

test("normalizePanelKind and swing", () => {
  assert.equal(normalizePanelKind("glass"), "glass");
  assert.equal(normalizePanelKind("solid"), "solid");
  assert.equal(normalizePanelKind(undefined), "solid");
  assert.equal(normalizeSwing({ swing: "right" }), "right");
  assert.equal(normalizeLeafCount("double"), 2);
  assert.equal(normalizeLeafCount(1), 1);
});

test("createDoorGroupJson single leaf glass assembly", () => {
  const json = createDoorGroupJson({
    name: "front-door",
    panelKind: "glass",
    swing: "left",
    leafCount: 1,
    geometry: { width: 6, height: 20, depth: 0.2 },
    label: { text: "01" }
  });
  assert.equal(json.cabinetDoorAssembly, true);
  assert.equal(json.boxModelList.length, 1);
  assert.equal(json.boxModelList[0].objType, "door");
  assert.equal(json.boxModelList[0].doorType, "left");
  assert.equal(json.boxModelList[0].glassKind, "clear");
  assert.ok(Array.isArray(json.infoPanelList));
});

test("createDoorGroupJson cabinet glass door keeps dark shell PBR on exterior face", () => {
  const json = createDoorGroupJson({
    name: "front-door",
    panelKind: "glass",
    textureFace: "exterior",
    mountSide: "front",
    swing: "right",
    leafCount: 1,
    glassKind: "clear",
    geometry: { width: 6, height: 20, depth: 0.2 },
    material: {
      type: "standard",
      color: "#ffffff",
      interiorColor: "#1a1a1a",
      metalness: 0.35,
      roughness: 0.55
    },
    resolveTextureUrlForSwing: resolveCabinetDoorTexture
  });
  const exterior = json.boxModelList[0].materials[4];
  assert.equal(exterior.color, "#ffffff");
  assert.equal(exterior.metalness, 0.35);
  assert.equal(exterior.roughness, 0.55);
  assert.equal(json.boxModelList[0].materials[5].color, "#1a1a1a");
});

test("createDoorGroupJson textured leaf uses exterior-only materials", () => {
  const json = createDoorGroupJson({
    name: "front-door",
    panelKind: "textured",
    mountSide: "front",
    swing: "left",
    leafCount: 1,
    geometry: { width: 6, height: 20, depth: 0.2 },
    material: { color: "#D0D1C9" },
    resolveTextureUrlForSwing: (swing) =>
      swing === "left"
        ? "/assets/textures/device/cabinet/cabinet_left_door.png"
        : "/assets/textures/device/cabinet/cabinet_right_door.png"
  });
  const leaf = json.boxModelList[0];
  assert.equal(leaf.material, undefined);
  assert.equal(leaf.materials?.length, 6);
  assert.equal(leaf.materials[4].textureUrl, "/assets/textures/device/cabinet/cabinet_left_door.png");
  assert.equal(leaf.materials[5].textureUrl, undefined);
});

test("createDoorGroupJson double leaf picks texture per swing", () => {
  const json = createDoorGroupJson({
    name: "back-door",
    panelKind: "textured",
    mountSide: "back",
    leafCount: 2,
    geometry: { width: 8, height: 20, depth: 0.2 },
    material: { color: "#D0D1C9" },
    resolveTextureUrlForSwing: (swing) =>
      swing === "left"
        ? "/assets/textures/device/cabinet/cabinet_left_door.png"
        : "/assets/textures/device/cabinet/cabinet_right_door.png"
  });
  const leftLeaf = json.subGroup[0].boxModelList[0];
  const rightLeaf = json.subGroup[1].boxModelList[0];
  assert.equal(leftLeaf.materials[5].textureUrl, "/assets/textures/device/cabinet/cabinet_left_door.png");
  assert.equal(rightLeaf.materials[5].textureUrl, "/assets/textures/device/cabinet/cabinet_right_door.png");
});

test("createDoorGroupJson double leaf wrapper", () => {
  const json = createDoorGroupJson({
    name: "double-door",
    leafCount: 2,
    geometry: { width: 8, height: 16, depth: 0.2 }
  });
  assert.equal(json.subGroup?.length, 2);
  assert.equal(json.subGroup[0].cabinetDoorAssembly, true);
  assert.equal(json.subGroup[1].boxModelList[0].doorType, "right");
});

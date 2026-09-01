import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildFootprint,
  buildGeometrySummary,
  buildCompactReferenceDescriptor,
  buildObjectSpatialCard,
  buildObjectSpatialCardsFromSceneJson,
  buildPlacementHints,
  buildSceneScaleProfile,
  extractPromptTokens,
  pickReferenceObjects,
  promptHasRelativePlacement
} from "../tools/common/editor-single/ai/sceneSpatialContext.js";

test("buildGeometrySummary for box sphere cylinder", () => {
  assert.equal(
    buildGeometrySummary({
      objType: "box",
      geometry: { width: 30, height: 40, depth: 20 }
    }),
    "box 30×40×20"
  );
  assert.equal(
    buildGeometrySummary({ objType: "sphere", geometry: { radius: 5 } }),
    "sphere r=5"
  );
  assert.equal(
    buildGeometrySummary({ objType: "cylinder", geometry: { radiusTop: 3, height: 10 } }),
    "cylinder r=3/h=10"
  );
});

test("buildFootprint estimates axis-aligned bounds for box", () => {
  const fp = buildFootprint({
    objType: "box",
    position: { x: 0, y: 20, z: 0 },
    geometry: { width: 30, height: 40, depth: 20 }
  });
  assert.equal(fp.minX, -15);
  assert.equal(fp.maxX, 15);
  assert.equal(fp.minY, 0);
  assert.equal(fp.maxY, 40);
});

test("buildObjectSpatialCard and buildSceneScaleProfile", () => {
  const card = buildObjectSpatialCard({
    threeJsonId: "a1",
    name: "main-body",
    objType: "box",
    position: { x: 0, y: 20, z: 0 },
    geometry: { width: 30, height: 40, depth: 20 }
  });
  assert.equal(card.geometrySummary, "box 30×40×20");
  const profile = buildSceneScaleProfile([card]);
  assert.equal(profile.objectCount, 1);
  assert.ok(profile.characteristicSize >= 30);
  assert.ok(profile.typicalPartRange.includes("40"));
});

test("complex mesh spatial cards carry bounds and counts without embedding dense coordinates", () => {
  const descriptor = {
    threeJsonId: "raw-shell",
    name: "raw-shell",
    objType: "bufferMesh",
    position: { x: 10, y: 2, z: -4 },
    scale: { x: 2, y: 1, z: 0.5 },
    geometry: {
      attributes: {
        position: { array: [-1, -2, -3, 1, 2, 3], itemSize: 3 },
        normal: { array: [0, 1, 0, 0, 1, 0], itemSize: 3 }
      },
      index: { array: [0, 1, 1] }
    }
  };
  const card = buildObjectSpatialCard(descriptor);
  assert.match(card.geometrySummary, /bufferMesh 2v\/1t/);
  assert.equal(card.footprint.minX, 8);
  assert.equal(card.footprint.maxX, 12);
  assert.equal(card.footprint.minY, 0);
  assert.equal(card.footprint.maxY, 4);
  assert.equal(card.footprint.minZ, -5.5);
  assert.equal(card.footprint.maxZ, -2.5);

  const compact = buildCompactReferenceDescriptor(descriptor);
  const text = JSON.stringify(compact);
  assert.match(text, /bufferMesh/);
  assert.doesNotMatch(text, /-1,-2,-3/);
  assert.equal(Object.hasOwn(compact, "geometry"), false);
});

test("JSON-only spatial context composes nested transforms for editable meshes", () => {
  const scene = {
    threeJsonId: "nested-scene",
    objectList: [{
      threeJsonId: "assembly",
      objType: "group",
      position: { x: 20, y: 0, z: 0 },
      subScene: [{
        threeJsonId: "control-shell",
        name: "control-shell",
        objType: "editableMesh",
        position: { x: 3, y: 0, z: 0 },
        topology: {
          revision: 4,
          vertices: [
            { id: "a", position: [-2, 0, -1] },
            { id: "b", position: [2, 0, -1] },
            { id: "c", position: [0, 4, 1] }
          ],
          faces: [{ id: "body", vertices: ["a", "b", "c"], part: "body" }]
        },
        modifiers: [{ id: "subdivision", type: "loop", levels: 2 }]
      }]
    }]
  };
  const { cards } = buildObjectSpatialCardsFromSceneJson(scene);
  const card = cards.find((item) => item.threeJsonId === "control-shell");
  assert.ok(card);
  assert.deepEqual(card.worldPosition, { x: 23, y: 0, z: 0 });
  assert.equal(card.footprint.minX, 21);
  assert.equal(card.footprint.maxX, 25);
  assert.equal(card.boundsSource, "descriptor-control-cage");
  assert.match(card.geometrySummary, /control=3v\/1f/);
});

test("pickReferenceObjects uses prompt token overlap with object names", () => {
  const cards = [
    { threeJsonId: "p1", name: "main-pump-unit", objType: "box" },
    { threeJsonId: "f1", name: "floor-slab", objType: "box" }
  ];
  const descriptorById = new Map([
    [
      "p1",
      {
        threeJsonId: "p1",
        name: "main-pump-unit",
        objType: "box",
        position: { x: 0, y: 20, z: 0 },
        geometry: { width: 30, height: 40, depth: 20 },
        material: { color: "#888888" }
      }
    ]
  ]);
  const refs = pickReferenceObjects("add a valve near the pump-unit", cards, descriptorById);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].threeJsonId, "p1");
  assert.ok(refs[0].geometry);
});

test("pickReferenceObjects prefers selection for relative placement prompts", () => {
  const cards = [{ threeJsonId: "other", name: "other-part", objType: "box" }];
  const refs = pickReferenceObjects(
    "add a copy beside it",
    cards,
    new Map(),
    {
      selectionId: "sel-1",
      selectionDescriptor: {
        threeJsonId: "sel-1",
        name: "selected-assembly",
        objType: "box",
        geometry: { width: 10, height: 10, depth: 10 }
      }
    }
  );
  assert.equal(refs.length, 1);
  assert.equal(refs[0].threeJsonId, "sel-1");
});

test("buildPlacementHints includes unless modification request specifies otherwise", () => {
  assert.equal(promptHasRelativePlacement("在它旁边加一个"), true);
  const hint = buildPlacementHints(
    "在它旁边加一个",
    [
      {
        name: "anchor-part",
        footprint: { minX: -20, maxX: 20, minY: 0, maxY: 40, minZ: -10, maxZ: 10 }
      }
    ],
    { typicalPartRange: "8–40" }
  );
  assert.ok(hint.includes("unless the modification request specifies otherwise"));
  assert.ok(hint.includes("x≈"));
});

test("buildPlacementHints falls back to scene bounds without reference objects", () => {
  const hint = buildPlacementHints(
    "place new unit next to existing layout",
    [],
    {
      typicalPartRange: "10–50",
      sceneBounds: { min: { x: -100, y: 0, z: -50 }, max: { x: 100, y: 80, z: 50 } }
    }
  );
  assert.ok(hint.includes("Scene spans"));
  assert.ok(hint.includes("unless the modification request specifies otherwise"));
});

test("extractPromptTokens is generic without domain keyword lists", () => {
  const tokens = extractPromptTokens("Move main-pump near zone A");
  assert.ok(tokens.includes("move"));
  assert.ok(tokens.includes("main"));
  assert.ok(tokens.includes("pump"));
  assert.equal(tokens.includes("机器人"), false);
});

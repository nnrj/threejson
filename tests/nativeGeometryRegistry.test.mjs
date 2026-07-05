import assert from "node:assert/strict";
import { test } from "node:test";
import { ObjectLoader } from "three";

import {
  collectRequiredNativeGeometries,
  ensureNativeGeometriesRegistered,
  isJsmGeometryType
} from "../core/util/nativeGeometryRegistry.js";

test("isJsmGeometryType recognizes RoundedBoxGeometry", () => {
  assert.equal(isJsmGeometryType("RoundedBoxGeometry"), true);
  assert.equal(isJsmGeometryType("BoxGeometry"), false);
});

test("collectRequiredNativeGeometries includes roundedBox alias and extensions config", () => {
  const names = collectRequiredNativeGeometries({
    sceneConfig: {
      extensions: { nativeGeometries: ["TextGeometry"] }
    },
    objectList: [
      { objType: "roundedBox", width: 2, height: 1, depth: 1 },
      { objType: "pedestal", geometry: { type: "RoundedBoxGeometry", width: 1, height: 1, depth: 1 } }
    ]
  });
  assert.ok(names.includes("RoundedBoxGeometry"));
  assert.ok(names.includes("TextGeometry"));
});

test("ensureNativeGeometriesRegistered parses RoundedBoxGeometry", async () => {
  const result = await ensureNativeGeometriesRegistered(["RoundedBoxGeometry"]);
  assert.ok(result.registered.includes("RoundedBoxGeometry"));
  const graph = {
    metadata: { version: 4.6, type: "Object", generator: "test" },
    geometries: [
      { uuid: "g1", type: "RoundedBoxGeometry", width: 2, height: 1, depth: 1, radius: 0.1, segments: 4 }
    ],
    materials: [{ uuid: "m1", type: "MeshStandardMaterial", color: 0xff0000 }],
    object: { uuid: "o1", type: "Mesh", geometry: "g1", material: "m1" }
  };
  const mesh = new ObjectLoader().parse(graph);
  assert.equal(mesh.geometry?.type, "RoundedBoxGeometry");
});

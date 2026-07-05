import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import {
  buildObjectLoaderGraphFromRecord,
  deployNativeObjectRecord
} from "../core/builder/nativeObjectBuilder.js";
import {
  resolveParseMode,
  shouldDeployNativeOnly,
  shouldTryNativeFallback
} from "../core/handler/nativeParseMode.js";

test("resolveParseMode defaults to auto", () => {
  assert.equal(resolveParseMode({}), "auto");
  assert.equal(resolveParseMode({}, { sceneConfig: { parseMode: "default" } }), "default");
  assert.equal(resolveParseMode({ parseMode: "native" }), "native");
});

test("shouldDeployNativeOnly for objType native and parseMode native", () => {
  assert.equal(shouldDeployNativeOnly({ objType: "native", threeType: "Mesh" }), true);
  assert.equal(shouldDeployNativeOnly({ objType: "box", parseMode: "native" }), true);
  assert.equal(shouldDeployNativeOnly({ objType: "box" }), false);
  assert.equal(shouldTryNativeFallback({ objType: "box" }), true);
  assert.equal(shouldTryNativeFallback({ objType: "box", parseMode: "default" }), false);
});

test("buildObjectLoaderGraphFromRecord flat Mesh", () => {
  const graph = buildObjectLoaderGraphFromRecord({
    objType: "native",
    threeType: "Mesh",
    geometry: { type: "BoxGeometry", width: 2, height: 1, depth: 3 },
    material: { type: "MeshStandardMaterial", color: "#336699" }
  });
  assert.ok(graph);
  assert.equal(graph.object.type, "Mesh");
  assert.equal(graph.geometries.length, 1);
  assert.equal(graph.geometries[0].type, "BoxGeometry");
});

test("buildObjectLoaderGraphFromRecord infers Mesh from geometry.type", () => {
  const graph = buildObjectLoaderGraphFromRecord({
    objType: "native",
    geometry: { type: "SphereGeometry", radius: 2, widthSegments: 8, heightSegments: 8 },
    material: { type: "MeshStandardMaterial", color: "#ffffff" }
  });
  assert.ok(graph);
  assert.equal(graph.object.type, "Mesh");
});

test("buildObjectLoaderGraphFromRecord hierarchical Group", () => {
  const graph = buildObjectLoaderGraphFromRecord({
    objType: "native",
    threeType: "Group",
    children: [
      {
        threeType: "Mesh",
        geometry: { type: "BoxGeometry", width: 1, height: 1, depth: 1 },
        material: { type: "MeshStandardMaterial", color: "#ff0000" }
      }
    ]
  });
  assert.ok(graph);
  assert.equal(graph.object.type, "Group");
  assert.ok(Array.isArray(graph.object.children));
  assert.equal(graph.object.children.length, 1);
});

test("buildObjectLoaderGraphFromRecord infers Mesh from unknown geometry.type", () => {
  const graph = buildObjectLoaderGraphFromRecord({
    objType: "torusKnot",
    geometry: {
      type: "TorusKnotGeometry",
      radius: 4,
      tube: 1,
      tubularSegments: 64,
      radialSegments: 8,
      p: 2,
      q: 3
    },
    material: { type: "MeshStandardMaterial", color: "#ffffff" }
  });
  assert.ok(graph);
  assert.equal(graph.object.type, "Mesh");
  assert.equal(graph.geometries[0].type, "TorusKnotGeometry");
});

test("deployNativeObjectRecord registers objJson on mesh", () => {
  const scene = new THREE.Scene();
  const record = {
    objType: "native",
    threeType: "Mesh",
    threeJsonId: "native-test-1",
    name: "native-mesh",
    geometry: { type: "BoxGeometry", width: 1, height: 1, depth: 1 },
    material: { type: "MeshStandardMaterial", color: "#888888" },
    position: { x: 1, y: 0, z: 0 }
  };
  const ok = deployNativeObjectRecord(scene, record, {});
  assert.equal(ok, true);
  assert.equal(scene.children.length, 1);
  const mesh = scene.children[0];
  assert.ok(mesh.isMesh);
  assert.equal(mesh.userData.objJson.threeJsonId, "native-test-1");
  assert.equal(mesh.userData.objJson.objType, "native");
});

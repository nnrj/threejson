import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { deployInstancedMeshWithFactory } from "../core/builder/instancedBuilder.js";
import {
  createGeometryFromDescriptor,
  registerGeometryFactory,
  unregisterGeometryFactory
} from "../core/builder/geometry/geometryFactory.js";

test("geometry factory covers declarative core primitives", () => {
  const sphere = createGeometryFromDescriptor({ geometry: { type: "SphereGeometry", radius: 2 } });
  assert.equal(sphere.type, "SphereGeometry");
  assert.equal(sphere.parameters.radius, 2);
  sphere.dispose();
});

test("instanced supports registered geometry and per-instance colors", () => {
  registerGeometryFactory("testTriangle", () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    return geometry;
  });
  const scene = new THREE.Scene();
  const record = {
    objType: "instanced",
    name: "triangles",
    geometry: { type: "testTriangle" },
    material: { type: "basic", color: "#ffffff" },
    transforms: [
      { position: { x: 0, y: 0, z: 0 }, color: "#ff0000" },
      { position: { x: 2, y: 0, z: 0 }, scale: { x: 2, y: 2, z: 2 }, color: "#00ff00" }
    ]
  };
  const mesh = deployInstancedMeshWithFactory(() => null, record, scene);
  assert.equal(mesh.isInstancedMesh, true);
  assert.equal(mesh.count, 2);
  assert.equal(mesh.geometry.userData.threeJsonGeometryType, "testtriangle");
  assert.ok(mesh.instanceColor);
  assert.equal(scene.children.includes(mesh), true);
  unregisterGeometryFactory("testTriangle");
});

test("invalid instanced descriptors fail instead of creating an empty scene record", () => {
  assert.throws(
    () => deployInstancedMeshWithFactory(() => null, { objType: "instanced", transforms: [] }, new THREE.Scene()),
    (error) => error?.code === "E_INSTANCED_TRANSFORMS_REQUIRED"
  );
  assert.throws(
    () => deployInstancedMeshWithFactory(() => null, {
      objType: "instanced",
      geometry: { type: "not-registered" },
      transforms: [{}]
    }, new THREE.Scene()),
    (error) => error?.code === "E_GEOMETRY_TYPE_UNAVAILABLE"
  );
});

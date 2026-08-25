import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import { deploySphere } from "../core/builder/modelBuilder.js";
import { deployObjectRecord } from "../core/handler/objectDispatchHandler.js";

test("deploySphere uses the current sphere factory path", () => {
  const scene = new THREE.Scene();
  deploySphere({
    name: "deployed-sphere",
    objType: "sphere",
    threeJsonId: "sphere-deploy-test",
    geometry: { radius: 2 },
    material: { color: "#ffffff" }
  }, scene);
  const sphere = scene.children.find((child) => child.name === "deployed-sphere");
  assert.ok(sphere instanceof THREE.Mesh);
  assert.equal(sphere.userData.objJson.threeJsonId, "sphere-deploy-test");
});

test("object dispatcher deploys core particleEmitter without an extension provider", () => {
  const scene = new THREE.Scene();
  deployObjectRecord(scene, {
    objType: "particleEmitter",
    name: "solar-halo",
    source: { type: "shell", radius: 8, thickness: 1 },
    emission: { mode: "static", count: 12, seed: 5 },
    particle: { lifetime: 0 },
    simulation: { backend: "cpu" },
    render: { color: "#ffcc66", size: 2, transparent: true, opacity: 0.45, blending: "additive" }
  }, {});
  const points = scene.children.find((child) => child.name === "solar-halo");
  assert.ok(points instanceof THREE.Points);
  assert.equal(points.userData.objJson.objType, "particleEmitter");
  assert.equal(points.userData.objJson.simulation.backend, "cpu");
});

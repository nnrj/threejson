import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { evaluateProceduralMeshGeometry } from "../core/geometry/proceduralMeshGeometry.js";
import { inspectGeometryQuality } from "../core/geometry/geometryQuality.js";
import { sampleTimelineSignal, validateTimelineSignal } from "../core/timeline/signals.js";
import { applySceneBackdropSimpleFromHints, applySceneBackdropFromHints } from "../core/handler/sceneBackdropResolver.js";
import { applyRuntimeSceneConfigToPayload } from "../core/util/sceneRuntimeConfigExport.js";
import { buildDeclarativeLightsFromExtent } from "../core/util/sceneRuntimeDefaults.js";
import { buildSceneHostRuntimeConfig } from "../packages/host-kit/js/buildSceneHostRuntimeConfig.js";
import { createMaterialFromDescriptor, applyMaterialDescriptorProperties } from "../core/builder/material/materialFactory.js";
import { deployJsonSceneSimple } from "../core/handler/sceneLoadHandler.js";

test("SDF sphere has consistently outward faces and smooth analytic normals", () => {
  const built = evaluateProceduralMeshGeometry({ objType: "implicitSurface", geometry: { resolution: 12, sdf: { type: "sphere", radius: 1 } } });
  assert.ok(built.geometry, built.error);
  const g = built.geometry, p = g.attributes.position, n = g.attributes.normal;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    assert.ok(b.sub(a).cross(c.sub(a)).dot(a) > 0);
    assert.ok(a.clone().normalize().dot(new THREE.Vector3().fromBufferAttribute(n, i)) > .999);
  }
  const report = inspectGeometryQuality(g);
  assert.equal(report.boundaryEdges, 0); assert.equal(report.inconsistentWindingEdges, 0);
  assert.equal(report.reversedNormals, 0); assert.equal(report.degenerateTriangles, 0); g.dispose();
});

test("closed loft smooths declared seams without merging UVs; hard seam remains opt-in", () => {
  const descriptor = { sections: [[[1,0,0],[0,0,1],[-1,0,0],[0,0,-1]], [[1,2,0],[0,2,1],[-1,2,0],[0,2,-1]]] };
  for (const smooth of [true, false]) {
    const { geometry: g } = evaluateProceduralMeshGeometry({ objType: "loftMesh", geometry: { ...descriptor, smoothSeams: smooth } });
    const a = new THREE.Vector3().fromBufferAttribute(g.attributes.normal, 0), b = new THREE.Vector3().fromBufferAttribute(g.attributes.normal, 4);
    assert.equal(a.distanceTo(b) < 1e-6, smooth); assert.equal(g.attributes.uv.getX(0), 0); assert.equal(g.attributes.uv.getX(4), 1); g.dispose();
  }
});

test("error-driven surface refinement is bounded and keeps a flat patch small", () => {
  const build = z => evaluateProceduralMeshGeometry({ objType: "parametricSurface", geometry: { uSegments: 2, vSegments: 2, expressions: { x: "u", y: "v", z }, tessellation: { maxError: .005, maxSegments: 32 } } });
  const flat = build("0"), curved = build("sin(u*PI)*sin(v*PI)");
  assert.equal(flat.geometry.attributes.position.count, 9); assert.ok(curved.geometry.attributes.position.count > 9); assert.ok(curved.geometry.attributes.position.count <= 1089);
  flat.geometry.dispose(); curved.geometry.dispose();
});

test("closed loft face orientation is outward for either profile order, with hard caps", () => {
  for (const reverse of [false, true]) {
    const sections = [-1, 1].map(y => [[1,y,0],[0,y,1],[-1,y,0],[0,y,-1]]);
    if (reverse) sections.forEach(section => section.reverse());
    const { geometry: g } = evaluateProceduralMeshGeometry({ objType: "loftMesh", geometry: { sections, caps: true } });
    const p = g.attributes.position, index = g.index;
    for (let i = 0; i < index.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(p, index.getX(i)), b = new THREE.Vector3().fromBufferAttribute(p, index.getX(i+1)), c = new THREE.Vector3().fromBufferAttribute(p, index.getX(i+2));
      assert.ok(b.sub(a).cross(c.sub(a)).dot(a) > 0);
    }
    assert.equal(inspectGeometryQuality(g).inconsistentWindingEdges, 0); g.dispose();
  }
});

test("arc length paths have constant speed; legacy parameter paths and absolute seek remain intact", () => {
  const signal = { type: "path", interpolation: "linear", duration: 2, points: [[0,0,0],[1,0,0],[11,0,0]], parameterization: "arcLength" };
  [0,.5,1,1.5,2].forEach(t => assert.ok(Math.abs(sampleTimelineSignal(signal, t)[0] - 5.5 * t) < 1e-10));
  assert.equal(sampleTimelineSignal({ ...signal, parameterization: "parameter" }, 1)[0], 1);
  const eased = { ...signal, speedCurve: [[0,0],[.5,1],[1,0]] };
  validateTimelineSignal(eased); assert.equal(sampleTimelineSignal(eased, 1)[0], 5.5);
  assert.deepEqual(sampleTimelineSignal(eased, .5), sampleTimelineSignal(eased, .5));
  assert.throws(() => validateTimelineSignal({ ...signal, speedCurve: [[0,0],[1,0]] }), /speedCurve/);
});

test("environment appearance is applied and captured without texture downloads", async () => {
  const hints = { environmentIntensity: .3, backgroundIntensity: .4, backgroundBlurriness: .2, environmentRotation: { y: 1 }, backgroundRotation: [.1,.2,.3] };
  const scene = new THREE.Scene(); applySceneBackdropSimpleFromHints(scene, hints);
  assert.equal(scene.environmentIntensity, .3); assert.equal(scene.environmentRotation.y, 1);
  await applySceneBackdropFromHints(scene, { environmentIntensity: .8 }); assert.equal(scene.environmentIntensity, .8);
  const payload = {}; applyRuntimeSceneConfigToPayload(payload, {}, scene);
  assert.equal(payload.sceneConfig.scene.environmentRotation.y, 1); assert.equal(payload.sceneConfig.scene.backgroundIntensity, .4);
  const material = createMaterialFromDescriptor({ type: "standard", envMapRotation: { y: 1 } });
  assert.equal(material.envMapRotation.y, 1); applyMaterialDescriptorProperties(material, { envMapRotation: [0,2,0] }); assert.equal(material.envMapRotation.y, 2); material.dispose();
});

test("default lights follow scene center, and host adapters preserve authored render/camera settings", () => {
  const a = buildDeclarativeLightsFromExtent({ center: {x:0,y:0,z:0}, maxDim: 10 });
  const b = buildDeclarativeLightsFromExtent({ center: {x:1000,y:200,z:300}, maxDim: 10 });
  assert.equal(b[0].position.x - a[0].position.x, 1000); assert.equal(b[0].target.x, 1000);
  const config = buildSceneHostRuntimeConfig({}, {}, { camera: { type: "orthographic", zoom: 2, lookAt: {x:1,y:2,z:3} }, renderer: { toneMapping: "agx", toneMappingExposure: 1.2, outputColorSpace: "srgb" } });
  assert.equal(config.camera.type, "orthographic"); assert.equal(config.camera.zoom, 2); assert.equal(config.renderer.toneMapping, "agx");
});

test("managed scene lights honor explicit castShadow false", () => {
  const scene = new THREE.Scene();
  deployJsonSceneSimple(scene, { version: "next", objectList: [], sceneConfig: { lights: [{ type: "directional", castShadow: false }] } });
  assert.equal(scene.children.find(o => o.isLight)?.castShadow, false);
});

test("sweep uses arc-length frames, supports analytic paths, caps and independent twist", () => {
  const descriptor = { profile: [[-1,-1],[1,-1],[1,1],[-1,1]], path: { type: "line", points: [[0,0,0],[0,0,4]] }, segments: 8, caps: true, twist: Math.PI / 2 };
  const result = evaluateProceduralMeshGeometry({ objType: "sweepMesh", geometry: descriptor });
  assert.ok(result.geometry, result.error);
  const diagnostics = inspectGeometryQuality(result.geometry);
  assert.equal(diagnostics.boundaryEdges, 0); assert.equal(diagnostics.inconsistentWindingEdges, 0); assert.equal(diagnostics.invalidNormals, 0); result.geometry.dispose();
});

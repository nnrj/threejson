import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createCurveFromDescriptor, sampleCurveDescriptor } from "../core/builder/curve/curveFactory.js";
import { deployLod } from "../core/builder/lodBuilder.js";
import { updateSceneAnimations } from "../core/handler/animationHandler.js";
import { listMorphTargets, setMorphTargetInfluence } from "../core/handler/morphTargetRuntime.js";
import { getSceneCapability } from "../core/capabilities/sceneCapabilityManifest.js";
import { sceneUsesExtraControls } from "../core/capabilities/optionalCapabilityLoader.js";

test("shared curve factory covers line, Bezier, ellipse and CurvePath", () => {
  const line = createCurveFromDescriptor({ type: "line", points: [[0,0,0], [2,0,0], [2,2,0]] }, THREE);
  assert.equal(line.curves.length, 2);
  const quadratic = createCurveFromDescriptor({ type: "quadraticBezier", points: [[0,0,0], [1,2,0], [2,0,0]] }, THREE);
  assert.equal(quadratic.isQuadraticBezierCurve3, true);
  const cubic = createCurveFromDescriptor({ type: "cubicBezier", points: [[0,0,0], [1,2,0], [2,2,0], [3,0,0]] }, THREE);
  assert.equal(cubic.isCubicBezierCurve3, true);
  const ellipse = createCurveFromDescriptor({ type: "ellipse", plane: "xz", xRadius: 2, yRadius: 1 }, THREE);
  assert.equal(ellipse.getPoint(0).z, 0);
  const path = createCurveFromDescriptor({ type: "curvePath", curves: [
    { type: "line", points: [[0,0,0], [1,0,0]] },
    { type: "quadraticBezier", points: [[1,0,0], [2,1,0], [3,0,0]] }
  ] }, THREE);
  assert.equal(path.curves.length, 2);
  assert.equal(sampleCurveDescriptor({ type: "line", points: [[0,0,0], [1,0,0]] }, 4, THREE).length, 12);
  assert.throws(
    () => createCurveFromDescriptor({ type: "bezzier", points: [[0,0,0], [1,1,0]] }, THREE),
    (error) => error?.code === "E_CURVE_TYPE_UNAVAILABLE"
  );
  assert.throws(
    () => createCurveFromDescriptor({ type: "cubicBezier", points: [[0,0,0], [1,1,0]] }, THREE),
    (error) => error?.code === "E_CURVE_POINTS_REQUIRED"
  );
});

test("LOD is a canonical deploy root with declarative levels", () => {
  const scene = new THREE.Scene();
  const record = {
    objType: "lod",
    threeJsonId: "lod-1",
    levels: [
      { distance: 0, hysteresis: 0.1, object: { objType: "box", threeJsonId: "near" } },
      { distance: 100, object: { objType: "box", threeJsonId: "far" } }
    ]
  };
  const lod = deployLod(record, scene, {}, (parent, child) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    mesh.userData.objJson = child;
    parent.add(mesh);
    return mesh;
  });
  assert.equal(lod.isLOD, true);
  assert.equal(lod.levels.length, 2);
  assert.equal(lod.levels[1].distance, 100);
  assert.equal(lod.children[0].userData.__threeJsonExportExcluded, true);
  assert.equal(getSceneCapability("objects", "lod").status, "stable");
});

test("path and morph declarative animations update the runtime", () => {
  const scene = new THREE.Scene();
  const mover = new THREE.Object3D();
  mover.userData.objJson = { animations: [{ type: "path", duration: 1000, path: { type: "line", points: [[0,0,0], [10,0,0]] } }] };
  scene.add(mover);
  const model = new THREE.Group();
  model.userData.objJson = { animations: [{ type: "morph", target: "Smile", from: 0, to: 1, duration: 1000 }] };
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  mesh.morphTargetDictionary = { Smile: 0 };
  mesh.morphTargetInfluences = [0];
  model.add(mesh); scene.add(model);
  updateSceneAnimations(scene, 0.5, { maxDeltaSeconds: 1 });
  assert.ok(Math.abs(mover.position.x - 5) < 1e-6);
  assert.ok(Math.abs(mesh.morphTargetInfluences[0] - 0.5) < 1e-6);
});

test("morph runtime can query and set a named target", () => {
  const root = new THREE.Group();
  root.userData.objJson = { threeJsonId: "character" };
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  mesh.name = "face";
  mesh.morphTargetDictionary = { Smile: 0, Blink: 1 };
  mesh.morphTargetInfluences = [0, 0];
  root.add(mesh);
  assert.equal(listMorphTargets(root)[0].targets[1].name, "Blink");
  const changed = setMorphTargetInfluence(root, "Smile", 0.75);
  assert.equal(changed.length, 1);
  assert.equal(mesh.morphTargetInfluences[0], 0.75);
  assert.equal(root.userData.objJson.morphInfluences.Smile, 0.75);
});

test("extra controls are detected only when requested", () => {
  assert.equal(sceneUsesExtraControls({ sceneConfig: { controls: { type: "arcball" } } }), true);
  assert.equal(sceneUsesExtraControls({ sceneConfig: { controls: { type: "orbit" } } }), false);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import { createJsonSceneSimple } from "../core/handler/sceneLoadHandler.js";
import { shouldSkipSceneExportNode } from "../core/util/sceneExportNode.js";
import { sceneToStandardJsonSimple } from "../core/util/sceneToJson.js";
import { prepareMeshExportRoot } from "../core/util/meshExportPrepare.js";
import {
  THREEBOX_PREVIEW_LIGHTS_NAME,
  syncThreeBoxPreviewAuxiliaryLights
} from "../tools/scene-host/threebox/js/threeBoxPreviewLights.js";

test("ThreeBox preview lights are host-only, idempotent, and removable", () => {
  const scene = new THREE.Scene();
  const authoredLight = new THREE.AmbientLight("#ffffff", 0.1);
  scene.add(authoredLight);

  const group = syncThreeBoxPreviewAuxiliaryLights(scene, true);
  assert.equal(group.name, THREEBOX_PREVIEW_LIGHTS_NAME);
  assert.equal(group.userData.__threeBoxPreviewOnly, true);
  assert.equal(group.children.some((child) => child.isAmbientLight), true);
  assert.equal(group.children.some((child) => child.isDirectionalLight), true);
  assert.equal(shouldSkipSceneExportNode(group), true);
  assert.equal(scene.children.filter((child) => child.name === THREEBOX_PREVIEW_LIGHTS_NAME).length, 1);

  syncThreeBoxPreviewAuxiliaryLights(scene, true);
  assert.equal(scene.children.filter((child) => child.name === THREEBOX_PREVIEW_LIGHTS_NAME).length, 1);
  syncThreeBoxPreviewAuxiliaryLights(scene, false);
  assert.equal(scene.children.some((child) => child.name === THREEBOX_PREVIEW_LIGHTS_NAME), false);
  assert.equal(scene.children.includes(authoredLight), true);
});

test("ThreeBox preview lights are excluded from third-party model export clones", () => {
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
  syncThreeBoxPreviewAuxiliaryLights(scene, true);

  const prepared = prepareMeshExportRoot(scene, { scope: "scene" });
  assert.equal(prepared.exportRoot.children.some((child) => child.name === THREEBOX_PREVIEW_LIGHTS_NAME), false);
  assert.equal(prepared.stats.meshCount, 1);
});

test("runtime-only export markers exclude a host helper even without an objJson light tag", () => {
  const helper = new THREE.Group();
  helper.userData.__threeJsonRuntimeOnly = true;
  assert.equal(shouldSkipSceneExportNode(helper), true);
});

test("ThreeBox preview lights never leak into saved sceneConfig", () => {
  const scene = new THREE.Scene();
  const authoredAmbient = new THREE.AmbientLight("#ffeecc", 0.35);
  const authoredDirectional = new THREE.DirectionalLight("#ffffff", 0.9);
  authoredDirectional.position.set(4, 8, 6);
  scene.add(authoredAmbient, authoredDirectional);
  syncThreeBoxPreviewAuxiliaryLights(scene, true);

  const saved = sceneToStandardJsonSimple(scene, {
    merge: false,
    runtimeTarget: { scene }
  });

  assert.equal(saved.sceneConfig.lights.length, 2);
  assert.deepEqual(saved.sceneConfig.lights.map((light) => light.type), ["ambient", "directional"]);
  assert.deepEqual(saved.sceneConfig.lights.map((light) => light.intensity), [0.35, 0.9]);

  // Reopening a conversation loads exactly this persisted snapshot. The authored lights must
  // survive that full save/load round trip while the host-only preview lights stay absent.
  const reloaded = createJsonSceneSimple(saved, {
    autoFillLights: false,
    autoFillCamera: false,
    autoFitCamera: false
  });
  const reloadedLights = [];
  reloaded.scene.traverse((object) => {
    if (object.isLight) reloadedLights.push(object);
  });
  assert.equal(reloadedLights.length, 2);
  assert.deepEqual(reloadedLights.map((light) => light.type), ["AmbientLight", "DirectionalLight"]);
  assert.deepEqual(reloadedLights.map((light) => light.intensity), [0.35, 0.9]);
  assert.equal(reloaded.scene.getObjectByName(THREEBOX_PREVIEW_LIGHTS_NAME), undefined);
  reloaded.dispose();
});

test("runtime snapshot preserves explicit empty lights instead of replacing author intent", () => {
  const scene = new THREE.Scene();
  const saved = sceneToStandardJsonSimple(scene, {
    merge: false,
    runtimeTarget: { scene },
    basePayload: { version: "next", sceneConfig: { lights: [] } }
  });

  assert.deepEqual(saved.sceneConfig.lights, []);
});

test("runtime snapshot preserves hemisphere light colors", () => {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight("#87ceeb", "#3f2b1d", 0.65));

  const saved = sceneToStandardJsonSimple(scene, {
    merge: false,
    runtimeTarget: { scene }
  });

  assert.equal(saved.sceneConfig.lights.length, 1);
  assert.deepEqual(saved.sceneConfig.lights[0], {
    type: "hemisphere",
    color: "#87ceeb",
    intensity: 0.65,
    position: { x: 0, y: 1, z: 0 },
    skyColor: "#87ceeb",
    groundColor: "#3f2b1d",
    jsonOrigin: "config"
  });
});

test("a visible ThreeBox runtime snapshot materializes omitted default lights and preserves materials", () => {
  const source = {
    version: "next",
    sceneConfig: { background: "#add8e6" },
    objectList: [{
      threeJsonId: "colored-ground",
      objType: "box",
      width: 5,
      height: 0.2,
      depth: 5,
      material: { type: "standard", color: "#44aa33", roughness: 0.8 }
    }]
  };
  const runtime = createJsonSceneSimple(source, {
    autoFillLights: true,
    autoFillCamera: true,
    autoFitCamera: false
  });
  syncThreeBoxPreviewAuxiliaryLights(runtime.scene, true);

  const saved = sceneToStandardJsonSimple(runtime.scene, {
    merge: false,
    runtimeTarget: runtime,
    basePayload: source
  });
  assert.equal(saved.sceneConfig.lights.length, 3);
  assert.equal(saved.objectList[0].material.color, "#44aa33");
  assert.equal(saved.objectList[0].material.roughness, 0.8);
  assert.equal(saved.sceneConfig.lights.some((light) => light.type === "threebox-preview-auxiliary"), false);

  const reloaded = createJsonSceneSimple(saved, {
    autoFillLights: false,
    autoFillCamera: false,
    autoFitCamera: false
  });
  assert.equal(reloaded.scene.children.some((child) => child.name === THREEBOX_PREVIEW_LIGHTS_NAME), false);
  assert.equal(reloaded.scene.children.filter((child) => child.isLight).length, 3);
  let mesh = null;
  reloaded.scene.traverse((object) => {
    if (object?.userData?.objJson?.threeJsonId === "colored-ground") mesh = object;
  });
  assert.ok(mesh?.isMesh);
  assert.equal(mesh.material.color.getHexString(), "44aa33");
  reloaded.dispose();
  runtime.dispose();
});

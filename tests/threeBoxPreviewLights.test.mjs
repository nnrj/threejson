import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import { shouldSkipSceneExportNode } from "../core/util/sceneExportNode.js";
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

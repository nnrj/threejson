import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { deployJsonScene } from "../core/runtime.js";
import { toShowerStandardScene } from "../tools/scene-host/shower/js/showerSceneFormat.js";
import {
  buildFriendlyScenePayloadFromCanonical,
  normalizeScenePayload
} from "../core/scenePayload.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(repoRoot, "assets", "json", "demo-show", "manifest.json");

function readManifest() {
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function localPathFromReference(reference) {
  return String(reference || "").split(/[?#]/, 1)[0];
}

test("website FPS examples preserve the html-demo scenes and collision/viewmodel bootstrap", () => {
  const examples = readManifest().flatMap((section) => section.items);
  for (const [id, fixture, bootstrap] of [
    ["fps-walk", "04-03-fps-walk", "fps-walk"],
    ["fps-player-rig", "04-04-fps-player-rig", "fps-walk"],
    ["fps-rapier-collision", "04-05-fps-rapier-collision", "fps-rapier"]
  ]) {
    const item = examples.find((example) => example.id === id);
    assert.ok(item, id);
    assert.equal(item.bootstrap, bootstrap);
    assert.equal(item.external, undefined, "FPS examples must run inside Shower");
    const scene = JSON.parse(fs.readFileSync(path.join(repoRoot, item.json), "utf8"));
    const tutorial = JSON.parse(fs.readFileSync(path.join(repoRoot, `assets/json/tutorial/track-04/${fixture}.json`), "utf8"));
    assert.deepEqual(scene, tutorial, "legacy website URL must not drift into a placeholder scene");
    assert.equal(scene.objectList.find((record) => record.objType === "controls").type, "firstPerson");
    assert.ok(scene.objectList.filter((record) => record.objType === "box").length >= 3);
    if (bootstrap === "fps-rapier") {
      assert.equal(scene.objectList.find((record) => record.objType === "controls").collision.provider, "rapier");
      const model = scene.objectList.find((record) => record.viewModelFit);
      assert.equal(model.attachTo, "camera");
      assert.match(model.remark, /CC-BY-4\.0/);
      assert.ok(fs.existsSync(path.join(repoRoot, model.modelPath)));
    }
  }
});

test("website and html-demo intros retain visible image/text slides through JSON normalization", () => {
  for (const reference of ["assets/json/demo-show/misc/intro-splash.json", "assets/json/tutorial/track-00/00-08-scene-intro.json"]) {
    const source = JSON.parse(fs.readFileSync(path.join(repoRoot, reference), "utf8"));
    // Opening a new example when the persisted format is "standard" takes this path.
    const standard = toShowerStandardScene(source);
    assert.deepEqual(standard.sceneConfig.intro, source.sceneConfig.intro);
    const normalized = normalizeScenePayload(standard);
    const friendly = buildFriendlyScenePayloadFromCanonical(standard, normalized.payload);
    const roundTrip = toShowerStandardScene(friendly);
    const intro = normalizeScenePayload(roundTrip).sceneConfig.intro;
    assert.equal(intro.enabled, true);
    assert.notEqual(intro.backgroundColor, "transparent");
    assert.equal(intro.postLoad.excludeFromLoadWait, false);
    assert.equal(intro.postLoad.blockInteraction, true);
    assert.equal(intro.postLoad.skipOnClick, true);
    assert.deepEqual(intro.postLoad.slides.map((slide) => slide.type), ["image", "text"]);
    assert.ok(intro.postLoad.slides.every((slide) => slide.durationMs >= 1800));
    const imagePath = intro.postLoad.slides[0].url;
    assert.ok(fs.existsSync(path.join(repoRoot, imagePath)), imagePath);
  }
});

test("website examples expose the complete Particle V2 fixture set", () => {
  const section = readManifest().find((entry) => entry.section === "particles");
  assert.ok(section, "particles section should exist");
  const ids = new Set(section.items.map((item) => item.id));
  for (const expected of [
    "particle-v2-sources",
    "particle-text-logo",
    "particle-fire-smoke",
    "particle-rain-snow",
    "particle-attractor",
    "particle-mesh-surface",
    "particle-webgl-compute"
  ]) {
    assert.ok(ids.has(expected), `missing website particle example: ${expected}`);
  }
  for (const item of section.items) {
    assert.ok(item.json, `${item.id} should expose its JSON descriptor`);
    const scenePath = path.join(repoRoot, localPathFromReference(item.json));
    assert.equal(fs.existsSync(scenePath), true, item.json);
    const scene = JSON.parse(fs.readFileSync(scenePath, "utf8"));
    const background = scene.sceneConfig?.scene?.background;
    assert.match(background, /^#[0-9a-f]{6}$/i, `${item.id} should declare a solid scene background`);
    const channels = background.slice(1).match(/../g).map((channel) => Number.parseInt(channel, 16));
    assert.ok(Math.max(...channels) <= 32, `${item.id} should keep a dark scene background`);
  }
});

test("website examples expose runnable TSL and WebGPU previews without WebGL thumbnail loading", () => {
  const section = readManifest().find((entry) => entry.section === "webgpu-tsl");
  assert.ok(section, "webgpu-tsl section should exist");
  assert.deepEqual(
    section.items.map((item) => item.id),
    ["tsl-materials", "tsl-burning-model", "webgpu-compute-particles"]
  );
  for (const item of section.items) {
    assert.equal(item.thumbnail, false, `${item.id} must not enter the default WebGL thumbnail runner`);
    assert.equal(item.badgeTone, "preview");
    assert.equal(fs.existsSync(path.join(repoRoot, localPathFromReference(item.json))), true, item.json);
    assert.equal(fs.existsSync(path.join(repoRoot, localPathFromReference(item.external))), true, item.external);
  }
});

test("website examples expose native complex-model coverage without external model substitution", () => {
  const section = readManifest().find((entry) => entry.section === "complex-modeling");
  assert.ok(section, "complex-modeling section should exist");
  const ids = new Set(section.items.map((item) => item.id));
  for (const expected of [
    "editable-lounge-chair",
    "loft-vehicle-shell",
    "lathe-mechanical-spindle",
    "sweep-bezier-plant",
    "editable-animal-form",
    "implicit-humanoid",
    "implicit-asymmetric-organic",
    "nurbs-freeform-product",
    "raw-buffer-morph"
  ]) {
    assert.ok(ids.has(expected), `missing website complex-model example: ${expected}`);
  }
  const complexTypes = new Set([
    "editableMesh", "bufferMesh", "parametricSurface", "bezierPatch", "nurbsSurface",
    "latheMesh", "loftMesh", "sweepMesh", "implicitSurface"
  ]);
  for (const item of section.items) {
    const scenePath = path.join(repoRoot, localPathFromReference(item.json));
    assert.equal(fs.existsSync(scenePath), true, item.json);
    const scene = JSON.parse(fs.readFileSync(scenePath, "utf8"));
    assert.ok(
      (scene.objectList || []).some((object) => complexTypes.has(object.objType)),
      `${item.id} should demonstrate a native complex-mesh descriptor`
    );
    assert.equal(
      (scene.objectList || []).some((object) => object.objType === "externalModel"),
      false,
      `${item.id} must not substitute an external asset for native expression`
    );
  }
});

test("Shower friendly JSON keeps editable complex-model examples as evaluated meshes", async () => {
  for (const fileName of ["editable-lounge-chair.json", "editable-animal-form.json"]) {
    const scenePath = path.join(repoRoot, "assets", "json", "demo-show", "complex-modeling", fileName);
    const source = JSON.parse(fs.readFileSync(scenePath, "utf8"));
    const normalized = normalizeScenePayload(source);
    const friendly = buildFriendlyScenePayloadFromCanonical(source, normalized.payload);
    assert.equal(friendly.worldInfo.editableMeshList[0].objType, undefined);

    const target = new THREE.Scene();
    await deployJsonScene(target, friendly);
    const mesh = target.getObjectByName(source.objectList[0].name);
    assert.equal(mesh?.isMesh, true, `${fileName} should deploy a mesh`);
    assert.equal(mesh.geometry.type, "BufferGeometry", `${fileName} must not fall back to BoxGeometry`);
    assert.ok(
      mesh.geometry.getAttribute("position").count > 24,
      `${fileName} should contain the evaluated subdivision geometry`
    );
    if (fileName === "editable-lounge-chair.json") {
      target.updateMatrixWorld(true);
      const hits = new THREE.Raycaster(
        new THREE.Vector3(0, 10, 0.8),
        new THREE.Vector3(0, -1, 0)
      ).intersectObject(mesh, false);
      assert.ok(hits.length > 0, "the lounge-chair seat must be visible from above with front-side culling");
    }
  }
});

test("website gallery distinguishes dedicated capability covers and skips external-only downloads", () => {
  const source = fs.readFileSync(path.join(repoRoot, "website", "js", "site.js"), "utf8");
  assert.match(source, /exampleCapabilityCover/);
  assert.match(source, /data-thumbnail-disabled/);
  assert.match(source, /if \(!item\?\.json\) continue/);
});

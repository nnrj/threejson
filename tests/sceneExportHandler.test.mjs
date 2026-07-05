import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import { exportJsonScene } from "../core/handler/sceneExportHandler.js";
import { packJsonSceneArchive } from "../core/handler/objectExportHandler.js";
import { parseTjzArchive } from "../core/archive/tjzParser.js";

function makeSceneWithOneBox() {
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  mesh.userData.objJson = {
    objType: "box",
    name: "scene-box",
    threeJsonId: "scene-box-1",
    geometry: { width: 1, height: 1, depth: 1 },
    position: { x: 0, y: 0, z: 0 },
    material: { type: "standard", color: "#ffffff" }
  };
  scene.add(mesh);
  return scene;
}

test("exportJsonScene supports standard/friendly formats", async () => {
  const scene = makeSceneWithOneBox();
  const standard = await exportJsonScene(scene, { format: "standard" });
  const friendly = await exportJsonScene(scene, { format: "friendly" });
  assert.ok(Array.isArray(standard.objectList));
  assert.ok(friendly.worldInfo);
});

test("exportJsonScene three-native returns wrapped payload", async () => {
  const scene = makeSceneWithOneBox();
  const payload = await exportJsonScene(scene, { format: "three-native" });
  const list = payload?.worldInfo?.domainModelList || [];
  assert.equal(Array.isArray(list), true);
  assert.equal(list[0]?.domain, "nativeThree");
  assert.equal(list[0]?.handler, "parseInline");
  assert.ok(list[0]?.json?.metadata);
});

test("packJsonSceneArchive three-native does not add assets folder", async () => {
  const scene = makeSceneWithOneBox();
  const bytes = await packJsonSceneArchive(scene, { format: "three-native" });
  const parsed = await parseTjzArchive(bytes);
  const fileKeys = Array.from(parsed.fileMap.keys());
  assert.equal(fileKeys.includes("scene.json"), true);
  assert.equal(fileKeys.some((path) => path.startsWith("assets/")), false);
});

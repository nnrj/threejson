import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { createJsonSceneSimple } from "../core/handler/sceneLoadHandler.js";
import { clearObjectRegistry } from "../core/handler/objectRegistry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tutorialPath = path.join(
  __dirname,
  "../assets/json/tutorial/track-01/01-01-group-line-panel.json"
);

function countMeshes(root) {
  let n = 0;
  root.traverse((obj) => {
    if (obj.isMesh) {
      n += 1;
    }
  });
  return n;
}

function findByName(root, name) {
  let found = null;
  root.traverse((obj) => {
    if (obj.name === name) {
      found = obj;
    }
  });
  return found;
}

test("tutorial group-line-panel loads group subScene children", () => {
  clearObjectRegistry();
  const payload = JSON.parse(fs.readFileSync(tutorialPath, "utf8"));
  const runtime = createJsonSceneSimple(payload);
  assert.ok(runtime?.scene);
  const demoGroup = findByName(runtime.scene, "demo-group");
  assert.ok(demoGroup, "demo-group should exist");
  assert.ok(demoGroup.children.length >= 2, "demo-group should have subScene children");
  assert.ok(findByName(runtime.scene, "group-box-a"));
  assert.ok(findByName(runtime.scene, "group-box-b"));
  assert.ok(countMeshes(runtime.scene) >= 2, "at least two group box meshes");
});

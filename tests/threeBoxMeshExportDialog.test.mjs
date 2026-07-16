import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { SUPPORTED_MESH_FORMATS } from "../core/handler/meshExportHandler.js";
import { THREEBOX_MESH_EXPORT_FORMATS } from "../tools/scene-host/threebox/js/threeBoxMeshExportDialog.js";

test("ThreeBox third-party model picker exposes the editor more-formats set", () => {
  const formats = THREEBOX_MESH_EXPORT_FORMATS.map((item) => item.value);
  assert.deepEqual(formats, ["glb", "gltf", "obj", "stl", "ply", "usdz"]);
  assert.equal(formats.every((format) => SUPPORTED_MESH_FORMATS.has(format)), true);
});

test("ThreeBox scene-card model export action is immediately after .tjz export", async () => {
  const source = await readFile(
    new URL("../tools/scene-host/threebox/js/threeBoxSceneCard.js", import.meta.url),
    "utf8"
  );
  const tjzAction = 'actionBtnHtml(t("threebox.sceneCard.exportTjz"';
  const meshAction = 'actionBtnHtml(t("threebox.sceneCard.exportMesh"';
  const tjzIndex = source.indexOf(tjzAction);
  const meshIndex = source.indexOf(meshAction);
  assert.ok(tjzIndex >= 0);
  assert.ok(meshIndex > tjzIndex);
  assert.doesNotMatch(source.slice(tjzIndex + tjzAction.length, meshIndex), /actionBtnHtml\(/);
  assert.match(source, /exportMesh\(runtime\.scene, \{/);
});

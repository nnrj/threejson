import test from "node:test";
import assert from "node:assert/strict";
import { getSceneCardDownloadActions } from "../tools/scene-host/shared/js/sceneCardDownloadMenu.js";
import { getSceneCardDownloadActions as packaged } from "../packages/host-kit/js/sceneCardDownloadMenu.js";

for (const getActions of [getSceneCardDownloadActions, packaged]) {
  test("download choices use the card document, without loading a runtime or media kit", () => {
    assert.deepEqual(getActions(null), []);
    assert.deepEqual(getActions({ version: "next", objectList: [] }), ["json", "tjz", "mesh"]);
    assert.deepEqual(getActions({ timeline: { tracks: [], duration: 0 } }), ["json", "tjz", "mesh"]);
    // Ordinary model animation is not itself a film. The media studio remains available.
    assert.deepEqual(getActions({ animations: [{ type: "rotate" }] }), ["json", "tjz", "mesh"]);
    for (const document of [
      { documentType: "composition", production: { state: "paused" } },
      { version: "next", timeline: { duration: 24, tracks: [] } },
      { version: "next", timeline: { tracks: [{ target: "actor", property: "position.x", keyframes: [{ time: 0, value: 0 }, { time: 2, value: 1 }] }] } }
    ]) {
      const before = structuredClone(document);
      assert.deepEqual(getActions(document), ["video", "tjz", "json"]);
      assert.deepEqual(document, before);
    }
  });
}

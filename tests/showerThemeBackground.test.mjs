import assert from "node:assert/strict";
import test from "node:test";

import {
  sceneJsonDeclaresBackground,
  shouldApplyThemeSceneBackground
} from "../tools/scene-host/shower/js/showerSceneBackground.js";

test("Shower recognizes authored backgrounds in friendly and canonical scene JSON", () => {
  assert.equal(sceneJsonDeclaresBackground({
    sceneConfig: { scene: { background: "#080d1b" } }
  }), true);
  assert.equal(sceneJsonDeclaresBackground({
    objectList: [{ objType: "scene", background: "#080d1b" }]
  }), true);
  assert.equal(sceneJsonDeclaresBackground({
    sceneConfig: { scene: { background: null } }
  }), true, "explicit null remains an authored background decision");
  assert.equal(sceneJsonDeclaresBackground({
    objectList: [{ objType: "sphere", material: { background: "#080d1b" } }]
  }), false);
});

test("Shower uses its theme only as a missing-background fallback", () => {
  assert.equal(shouldApplyThemeSceneBackground({
    sceneJson: {},
    runtimeBackground: null
  }), true);
  assert.equal(shouldApplyThemeSceneBackground({
    sceneJson: { sceneConfig: { scene: { background: "#080d1b" } } },
    runtimeBackground: null
  }), false);
  assert.equal(shouldApplyThemeSceneBackground({
    sceneJson: {},
    runtimeBackground: { isTexture: true }
  }), false, "runtime-created and native backdrops are preserved");
  assert.equal(shouldApplyThemeSceneBackground({
    sceneJson: {},
    runtimeBackground: { isColor: true },
    usingThemeFallback: true
  }), true, "a prior theme fallback follows later theme changes");
});

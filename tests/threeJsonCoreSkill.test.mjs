import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSceneGenerationSystemPrompt,
  buildSceneOutlineSystemPrompt,
  THREE_JSON_NATIVE_THREE,
  THREE_JSON_PRIMITIVE_GEOMETRY,
  THREE_JSON_LIST_PLACEMENT,
  THREE_JSON_FEW_SHOT_EXAMPLES
} from "../core/ai/threeJsonCoreSkill.js";
import {
  buildIntentHints,
  evaluateCapabilityFit,
  matchIntentSignals
} from "../core/ai/sceneCapability.js";

test("generation system prompt covers core ThreeJSON capabilities", () => {
  const prompt = buildSceneGenerationSystemPrompt();
  assert.match(prompt, /sphereModelList/);
  assert.match(prompt, /modelList/);
  assert.match(prompt, /lineList/);
  assert.match(prompt, /infoPanelList/);
  assert.match(prompt, /css3dPanelList/);
  assert.match(prompt, /shaderSurfaceList/);
  assert.match(prompt, /particleEmitter/);
  assert.match(prompt, /textureQuality/);
  assert.match(prompt, /TorusKnotGeometry/);
  assert.match(prompt, /sceneConfig/);
  assert.match(THREE_JSON_LIST_PLACEMENT, /nativeThree/);
  assert.match(THREE_JSON_PRIMITIVE_GEOMETRY, /radiusTop/);
  assert.match(THREE_JSON_NATIVE_THREE, /parseMode/);
  assert.match(THREE_JSON_FEW_SHOT_EXAMPLES, /demo-css3d-particles/);
});

test("outline system prompt includes capability catalog", () => {
  const prompt = buildSceneOutlineSystemPrompt();
  assert.match(prompt, /Do NOT output JSON/);
  assert.match(prompt, /particleList/);
});

test("buildIntentHints maps solar system prompt to sphere capability", () => {
  const hints = buildIntentHints("build a small solar system with planets");
  assert.match(hints, /sphereModelList|sphere/i);
});

test("evaluateCapabilityFit accepts blockout box prompts", () => {
  const scene = {
    worldInfo: {
      boxModelList: [
        {
          objType: "box",
          geometry: { width: 1, height: 1, depth: 1 },
          position: { x: 0, y: 0, z: 0 },
          material: { color: "#888888" }
        }
      ]
    }
  };
  const fit = evaluateCapabilityFit("abstract blockout with boxes only", scene);
  assert.equal(fit.ok, true);
  assert.equal(fit.blockoutOk, true);
});

test("evaluateCapabilityFit flags missing sphere for planet prompt", () => {
  const scene = {
    worldInfo: {
      boxModelList: [
        {
          objType: "box",
          geometry: { width: 10, height: 10, depth: 10 },
          position: { x: 0, y: 5, z: 0 },
          material: { color: "#409eff" }
        }
      ]
    }
  };
  const fit = evaluateCapabilityFit("a blue planet in space", scene);
  assert.equal(fit.ok, false);
  assert.ok(fit.gaps.length >= 1);
});

test("matchIntentSignals finds native geometry intent", () => {
  const signals = matchIntentSignals("add a torus knot sculpture");
  assert.ok(signals.some((s) => s.id === "native"));
});

test("buildIntentHints maps css3d panel prompt", () => {
  const hints = buildIntentHints("add a clickable control panel with a start button");
  assert.match(hints, /css3dPanel/i);
});

test("buildIntentHints maps particleEmitter prompt", () => {
  const hints = buildIntentHints("add starfield particle dust");
  assert.match(hints, /particleEmitter/i);
});

test("evaluateCapabilityFit accepts particleEmitter for particle prompt", () => {
  const scene = {
    worldInfo: { boxModelList: [] },
    objectList: [
      {
        objType: "particleEmitter",
        simulation: "cpu",
        material: { color: "#ffffff", size: 2 },
        position: { x: 0, y: 10, z: 0 }
      }
    ]
  };
  const fit = evaluateCapabilityFit("add floating particle dust", scene);
  assert.equal(fit.ok, true);
});

test("evaluateCapabilityFit flags missing css3dPanel for interactive UI prompt", () => {
  const scene = {
    worldInfo: {
      infoPanelList: [
        {
          objType: "infoPanel",
          type: "text",
          text: "Start",
          panelBoxType: "box"
        }
      ]
    }
  };
  const fit = evaluateCapabilityFit("add a clickable form panel with inputs", scene);
  assert.equal(fit.ok, false);
  assert.ok(fit.gaps.some((g) => /css3dPanel/i.test(g)));
});

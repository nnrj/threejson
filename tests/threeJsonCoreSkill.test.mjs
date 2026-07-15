import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSceneGenerationSystemPrompt,
  buildSceneOutlineSystemPrompt,
  THREE_JSON_NATIVE_THREE,
  THREE_JSON_PRIMITIVE_GEOMETRY,
  THREE_JSON_LIST_PLACEMENT,
  THREE_JSON_DOMAIN_USAGE,
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
  assert.match(prompt, /device\.cabinet/);
  assert.match(prompt, /createStatBars/);
  assert.match(prompt, /Do NOT put plain objType "box" records in domainModelList/);
  assert.match(prompt, /most appropriate\/specific feature/);
  assert.match(prompt, /most fitting capability/);
  assert.match(prompt, /not a checklist/);
  assert.match(prompt, /Never add decorative lineList, particleEmitter/);
  assert.match(prompt, /Particle emitters are opt-in effects/);
  assert.match(prompt, /ambient 0\.45-0\.65 plus directional 0\.9-1\.2/);
  assert.match(prompt, /point\/spot lights/);
  assert.match(prompt, /grounded physical scenes should usually include/);
  assert.match(prompt, /Never output empty placeholder arrays/);
  assert.match(prompt, /include only the non-empty worldInfo lists actually used/);
  assert.match(prompt, /Implied support surface/);
  assert.match(prompt, /renderLoop\.updateAnimations/);
  assert.match(prompt, /motion perceptible/);
  assert.match(prompt, /distribution \{type:"sphere"\|"shell"\|"halo"/);
  assert.match(prompt, /self-evidently incomplete as a flat color/);
  assert.match(prompt, /reachable online image URL/);
  assert.match(prompt, /not limited to CDNs/);
  assert.match(prompt, /textureRepeat/);
  assert.match(prompt, /Do not force a textureUrl onto generic\/abstract shapes/);
  assert.match(prompt, /sceneConfig/);
  assert.match(THREE_JSON_LIST_PLACEMENT, /nativeThree/);
  assert.match(THREE_JSON_PRIMITIVE_GEOMETRY, /radiusTop/);
  assert.match(THREE_JSON_NATIVE_THREE, /parseMode/);
  assert.match(THREE_JSON_DOMAIN_USAGE, /dockCrane/);
  assert.match(THREE_JSON_FEW_SHOT_EXAMPLES, /demo-css3d-panel/);
  assert.doesNotMatch(THREE_JSON_FEW_SHOT_EXAMPLES, /particleEmitter/);
  assert.doesNotMatch(THREE_JSON_FEW_SHOT_EXAMPLES, /boxModelList"\s*:\s*\[\]/);
  assert.match(THREE_JSON_FEW_SHOT_EXAMPLES, /"type":"directional"/);
});

test("outline system prompt includes capability catalog", () => {
  const prompt = buildSceneOutlineSystemPrompt();
  assert.match(prompt, /Do NOT output JSON/);
  assert.match(prompt, /particleList/);
  assert.match(prompt, /plan only the capabilities needed/);
  assert.match(prompt, /Why any non-basic capability is necessary/);
});

test("generation prompt hides particle capabilities when particle intent is absent", () => {
  const prompt = buildSceneGenerationSystemPrompt({ particleEffects: false });
  assert.equal((prompt.match(/particleEmitter/g) || []).length, 1);
  assert.equal((prompt.match(/particleList/g) || []).length, 1);
  assert.doesNotMatch(prompt, /ParticleEmitterItem|"particleList"\s*:\s*\[/);
  assert.match(prompt, /particle effects are forbidden/i);

  const enabled = buildSceneGenerationSystemPrompt({ particleEffects: true });
  assert.match(enabled, /particleEmitter/);
});

test("online texture hints can be disabled in scene prompts", () => {
  const enabled = buildSceneGenerationSystemPrompt();
  assert.match(enabled, /Online resources are not limited to CDNs/);
  assert.match(enabled, /any suitable public web image URL/);

  const disabled = buildSceneGenerationSystemPrompt({ onlineTextureHints: false });
  assert.match(disabled, /host disabled proactive online texture hints/);
  assert.match(disabled, /Do not add new material\.textureUrl fields/);
  assert.doesNotMatch(disabled, /self-evidently incomplete as a flat color/);
  assert.doesNotMatch(disabled, /any suitable public web image URL/);
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

test("matchIntentSignals finds lighting and declarative animation intents", () => {
  const signals = matchIntentSignals("make the scene brighter with a point light and rotate the sun");
  assert.ok(signals.some((s) => s.id === "lighting"));
  assert.ok(signals.some((s) => s.id === "declarativeAnimation"));
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

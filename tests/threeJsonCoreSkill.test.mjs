import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSceneGenerationSystemPrompt,
  buildSceneOutlineSystemPrompt,
  THREE_JSON_NATIVE_THREE,
  THREE_JSON_PRIMITIVE_GEOMETRY,
  THREE_JSON_LIST_PLACEMENT,
  THREE_JSON_DOMAIN_USAGE,
  THREE_JSON_FEW_SHOT_EXAMPLES,
  THREE_JSON_STANDARD_FEW_SHOT_EXAMPLES
} from "../core/ai/threeJsonCoreSkill.js";
import {
  buildIntentHints,
  evaluateCapabilityFit,
  matchIntentSignals
} from "../core/ai/sceneCapability.js";
import {
  THREE_JSON_DOMAIN_CAPABILITY_INDEX
} from "../core/ai/sceneDomainCapability.js";

test("generation system prompt covers core ThreeJSON capabilities", () => {
  const prompt = buildSceneGenerationSystemPrompt();
  assert.match(prompt, /standard scheme-B JSON only/);
  assert.match(prompt, /heterogeneous objectList/);
  assert.match(prompt, /explicit objType/);
  assert.match(prompt, /objType":"sphere"/);
  assert.match(prompt, /objType":"infoPanel"/);
  assert.match(prompt, /objType":"css3dPanel"/);
  assert.match(prompt, /shaderSurface/);
  assert.match(prompt, /particleEmitter/);
  assert.match(prompt, /textureQuality/);
  assert.match(prompt, /TorusKnotGeometry/);
  assert.match(prompt, /device\.cabinet/);
  assert.match(prompt, /createStatBars/);
  assert.match(prompt, /most appropriate\/specific feature/);
  assert.match(prompt, /not a checklist/);
  assert.match(prompt, /Never add decorative lineList, particleEmitter/);
  assert.match(prompt, /Particle emitters are opt-in effects/);
  assert.match(prompt, /ambient 0\.45-0\.65 plus directional 0\.9-1\.2/);
  assert.match(prompt, /point\/spot lights/);
  assert.match(prompt, /grounded physical scenes should usually include/);
  assert.match(prompt, /Never output empty placeholder arrays/);
  assert.match(prompt, /single standard objectList/);
  assert.match(prompt, /renderLoop\.updateAnimations/);
  assert.match(prompt, /motion perceptible/);
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
  assert.match(THREE_JSON_STANDARD_FEW_SHOT_EXAMPLES, /"objectList"/);
  assert.doesNotMatch(THREE_JSON_STANDARD_FEW_SHOT_EXAMPLES, /"worldInfo"/);
});

test("outline system prompt includes capability catalog", () => {
  const prompt = buildSceneOutlineSystemPrompt();
  assert.match(prompt, /Do NOT output JSON/);
  assert.match(prompt, /standard objectList objTypes/);
  assert.match(prompt, /plan only the capabilities needed/);
  assert.match(prompt, /Why any non-basic capability is necessary/);
});

test("scene text guidance prefers visible SDF TextItem records", () => {
  const basePrompt = buildSceneGenerationSystemPrompt();
  assert.match(basePrompt, /name.*label.*metadata.*do not render visible glyphs/i);
  assert.match(basePrompt, /Default to mode:\"sdf\"/);
  assert.match(basePrompt, /\"objType\":\"text\"/);

  const selectedPrompt = buildSceneGenerationSystemPrompt({
    selectedCapabilityIds: ["sceneText"]
  });
  assert.match(selectedPrompt, /Negotiated ThreeJSON scene-text capability/);
  assert.match(selectedPrompt, /Preferred default is mode:\"sdf\"/);
  assert.match(selectedPrompt, /infoPanel only when the user wants a board\/card\/screen\/background/);

  const outline = buildSceneOutlineSystemPrompt({ selectedCapabilityIds: ["sceneText"] });
  assert.match(outline, /Negotiated ThreeJSON scene-text capability/);
});

test("negotiated device domain injects correct machine-room scale and layout guidance", () => {
  const basePrompt = buildSceneGenerationSystemPrompt();
  assert.doesNotMatch(basePrompt, /Negotiated device-domain capability/);
  assert.doesNotMatch(basePrompt, /"domain":"device\.cabinet"[^\n]+"payload"/);
  assert.match(basePrompt, /coherent spatial scale/);

  for (const selectedCapabilityIds of [["deviceDomain"], ["deviceCabinetDomain"]]) {
    const prompt = buildSceneGenerationSystemPrompt({ selectedCapabilityIds });
    assert.match(prompt, /Negotiated device-domain capability/);
    assert.match(prompt, /width 6, length 12, height 20/);
    assert.match(prompt, /distinct x\/z center/);
    assert.match(prompt, /mental collision pass/);
    assert.match(prompt, /"handler":"deployCabinet"/);
    assert.doesNotMatch(prompt, /"handler":"deployCabinet"[^\n]+"payload"/);
  }
});

test("domain negotiation index exposes specific domain and subdomain capability ids", () => {
  assert.match(THREE_JSON_DOMAIN_CAPABILITY_INDEX, /deviceCabinetDomain \(runtime domain device\.cabinet\)/);
  assert.match(THREE_JSON_DOMAIN_CAPABILITY_INDEX, /deviceAirConditionerDomain \(device\.airConditioner\)/);
  assert.match(THREE_JSON_DOMAIN_CAPABILITY_INDEX, /statPieDomain/);
  assert.match(THREE_JSON_DOMAIN_CAPABILITY_INDEX, /natureWaterDomain/);
  assert.match(THREE_JSON_DOMAIN_CAPABILITY_INDEX, /most specific id/);
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

test("matchIntentSignals recognizes Chinese machine-room domain intent", () => {
  const signals = matchIntentSignals("生成一个有多排机柜和精密空调的数据中心机房");
  assert.ok(signals.some((signal) => signal.id === "deviceDomain"));
});

test("device-domain capability review catches overlapping cabinets and undersized floors", () => {
  const scene = {
    objectList: [
      {
        threeJsonId: "floor-1",
        objType: "floor",
        geometry: { width: 10, height: 0.5, depth: 10 },
        position: { x: 0, y: -0.25, z: 0 }
      },
      {
        threeJsonId: "rack-1",
        objType: "domain",
        domain: "device.cabinet",
        geometry: { width: 6, length: 12, height: 20 },
        position: { x: 0, y: 0, z: 0 }
      },
      {
        threeJsonId: "rack-2",
        objType: "domain",
        domain: "device.cabinet",
        payload: {
          geometry: { width: 6, length: 12, height: 20 },
          position: { x: 0, y: 0, z: 0 }
        }
      }
    ]
  };
  const fit = evaluateCapabilityFit("生成一个有两排机柜的数据中心机房", scene);
  assert.equal(fit.ok, false);
  assert.ok(fit.gaps.some((gap) => /non-overlapping|intersect/i.test(gap)));
  assert.ok(fit.gaps.some((gap) => /floor.*contain|cabinet-grid bounds/i.test(gap)));
});

test("device-domain capability review accepts a contained non-overlapping rack grid", () => {
  const scene = {
    objectList: [
      {
        threeJsonId: "floor-1",
        objType: "floor",
        geometry: { width: 50, height: 0.5, depth: 44 },
        position: { x: 0, y: -0.25, z: 0 }
      },
      ...[-6, 0, 6].map((x, index) => ({
        threeJsonId: `rack-${index + 1}`,
        objType: "domain",
        domain: "device.cabinet",
        geometry: { width: 6, length: 12, height: 20 },
        position: { x, y: 0, z: -10 }
      }))
    ]
  };
  const fit = evaluateCapabilityFit("生成一个有一排机柜的数据中心机房", scene);
  assert.equal(fit.ok, true);
  assert.deepEqual(fit.gaps, []);
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

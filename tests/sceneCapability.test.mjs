import assert from "node:assert/strict";
import { test } from "node:test";
import {
  matchIntentSignals,
  evaluateCapabilityFit,
  mergeRequiredCapabilityIds,
  shouldAllowParticleEffects
} from "../core/ai/sceneCapability.js";

test("particles signal does not false-positive on generic 'points' phrasing", () => {
  const prompts = [
    "add way points along the path connecting building A to building B",
    "place reference points to mark the corners of the room",
    "plot the waypoints as small markers",
    "control points for the spline"
  ];
  for (const prompt of prompts) {
    const ids = matchIntentSignals(prompt).map((s) => s.id);
    assert.ok(!ids.includes("particles"), `expected no particles match for: ${prompt}`);
  }
});

test("particles signal still matches genuine particle/point-cloud/dust/spark requests", () => {
  const prompts = [
    "add a particle system with glowing embers",
    "add a starfield background",
    "create a point cloud scan of the terrain",
    "scatter dust in the air",
    "add sparks flying off the anvil",
    "场景里加一些粒子效果",
    "渲染点云数据"
  ];
  for (const prompt of prompts) {
    const ids = matchIntentSignals(prompt).map((s) => s.id);
    assert.ok(ids.includes("particles"), `expected particles match for: ${prompt}`);
  }
});

test("particle effects use a positive intent allow-list and honor explicit negatives", () => {
  for (const prompt of [
    "a modern office lobby",
    "a quiet space station control room",
    "an atmospheric night street",
    "sunny weather over a small campus",
    "a magical-looking blue building without particle effects",
    "创建一个夜晚庭院，不要粒子效果"
  ]) {
    assert.equal(shouldAllowParticleEffects(prompt), false, prompt);
  }
  for (const prompt of [
    "snow falling over a village",
    "smoke and embers above a volcano",
    "fireflies in a forest",
    "a magic dust particle effect",
    "夜空中有流星雨",
    "铁匠铺飞出火花"
  ]) {
    assert.equal(shouldAllowParticleEffects(prompt), true, prompt);
  }
});

test("evaluateCapabilityFit does not force a particleEmitter gap for a plain waypoint scene", () => {
  const prompt = "draw a path with several way points connecting two rooms";
  const sceneObj = {
    worldInfo: {
      lineList: [{ name: "path", objType: "line", points: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }] }]
    }
  };
  const fit = evaluateCapabilityFit(prompt, sceneObj);
  assert.ok(fit.ok, `expected no capability gaps, got: ${JSON.stringify(fit.gaps)}`);
  assert.ok(!fit.matchedSignals.includes("particles"));
});

test("ordinary requests to add visible words select sceneText and require a TextItem", () => {
  const prompt = "在小木屋门口添加文字‘森林之家’";
  const ids = matchIntentSignals(prompt).map((signal) => signal.id);
  assert.ok(ids.includes("sceneText"));

  const metadataOnly = evaluateCapabilityFit(prompt, {
    objectList: [{ threeJsonId: "cabin", objType: "box", label: "森林之家" }]
  });
  assert.equal(metadataOnly.ok, false);
  assert.match(metadataOnly.gaps.join("\n"), /objType text/i);

  const withSdfText = evaluateCapabilityFit(prompt, {
    objectList: [
      {
        threeJsonId: "cabin-title",
        objType: "text",
        content: "森林之家",
        mode: "sdf"
      }
    ]
  });
  assert.equal(withSdfText.ok, true);
});

test("explicit particle-raster and TSL requests survive an incomplete model capability selection", () => {
  assert.deepEqual(
    mergeRequiredCapabilityIds("用粒子组成 ThreeJSON 文字", []),
    ["particles", "particleRaster"]
  );
  assert.deepEqual(
    mergeRequiredCapabilityIds("Use a TSL node material", ["external"]),
    ["external", "webgpuTsl"]
  );
  assert.deepEqual(
    mergeRequiredCapabilityIds("Use inline TSL code for the custom material", []),
    ["webgpuTsl", "tslCode"]
  );
});

test("capability fit understands Particle V2 raster sources and WebGPU TSL materials", () => {
  const particleFit = evaluateCapabilityFit("用粒子组成 Logo 图案", {
    objectList: [{
      objType: "particleEmitter",
      source: { type: "imageMask", url: "/logo.png" },
      emission: { mode: "static", count: 2000 },
      particle: { lifetime: 0 },
      simulation: { backend: "cpu" },
      render: { type: "points" }
    }]
  });
  assert.equal(particleFit.ok, true);

  const tslFit = evaluateCapabilityFit("Use a TSL node material", {
    objectList: [{
      objType: "renderer",
      backend: "webgpu"
    }, {
      objType: "sphere",
      material: { type: "tsl", tsl: { kind: "preset", preset: "pulse" } }
    }]
  });
  assert.equal(tslFit.ok, true);

  const tslCodeFit = evaluateCapabilityFit("Use inline TSL code for the custom material", {
    sceneConfig: { renderer: { backend: "webgpu" } },
    objectList: [{
      objType: "sphere",
      material: {
        type: "tsl",
        tsl: { kind: "code", source: { inline: "export default () => undefined" } }
      }
    }]
  });
  assert.equal(tslCodeFit.ok, true);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { matchIntentSignals, evaluateCapabilityFit } from "../core/ai/sceneCapability.js";

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

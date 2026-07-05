import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildAnimationParameterDefaults,
  evaluateAnimationWhen,
  pickAnimationTransition,
  resolveAnimationGraph,
  transitionMatchesFrom
} from "../core/handler/animationGraphUtil.js";

const SAMPLE_GRAPH = {
  defaultState: "idle",
  parameters: {
    speed: { type: "float", default: 0 },
    attack: { type: "bool", default: false },
    pulse: { type: "bool", default: false }
  },
  states: {
    idle: { clips: [{ name: "Idle", loop: true }], speed: 1 },
    walk: { clips: [{ name: "Walk", loop: true }], speed: 1 },
    run: { clips: [{ name: "Run", loop: true }], speed: 1.2 },
    attack: { clips: [{ name: "Attack", loop: false }], speed: 1 },
    pulse: { clips: [{ name: "bobY", loop: false }], speed: 1.5 }
  },
  transitions: [
    { from: "idle", to: "walk", when: { param: "speed", gt: 0.1 }, crossFade: 0.2 },
    { from: "walk", to: "run", when: { param: "speed", gt: 3 }, crossFade: 0.15 },
    { from: "*", to: "attack", when: { param: "attack", eq: true }, crossFade: 0.05 },
    { from: "attack", to: "idle", when: { event: "clipFinished" }, crossFade: 0.2 },
    { from: "*", to: "pulse", when: { param: "pulse", eq: true }, crossFade: 0.1 },
    { from: "pulse", to: "idle", when: { event: "clipFinished" }, crossFade: 0.2 }
  ]
};

test("resolveAnimationGraph requires defaultState in states", () => {
  assert.equal(resolveAnimationGraph(null), null);
  assert.equal(resolveAnimationGraph({ animationGraph: { states: {} } }), null);
  const graph = resolveAnimationGraph({ animationGraph: SAMPLE_GRAPH });
  assert.equal(graph?.defaultState, "idle");
});

test("buildAnimationParameterDefaults reads bool and float", () => {
  assert.deepEqual(buildAnimationParameterDefaults(SAMPLE_GRAPH), {
    speed: 0,
    attack: false,
    pulse: false
  });
});

test("transitionMatchesFrom supports wildcard", () => {
  assert.equal(transitionMatchesFrom("walk", "*"), true);
  assert.equal(transitionMatchesFrom("walk", "idle"), false);
  assert.equal(transitionMatchesFrom("walk", "walk"), true);
});

test("evaluateAnimationWhen handles param comparisons and events", () => {
  const params = { speed: 2.5, attack: true };
  const events = new Set(["clipFinished"]);
  assert.equal(evaluateAnimationWhen({ param: "speed", gt: 0.1 }, params, events), true);
  assert.equal(evaluateAnimationWhen({ param: "speed", gt: 3 }, params, events), false);
  assert.equal(evaluateAnimationWhen({ param: "attack", eq: true }, params, events), true);
  assert.equal(evaluateAnimationWhen({ event: "clipFinished" }, params, events), true);
});

test("pickAnimationTransition respects order and wildcard", () => {
  const params = { speed: 0, attack: true, pulse: false };
  const picked = pickAnimationTransition("idle", SAMPLE_GRAPH, params, new Set());
  assert.deepEqual(picked, { to: "attack", crossFade: 0.05 });

  const walkPick = pickAnimationTransition(
    "idle",
    SAMPLE_GRAPH,
    { speed: 1, attack: false, pulse: false },
    new Set()
  );
  assert.deepEqual(walkPick, { to: "walk", crossFade: 0.2 });

  const finished = pickAnimationTransition("attack", SAMPLE_GRAPH, params, new Set(["clipFinished"]));
  assert.deepEqual(finished, { to: "idle", crossFade: 0.2 });
});

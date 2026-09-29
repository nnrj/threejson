import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSceneGenerationSystemPrompt, buildSceneOutlineSystemPrompt, buildSceneImageGenerationSystemPrompt,
  buildSceneUpdateSystemPrompt, buildSceneIncrementalUpdateSystemPrompt, buildSceneReviewSystemPrompt,
  THREE_JSON_STANDARD_FEW_SHOT_EXAMPLES, THREE_JSON_FEW_SHOT_EXAMPLES
} from "../core/ai/threeJsonCoreSkill.js";
import { buildAgentCapabilityIndex } from "../core/ai/sceneCapabilityIndex.js";
import { buildSceneCommandAutoUpdateSystemPrompt, buildSceneCommandUpdateSystemPrompt } from "../core/ai/sceneCommandSkill.js";
import { matchIntentSignals, buildIntentHints, buildCommandIntentHints, evaluateCapabilityFit } from "../core/ai/sceneCapability.js";
import { runSceneAgent } from "../core/ai/sceneAgent.js";

test("planning, generation, images, video, edits and review share optional support-surface guidance", () => {
  for (const build of [buildSceneGenerationSystemPrompt, buildSceneOutlineSystemPrompt, buildSceneImageGenerationSystemPrompt,
    buildSceneUpdateSystemPrompt, buildSceneIncrementalUpdateSystemPrompt, buildSceneReviewSystemPrompt,
    buildSceneCommandAutoUpdateSystemPrompt, buildSceneCommandUpdateSystemPrompt, buildAgentCapabilityIndex]) {
    for (const options of [{}, { selectedCapabilityIds: ["timeline"] }, { particleEffects: false }, { selectedCapabilityIds: ["deviceCabinetDomain"] }]) {
      const prompt = build(options);
      assert.match(prompt, /Absence of a support surface is not by itself a scene defect/, build.name);
      assert.match(prompt, /Default to no extra support surface for isolated objects\/product renders/);
      assert.match(prompt, /scientific explainers\/diagrams/);
      assert.match(prompt, /videos without a depicted ground-based environment/);
      assert.match(prompt, /a room interior's floor, a street's road/);
      assert.match(prompt, /Preserve structural parts of the subject/);
      assert.match(prompt, /never re-add a surface the user removed/);
      assert.doesNotMatch(prompt, /grounded physical scenes should usually include|include an appropriate floor\/ground\/base plane even when|Do include an unobtrusive support surface|normally need a floor\/ground\/base/);
    }
  }
  assert.match(buildAgentCapabilityIndex({ promptPurpose: "negotiation" }), /Support-surface composition policy/);
});

test("default syntax examples do not teach an extra floor for every object", () => {
  for (const text of [THREE_JSON_STANDARD_FEW_SHOT_EXAMPLES, THREE_JSON_FEW_SHOT_EXAMPLES]) {
    const examples = text.split("\n").map(line => line.trim()).filter(line => line.startsWith("{")).map(line => JSON.parse(line));
    assert.ok(examples.length >= 4);
    for (const example of examples) {
      const records = example.objectList || Object.values(example.worldInfo).flat();
      const floors = records.filter(record => record.objType === "floor" || record.name === "floor");
      if (["demo-campus", "demo-room"].includes(example.threeJsonId)) assert.ok(floors.length > 0, "authored environments retain real floors");
      else assert.equal(floors.length, 0, example.threeJsonId);
    }
  }
});

test("background, floor lamps, ground states and explicit removal do not request a floor", () => {
  for (const prompt of [
    "generate a video explaining double-slit interference with a dark background",
    "render a vase on a transparent background", "a foreground object with a blue background",
    "an isolated floor lamp", "a video explaining the atomic ground state",
    "no floor", "without a floor or ground plane", "do not add an extra floor", "remove the floor",
    "the floor is not needed", "remove the floor and change the background to black",
    "生成一个花瓶，不要地板", "生成视频，无需地面", "不要添加额外的地板", "去掉地板，保留花瓶底座",
    "地板不需要，展示模型本身", "移除地板和地面"
  ]) {
    assert.ok(!matchIntentSignals(prompt).some(signal => signal.id === "floor"), prompt);
    assert.doesNotMatch(buildIntentHints(prompt), /For a requested floor\/ground surface/, prompt);
    assert.doesNotMatch(buildCommandIntentHints(prompt), /For a requested floor\/ground surface/, prompt);
  }
});

test("positive surface requests remain discoverable, even beside a different negative clause", () => {
  for (const prompt of ["add a floor", "a room with a wood floor", "add a ground plane", "生成房间及地板", "铺上地面", "移除底座，添加地板", "no pedestal, add a ground plane"]) {
    assert.ok(matchIntentSignals(prompt).some(signal => signal.id === "floor"), prompt);
    assert.match(buildIntentHints(prompt), /objectList objType floor/);
  }
});

const rack = (id, x) => ({ threeJsonId: id, objType: "domain", domain: "device.cabinet", handler: "deployCabinet", geometry: { width: 6, length: 12, height: 20 }, position: { x, y: 0, z: 0 } });

test("device review does not turn missing floors into errors or bypass overlap checks", () => {
  const scene = { objectList: [rack("rack-a", -6), rack("rack-b", 6)] };
  const fit = evaluateCapabilityFit("展示两台机柜，不要地板", scene);
  assert.equal(fit.ok, true); assert.deepEqual(fit.gaps, []);
  scene.objectList[1].position.x = -6;
  const overlap = evaluateCapabilityFit("展示两台机柜", scene);
  assert.equal(overlap.ok, false); assert.match(overlap.gaps.join("\n"), /non-overlapping/);
  assert.doesNotMatch(overlap.gaps.join("\n"), /floor/);
});

test("floorless model/video generations finish without a corrective floor request", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const prompt of ["render a server rack on a dark background", "展示一台机柜，不要地板", "generate a video of a server rack with a dark background"]) {
      const scene = { version: "next", threeJsonId: "isolated-rack",
        sceneConfig: { scene: { background: "#101820" }, lights: [{ type: "ambient", intensity: .5 }, { type: "directional", intensity: 1, position: { x: 10, y: 24, z: 16 } }] },
        objectList: [rack("rack-a", 0)], ...(prompt.includes("video") ? { timeline: { duration: 4 } } : {}) };
      const requests = [];
      globalThis.fetch = async (_url, options) => {
        requests.push(JSON.parse(options.body));
        assert.equal(requests.length, 1, "a valid floorless response must not trigger repair requests");
        return { ok: true, async text() { return ""; }, async json() { return { choices: [{ message: { content: JSON.stringify(scene) } }] }; } };
      };
      const result = await runSceneAgent({ mode: "generate", prompt }, { apiKey: "test-only", provider: "deepseek" });
      assert.equal(result.completed, true, JSON.stringify(result.steps));
      assert.equal(requests.length, 1, JSON.stringify({ prompt, steps: result.steps, prompts: requests.map(r => r.messages.at(-1).content) }));
      assert.match(requests[0].messages[0].content, /Support-surface composition policy/);
      assert.doesNotMatch(requests[0].messages.map(m => m.content).join("\n"), /current floor is missing/);
      const generated = JSON.parse(result.sceneJsonString);
      assert.deepEqual(generated.objectList.map(record => record.threeJsonId), ["rack-a"]);
      assert.equal(generated.timeline?.duration, scene.timeline?.duration);
    }
  } finally { globalThis.fetch = originalFetch; }
});

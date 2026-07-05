import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSceneCommandSkillFragment,
  buildSceneCommandAutoUpdateSystemPrompt,
  buildSceneCommandUpdateSystemPrompt,
  buildSceneCommandUpdateUserMessage,
  batchResultsHaveSceneMutation,
  batchResultsHaveSuccessfulAdjustment,
  commandListHasMutatingOp,
  commandScriptIndicatesDone,
  detectAssemblyParentWarnings,
  extractCommandScriptText,
  isLikelyCommandScriptText,
  resolveOutputKind
} from "../core/ai/sceneCommandSkill.js";
import { buildCommandIntentHints } from "../core/ai/sceneCapability.js";
import { clearObjectRegistry, getObjectByThreeJsonId } from "../core/handler/objectRegistry.js";
import { addObjectFromDescriptor } from "../core/runtime/sceneObjectCommands.js";
import * as THREE from "three";
import { parseCommandScript } from "../core/command/index.js";

test("buildSceneCommandSkillFragment includes object.patch and excludes editor.*", () => {
  const fragment = buildSceneCommandSkillFragment();
  assert.ok(fragment.includes("object.patch"));
  assert.ok(fragment.includes("object.reconcile"));
  assert.ok(fragment.includes("camera.fit"));
  assert.ok(fragment.includes("material.patch"));
  assert.ok(fragment.includes("scene.list"));
  assert.equal(fragment.includes("editor.exec"), false);
  assert.equal(fragment.includes("editor.ingest"), false);
});

test("buildSceneCommandUpdateSystemPrompt teaches single-round mutating commands only", () => {
  const prompt = buildSceneCommandUpdateSystemPrompt();
  assert.ok(prompt.includes("object.patch"));
  assert.ok(prompt.includes("object.reconcile"));
  assert.ok(prompt.includes("scene.export"));
  assert.ok(prompt.includes("Do NOT output editor.*"));
  assert.ok(prompt.includes("Micro DSL"));
  assert.ok(prompt.includes("SINGLE-ROUND"));
  assert.ok(prompt.includes("Do NOT output object.get"));
  assert.ok(prompt.includes("User intent priority"));
  assert.ok(prompt.includes("camera.fit"));
  assert.ok(prompt.includes("Scale matching"));
  assert.ok(prompt.includes("threeJsonId\":\"female-robot-grp"));
  assert.ok(prompt.includes("Never use parent=scene"));
  assert.ok(prompt.includes("female-robot-left-eye"));
  assert.ok(prompt.includes("JSONL"));
  assert.ok(prompt.includes("object.patch id=<group threeJsonId>"));
  assert.equal(prompt.includes("≥3"), false);
});

test("buildSceneCommandAutoUpdateSystemPrompt distinguishes agent vs single round", () => {
  const single = buildSceneCommandAutoUpdateSystemPrompt();
  assert.ok(single.includes("Single-round"));
  const agent = buildSceneCommandAutoUpdateSystemPrompt({ agentRound: true });
  assert.ok(agent.includes("Agent multi-round"));
  assert.ok(agent.includes("Intermediate rounds MAY output object.get"));
  const iterative = buildSceneCommandAutoUpdateSystemPrompt({ iterativeApply: true });
  assert.ok(iterative.includes("iterative apply"));
  assert.ok(iterative.includes("# done"));
});

test("commandScriptIndicatesDone detects comment-only done scripts", () => {
  assert.equal(commandScriptIndicatesDone(""), true);
  assert.equal(commandScriptIndicatesDone("# done"), true);
  assert.equal(commandScriptIndicatesDone("object.patch id=a partial={}\n# done"), true);
  assert.equal(commandScriptIndicatesDone("# change color"), false);
  assert.equal(commandScriptIndicatesDone("object.patch id=a partial={}"), false);
});

test("commandListHasMutatingOp and batchResultsHaveSceneMutation", () => {
  assert.equal(commandListHasMutatingOp([{ op: "object.get" }]), false);
  assert.equal(commandListHasMutatingOp([{ op: "material.patch" }]), true);
  assert.equal(
    batchResultsHaveSceneMutation([{ op: "object.get", ok: true }, { op: "object.patch", ok: true }]),
    true
  );
  assert.equal(batchResultsHaveSceneMutation([{ op: "object.get", ok: true }]), false);
  assert.equal(batchResultsHaveSuccessfulAdjustment([{ op: "camera.fit", ok: true }]), true);
  assert.equal(batchResultsHaveSuccessfulAdjustment([{ op: "object.get", ok: true }]), false);
});

test("buildSceneCommandUpdateUserMessage includes object list and selection", () => {
  const message = buildSceneCommandUpdateUserMessage({
    modificationRequest: "Move the box right",
    objectList: [{ threeJsonId: "box-1", name: "Main", objType: "box" }],
    selectionId: "box-1",
    selectionDescriptor: { objType: "box", position: { x: 0, y: 0, z: 0 } }
  });
  assert.ok(message.includes("Modification request"));
  assert.ok(message.includes("box-1"));
  assert.ok(message.includes("Current selection"));
  assert.ok(message.includes("Single-round"));
  assert.ok(message.includes("Do not output object.get"));
});

test("buildSceneCommandUpdateUserMessage uses spatial cards instead of thin objectList", () => {
  const message = buildSceneCommandUpdateUserMessage({
    modificationRequest: "Add robot",
    objectList: [{ threeJsonId: "hidden", name: "x", objType: "box" }],
    objectSpatialCards: [
      {
        threeJsonId: "r1",
        name: "robot-body",
        geometrySummary: "box 30×40×20"
      }
    ],
    sceneScaleProfile: { characteristicSize: 30 },
    placementHints: "Suggested near x≈40"
  });
  assert.ok(message.includes("Object spatial summary"));
  assert.ok(message.includes("Scene scale profile"));
  assert.ok(message.includes("Placement hints"));
  assert.equal(message.includes("Scene objects (1)"), false);
  assert.equal(message.includes("hidden"), false);
});

test("extractCommandScriptText and isLikelyCommandScriptText handle micro DSL", () => {
  const raw = [
    "Here are the commands:",
    "```command",
    'object.patch id=box-1 partial={"position":{"x":2,"y":0,"z":0}}',
    "```"
  ].join("\n");
  const script = extractCommandScriptText(raw);
  assert.ok(isLikelyCommandScriptText(script));
  const commands = parseCommandScript(script);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].op, "object.patch");
  assert.equal(commands[0].args.id, "box-1");
});

test("isLikelyCommandScriptText rejects full scene JSON", () => {
  const sceneJson = JSON.stringify({
    worldInfo: { boxModelList: [{ objType: "box", name: "a" }] }
  });
  assert.equal(isLikelyCommandScriptText(sceneJson), false);
});

test("buildSceneCommandAutoUpdateSystemPrompt allows commands or JSON", () => {
  const prompt = buildSceneCommandAutoUpdateSystemPrompt();
  assert.ok(prompt.includes("Preferred"));
  assert.ok(prompt.includes("Full valid ThreeJSON"));
});

test("buildCommandIntentHints maps assembly to parent= workflow", () => {
  const hints = buildCommandIntentHints("add a robot assembly with two parts");
  assert.ok(hints.includes("parent="));
  assert.ok(hints.includes("threeJsonId"));
});

test("buildSceneCommandUpdateUserMessage includes assembly intent hints", () => {
  const message = buildSceneCommandUpdateUserMessage({
    modificationRequest: "group the robot parts",
    assemblyIntentHints: "Capability hints for this request:\n- Multi-part assembly"
  });
  assert.ok(message.includes("Capability hints for this request"));
});

test("detectAssemblyParentWarnings flags empty group with root parts in same batch", () => {
  clearObjectRegistry();
  const scene = new THREE.Scene();
  addObjectFromDescriptor(scene, {
    objType: "group",
    name: "female-robot",
    threeJsonId: "female-robot-grp"
  });
  addObjectFromDescriptor(scene, {
    objType: "box",
    name: "female-robot-body",
    threeJsonId: "body-1",
    geometry: { width: 1, height: 1, depth: 1 },
    material: { type: "standard", color: "#e91e63" }
  });
  const commands = [
    {
      op: "object.add",
      args: {
        descriptor: {
          objType: "group",
          name: "female-robot",
          threeJsonId: "female-robot-grp"
        }
      }
    },
    {
      op: "object.add",
      args: {
        descriptor: {
          objType: "box",
          name: "female-robot-body",
          geometry: { width: 1, height: 1, depth: 1 }
        }
      }
    }
  ];
  const warnings = detectAssemblyParentWarnings(commands);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /female-robot-grp/);
  assert.equal(getObjectByThreeJsonId("female-robot-grp")?.children?.length, 0);
  clearObjectRegistry();
});

test("resolveOutputKind detects commands vs json", () => {
  const commands = 'object.patch id=box-1 partial={"position":{"x":1}}';
  assert.equal(resolveOutputKind(commands), "commands");
  const sceneJson = JSON.stringify({
    worldInfo: {
      boxModelList: [
        {
          name: "floor",
          objType: "box",
          geometry: { width: 1, height: 1, depth: 1 },
          position: { x: 0, y: 0, z: 0 },
          material: { type: "standard", color: "#888888" }
        }
      ]
    }
  });
  assert.equal(resolveOutputKind(sceneJson), "json");
  assert.equal(resolveOutputKind("not commands or json"), "unknown");
});

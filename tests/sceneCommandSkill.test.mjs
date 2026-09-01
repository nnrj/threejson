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
  commandScriptRequestsContinuation,
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
  assert.ok(prompt.includes("Edit-scope economy"));
  assert.match(prompt, /Do not request mesh topology.*transform-only/);
  assert.ok(prompt.includes("threeJsonId\":\"female-robot-grp"));
  assert.ok(prompt.includes("Never use parent=scene"));
  assert.ok(prompt.includes("female-robot-left-eye"));
  assert.ok(prompt.includes("JSONL"));
  assert.ok(prompt.includes("object.patch id=<group threeJsonId>"));
  assert.equal(prompt.includes("≥3"), false);
});

test("buildSceneCommandUpdateSystemPrompt delegates acquisition without inventing URLs", () => {
  const prompt = buildSceneCommandUpdateSystemPrompt();
  assert.match(prompt, /separate host pipeline chooses trusted texture resources/);
  assert.match(prompt, /Do not invent or guess a texture URL/);
  assert.match(prompt, /Preserve user-supplied and existing texture fields/);
  assert.doesNotMatch(prompt, /Poly Haven|Openverse|R2/);
});

test("command update prompt adds requested visible text as SDF instead of metadata", () => {
  const prompt = buildSceneCommandUpdateSystemPrompt({
    selectedCapabilityIds: ["sceneText"]
  });
  assert.match(prompt, /object\.add descriptor=.*\"objType\":\"text\"/);
  assert.match(prompt, /\"content\":\"\.\.\.\"/);
  assert.match(prompt, /\"mode\":\"sdf\"/);
  assert.match(prompt, /name\/label fields are metadata and do not display glyphs/);
  assert.match(prompt, /sceneText was selected during negotiation/);
});

test("command update prompt teaches negotiated Particle V2 and WebGPU TSL edits", () => {
  const prompt = buildSceneCommandUpdateSystemPrompt({
    selectedCapabilityIds: ["particles", "particleRaster", "webgpuTsl", "tslCode"],
    rendererBackend: "webgpu"
  });
  assert.match(prompt, /Negotiated Particle V2 editing capability/);
  assert.match(prompt, /source.*emission.*particle.*simulation.*render/);
  assert.match(prompt, /textMask\|imageMask/);
  assert.match(prompt, /Negotiated WebGPU\/TSL editing capability/);
  assert.match(prompt, /sceneConfig\.renderer\.backend=webgpu/);
  assert.match(prompt, /"kind":"preset\|graph"/);
  assert.match(prompt, /Negotiated raw TSL code editing capability/);
  assert.match(prompt, /default factory returns a NodeMaterial/);
});

test("complex-mesh command guidance prefers local modifiers and does not overuse vertex meshes", () => {
  const prompt = buildSceneCommandUpdateSystemPrompt({
    selectedCapabilityIds: ["complexMesh", "editableMesh", "subdivisionSurface"]
  });
  assert.match(prompt, /refine locally with deterministic modifiers/);
  assert.match(prompt, /Catmull-Clark for quad\/n-gon cages/);
  assert.match(prompt, /Do not use editableMesh\/raw bufferMesh.*primitives.*CSG/);
  assert.match(prompt, /For a car.*wheels and axles.*body\/cabin shell/);
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
  assert.match(iterative, /successful mutating batch is treated as complete/);
  assert.match(iterative, /# continue: <concrete remaining goal>/);
  assert.doesNotMatch(iterative, /MUST end with mutating commands or full scene JSON/);
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

test("complex selected mesh context omits dense coordinates but keeps exact transform and bounds", () => {
  const message = buildSceneCommandUpdateUserMessage({
    modificationRequest: "move this model to x=20",
    selectionId: "raw-model",
    selectionDescriptor: {
      threeJsonId: "raw-model",
      objType: "bufferMesh",
      position: { x: 2, y: 0, z: 0 },
      geometry: {
        attributes: { position: { array: [-11, -12, -13, 14, 15, 16], itemSize: 3 } },
        index: { array: [0, 1, 1] }
      }
    }
  });
  assert.match(message, /raw-model/);
  assert.match(message, /bufferMesh 2v\/1t/);
  assert.match(message, /"x": 2/);
  assert.doesNotMatch(message, /-11/);
  assert.doesNotMatch(message, /14,\s*15,\s*16/);
});

test("buildSceneCommandUpdateUserMessage serializes an explicitly requested full-scene object", () => {
  const message = buildSceneCommandUpdateUserMessage({
    modificationRequest: "change the floor",
    fullSceneJson: {
      threeJsonId: "full-context-scene",
      objectList: [{ threeJsonId: "floor", objType: "box" }]
    }
  });
  assert.match(message, /Full scene JSON/);
  assert.match(message, /"threeJsonId": "full-context-scene"/);
  assert.doesNotMatch(message, /\[object Object\]/);
});

test("commandScriptRequestsContinuation requires an explicit continuation marker", () => {
  assert.equal(commandScriptRequestsContinuation("object.patch id=a partial={}"), false);
  assert.equal(commandScriptRequestsContinuation("object.patch id=a partial={}\n# continue: inspect lighting"), true);
  assert.equal(commandScriptRequestsContinuation("# done"), false);
});

test("agent user message permits immediate done instead of forcing another mutation", () => {
  const message = buildSceneCommandUpdateUserMessage({
    modificationRequest: "polish the scene",
    objectList: [{ threeJsonId: "box-1", objType: "box" }],
    singleRound: false,
    agentRound: true
  });
  assert.match(message, /already satisfies it, output # done only/);
  assert.match(message, /successfully applied mutating batch is final by default/);
  assert.match(message, /# continue: <concrete remaining goal>/);
  assert.doesNotMatch(message, /End the session with mutating commands or full scene JSON/);
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

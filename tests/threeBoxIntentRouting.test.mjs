import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

async function read(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("ThreeBox negotiates generate versus adjust from conversation context", async () => {
  const [source, sceneCardSource] = await Promise.all([
    read("tools/scene-host/threebox/js/threeBoxApp.js"),
    read("tools/scene-host/threebox/js/threeBoxSceneCard.js")
  ]);
  assert.match(source, /classifyThreeBoxTurnIntent\(/);
  assert.match(source, /resolveThreeBoxNegotiatedRoute\(classified, priorTurns\)/);
  assert.match(source, /userPrompt: t\.userPrompt/);
  assert.match(source, /sceneTitle: t\.sceneTitle/);
  assert.match(source, /const sceneGenerationMode = settings\.ai\?\.sceneGenerationMode \|\| "auto"/);
  assert.match(source, /applyCommands:\s*async \(commands, meta = \{\}\)/);
  assert.match(source, /refreshContext:\s*async \(\)/);
  assert.match(source, /sceneCard\.exportSceneJsonString/);
  assert.match(source, /authoritative:\s*adjustmentUsesSceneCardRuntime/);
  assert.match(sceneCardSource, /options\.authoritative !== true/);
  assert.match(sceneCardSource, /applyCommandsWithResult/);
  assert.match(source, /const runtimeSceneJsonString = await sceneCard\.exportSceneJsonString/);
  assert.match(sceneCardSource, /syncAuxiliaryLights\(readyRuntime, \{ force: true \}\)/);
});

test("React ThreeBox preserves negotiated complex-model policy and persists its visible runtime", async () => {
  const [source, runtimeSource] = await Promise.all([
    read("apps/threebox/src/App.jsx"),
    read("packages/react-scene-agent/src/useSceneCardRuntime.js")
  ]);
  assert.match(source, /complexModelStrategy:\s*settings\.ai\.complexModelStrategy \|\| "auto"/);
  assert.match(source, /complexModelStrategy:\s*negotiation\.complexModelStrategy \|\| settings\.ai\.complexModelStrategy/);
  assert.match(source, /const runtimeSnapshot = await finalSceneCard\?\.exportSceneJsonString/);
  assert.match(runtimeSource, /syncAuxiliaryLights\(readyRuntime, \{ force: true \}\)/);
});

test("Editor keeps intent explicit while generation still negotiates execution and capabilities", async () => {
  const [generateSource, adjustSource] = await Promise.all([
    read("tools/scene-host/editor/js/editorAiGeneratePanel.js"),
    read("tools/scene-host/editor/js/editorAiAdjustPanel.js")
  ]);
  assert.match(generateSource, /runAiGenerateTurn\(/);
  assert.match(generateSource, /classifyAiTurnIntent\(/);
  assert.match(generateSource, /executionMode:\s*negotiation\.executionMode/);
  assert.match(generateSource, /sceneGenerationMode:\s*host\.getEditorSettings\(\)\?\.ai\?\.sceneGenerationMode/);
  assert.match(generateSource, /requiresAnimation:\s*negotiation\.requiresAnimation/);
  assert.match(adjustSource, /runAiAdjustTurn\(/);
  assert.doesNotMatch(adjustSource, /classifyAiTurnIntent|classifyTurnIntent/);
});

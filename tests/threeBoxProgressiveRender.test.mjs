import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const appUrl = new URL("../tools/scene-host/threebox/js/threeBoxApp.js", import.meta.url);
const cardUrl = new URL("../tools/scene-host/threebox/js/threeBoxSceneCard.js", import.meta.url);
const panelUrl = new URL("../tools/scene-host/threebox/js/threeBoxChatPanel.js", import.meta.url);

test("ThreeBox uses adaptive policy negotiation while core fixes an empty-history route to generation", async () => {
  const source = await readFile(appUrl, "utf8");
  assert.match(source, /const classified = await classifyThreeBoxTurnIntent\(/);
  assert.match(source, /resolveThreeBoxNegotiatedRoute\(classified, priorTurns\)/);
  assert.doesNotMatch(source, /priorTurns\.length === 0\s*\?\s*\{/);
});

test("ThreeBox can start a draft preview before final AI post-processing completes", async () => {
  const [appSource, cardSource, coreSource, panelSource] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(cardUrl, "utf8"),
    readFile(new URL("../core/ai/sceneAiService.js", import.meta.url), "utf8"),
    readFile(panelUrl, "utf8")
  ]);
  assert.match(appSource, /onSceneDraft:/);
  assert.match(appSource, /draftPreviewPromise/);
  assert.match(coreSource, /capabilityOptions\.onSceneDraft\(sceneJsonString\)/);
  assert.match(cardSource, /onRuntimeReady:/);
  assert.match(cardSource, /showCompactLoadingProgress\(\)/);
  assert.match(cardSource, /async function applyCommands\(/);
  assert.match(cardSource, /async function finalize\(/);
  assert.match(appSource, /sceneCard\.applyCommands\(progress\.commands/);
  assert.match(appSource, /sceneCard\.finalize\(outputSceneJson/);
  assert.match(appSource, /const jsonCollapse = api\.buildJsonCollapse\(outputSceneJsonString\)/);
  assert.match(appSource, /insertBeforeBody\(textEl, jsonCollapse, sceneCard\.el\)/);
  assert.match(panelSource, /insertBeforeBody,\s*createStreamingBlock/);
});

test("ThreeBox scene-card size startup has a bounded fallback", async () => {
  const source = await readFile(cardUrl, "utf8");
  assert.match(source, /setTimeout\(\(\) => \{/);
  assert.match(source, /\}, 250\);/);
  assert.match(source, /width: 320, height: 180/);
});

test("ThreeBox textures and persisted snapshots use the same projected scene shape as the card", async () => {
  const source = await readFile(appUrl, "utf8");
  assert.match(source, /const textureScene = outputSceneJson/);
  assert.match(source, /scene:\s*textureScene/);
  assert.match(source, /sceneJson:\s*outputSceneJsonString/);
  assert.match(source, /jsonCollapse\.updateJson\?\./);
  assert.match(source, /findChangedTextureObjectIds\([\s\S]*projectSceneForUser\(JSON\.stringify\(targetSceneJson\), settings\)[\s\S]*textureScene/);
});

test("unknown-license texture details remain visible for a real user decision", async () => {
  const source = await readFile(cardUrl, "utf8");
  assert.match(source, /if \(!pendingLicense\) \{\s*textureBadgeTimer = setTimeout/);
});

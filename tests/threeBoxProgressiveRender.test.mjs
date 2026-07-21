import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const appUrl = new URL("../tools/scene-host/threebox/js/threeBoxApp.js", import.meta.url);
const cardUrl = new URL("../tools/scene-host/threebox/js/threeBoxSceneCard.js", import.meta.url);

test("ThreeBox skips intent negotiation for a conversation without scene context", async () => {
  const source = await readFile(appUrl, "utf8");
  assert.match(source, /if \(priorTurns\.length === 0\) \{[\s\S]*?handleGenerateTurn\(/);
  assert.match(source, /if \(priorTurns\.length === 0\) \{[\s\S]*?return;\s*\}/);
});

test("ThreeBox can start a draft preview before final AI post-processing completes", async () => {
  const [appSource, cardSource, coreSource] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(cardUrl, "utf8"),
    readFile(new URL("../core/ai/sceneAiService.js", import.meta.url), "utf8")
  ]);
  assert.match(appSource, /onSceneDraft:/);
  assert.match(appSource, /draftPreviewPromise/);
  assert.match(coreSource, /options\.onSceneDraft\(sceneJsonString\)/);
  assert.match(cardSource, /onRuntimeReady:/);
  assert.match(cardSource, /showCompactLoadingProgress\(\)/);
});

test("ThreeBox scene-card size startup has a bounded fallback", async () => {
  const source = await readFile(cardUrl, "utf8");
  assert.match(source, /setTimeout\(\(\) => \{/);
  assert.match(source, /\}, 250\);/);
  assert.match(source, /width: 320, height: 180/);
});

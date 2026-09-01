import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

async function readWorkspaceFile(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("ThreeBox starts its scene runtime before asynchronous deployment finishes", async () => {
  const source = await readWorkspaceFile("tools/scene-host/threebox/js/threeBoxSceneCard.js");
  assert.match(source, /onRuntimeReady:\s*\(\{ runtime: readyRuntime \}\)\s*=>\s*\{\s*activateRuntime\(readyRuntime\)/);
  assert.match(source, /renderActivity\.sync\(\{ forceFrame: true \}\)/);
  assert.match(source, /onDeployProgress:\s*\(\{ runtime: deployingRuntime, deploy \}\)/);
  assert.match(source, /showCompactLoadingProgress\(deploy\)/);
});

test("ThreeBox final Agent result supersedes queued draft previews", async () => {
  const source = await readWorkspaceFile("tools/scene-host/threebox/js/threeBoxApp.js");
  const closeIndex = source.indexOf("previewQueueOpen = false;");
  const finalRenderIndex = source.indexOf("await sceneCard.finalize(outputSceneJson", closeIndex);
  assert.ok(closeIndex >= 0);
  assert.ok(finalRenderIndex > closeIndex);
  assert.doesNotMatch(source.slice(closeIndex, finalRenderIndex), /await previewRenderQueue/);
});

test("ThreeBox replaces the live output buffer when Agent authoring stages change", async () => {
  const source = await readWorkspaceFile("tools/scene-host/threebox/js/threeBoxApp.js");
  assert.match(source, /function createOutputStreamController\(streaming\)/);
  assert.match(source, /metadata\?\.reset === true/);
  assert.match(source, /streamId && streamId !== activeStreamId/);
  assert.equal((source.match(/onDelta:\s*outputStream\.onDelta/g) || []).length, 2);
});

test("ThreeBox JSON viewer opens as plain text and upgrades in idle chunks", async () => {
  const source = await readWorkspaceFile("tools/scene-host/threebox/js/threeBoxChatPanel.js");
  assert.match(source, /plainBlock = buildPlainJsonCodeBlock\(currentText\)/);
  assert.match(source, /requestIdleCallback\(callback, \{ timeout: 500 \}\)/);
  assert.match(source, /chunkCount < 240/);
  assert.match(source, /plainBlock\.replaceWith\(richBlock\)/);
});

test("ThreeBox settings keep controls aligned and place field hints below their controls", async () => {
  const css = await readWorkspaceFile("tools/scene-host/threebox/css/threebox.css");
  assert.match(
    css,
    /\.settingsField\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(160px, 280px\)/s
  );
  assert.match(css, /\.settingsFieldHint\s*\{[^}]*grid-column:\s*2/s);
  assert.match(
    css,
    /@media \(max-width:\s*720px\)[\s\S]*?\.settingsField \.settingsFieldHint\s*\{\s*grid-column:\s*1;/
  );
});

test("built-in provider quota UI omits monetary cost estimates", async () => {
  const [threeBoxSource, editorSource] = await Promise.all([
    readWorkspaceFile("tools/scene-host/threebox/js/threeBoxSettingsModal.js"),
    readWorkspaceFile("tools/scene-host/editor/js/settingsModal.js")
  ]);
  for (const source of [threeBoxSource, editorSource]) {
    assert.doesNotMatch(source, /costUsedUsdCents|costLimitUsdCents|预估花费/);
    assert.match(source, /remaining/);
  }
});

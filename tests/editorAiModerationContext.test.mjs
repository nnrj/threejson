import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createEditorAiTurnContext } from "../tools/scene-host/editor/js/editorAiChatShared.js";

test("editor AI creates a distinct moderation context for each user action", () => {
  const first = createEditorAiTurnContext("first raw prompt");
  const second = createEditorAiTurnContext("second raw prompt");

  assert.match(first.turnId, /^editor-/);
  assert.notEqual(first.turnId, second.turnId);
  assert.equal(first.originalPrompt, "first raw prompt");
  assert.equal(first.moderationStatus, "pending");
});

test("editor generate and adjust panels pass their shared context into provider options", async () => {
  const [generateSource, adjustSource] = await Promise.all([
    readFile(new URL("../tools/scene-host/editor/js/editorAiGeneratePanel.js", import.meta.url), "utf8"),
    readFile(new URL("../tools/scene-host/editor/js/editorAiAdjustPanel.js", import.meta.url), "utf8")
  ]);

  assert.match(generateSource, /requestContext:\s*createEditorAiTurnContext\(userText\)/);
  assert.match(adjustSource, /requestContext:\s*createEditorAiTurnContext\(prompt\)/);
  assert.match(generateSource, /providerAdapter:\s*creds\.providerAdapter/);
  assert.match(adjustSource, /providerAdapter:\s*creds\.providerAdapter/);
});

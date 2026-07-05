import test from "node:test";
import assert from "node:assert/strict";

function isPlainSettingsObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function cloneEditorSettings(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepMergeEditorSettings(base, overlay) {
  if (!isPlainSettingsObject(base)) {
    return cloneEditorSettings(overlay || {});
  }
  const out = cloneEditorSettings(base);
  if (!isPlainSettingsObject(overlay)) {
    return out;
  }
  for (const key of Object.keys(overlay)) {
    const next = overlay[key];
    if (isPlainSettingsObject(next) && isPlainSettingsObject(out[key])) {
      out[key] = deepMergeEditorSettings(out[key], next);
    } else {
      out[key] = next;
    }
  }
  return out;
}

test("deepMergeEditorSettings merges nested sections without mutating base", () => {
  const base = {
    general: { baseTitle: "场景编辑器", messageToastDurationMs: 2600 },
    layout: { leftDockPinned: true },
    ai: { provider: "chatgpt", apiKey: "" }
  };
  const overlay = {
    general: { messageToastDurationMs: 3000 },
    ai: { provider: "deepseek", apiKey: "secret" }
  };
  const merged = deepMergeEditorSettings(base, overlay);
  assert.equal(merged.general.baseTitle, "场景编辑器");
  assert.equal(merged.general.messageToastDurationMs, 3000);
  assert.equal(merged.layout.leftDockPinned, true);
  assert.equal(merged.ai.provider, "deepseek");
  assert.equal(merged.ai.apiKey, "secret");
  assert.equal(base.general.messageToastDurationMs, 2600);
  assert.equal(base.ai.provider, "chatgpt");
});

test("deepMergeEditorSettings replaces scalar leaves", () => {
  const merged = deepMergeEditorSettings(
    { capture: { recordFps: 30, recordBitrateBps: null } },
    { capture: { recordFps: 60 } }
  );
  assert.equal(merged.capture.recordFps, 60);
  assert.equal(merged.capture.recordBitrateBps, null);
});

test("deepMergePlayerSettings replaces scalar leaves", () => {
  function deepMergePlayerSettings(base, overlay) {
    const out = JSON.parse(JSON.stringify(base));
    for (const key of Object.keys(overlay || {})) {
      const next = overlay[key];
      if (next && typeof next === "object" && !Array.isArray(next) && out[key] && typeof out[key] === "object") {
        out[key] = deepMergePlayerSettings(out[key], next);
      } else {
        out[key] = next;
      }
    }
    return out;
  }
  const merged = deepMergePlayerSettings(
    { audio: { defaultVolumePercent: 100, defaultMuted: false } },
    { audio: { defaultMuted: true } }
  );
  assert.equal(merged.audio.defaultVolumePercent, 100);
  assert.equal(merged.audio.defaultMuted, true);
});

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  THREEBOX_SETTINGS_DEFAULTS,
  THREEBOX_SETTINGS_STORAGE_KEY
} from "../tools/scene-host/threebox/js/threeBoxSettingsSchema.js";
import {
  loadThreeBoxSettingsBundle,
  persistThreeBoxSettings
} from "../tools/scene-host/threebox/js/threeBoxSettingsStore.js";

const originalLocalStorage = globalThis.localStorage;

function installMemoryLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    }
  };
  return store;
}

afterEach(() => {
  globalThis.localStorage = originalLocalStorage;
});

test("ThreeBox defaults remember API keys locally", () => {
  installMemoryLocalStorage();
  assert.equal(THREEBOX_SETTINGS_DEFAULTS.ai.rememberKeys, true);
  assert.equal(THREEBOX_SETTINGS_DEFAULTS.ai.onlineTextureHints, true);
  assert.equal(THREEBOX_SETTINGS_DEFAULTS.ai.maxSceneSegments, 16);
  assert.equal(THREEBOX_SETTINGS_DEFAULTS.io.sceneJsonFormat, "standard");
  assert.equal(THREEBOX_SETTINGS_DEFAULTS.agent.progressiveGenerate, true);
  const settings = loadThreeBoxSettingsBundle();
  assert.equal(settings.ai.rememberKeys, true);
  assert.equal(settings.ai.onlineTextureHints, true);
  assert.equal(settings.ai.maxSceneSegments, 16);
  assert.equal(settings.io.sceneJsonFormat, "standard");
  assert.equal(settings.agent.progressiveGenerate, true);
});

test("ThreeBox migrates the legacy friendly-copy preference to the JSON format setting", () => {
  const store = installMemoryLocalStorage();
  store.set(THREEBOX_SETTINGS_STORAGE_KEY, JSON.stringify({ io: { copyFriendlyJson: true } }));
  assert.equal(loadThreeBoxSettingsBundle().io.sceneJsonFormat, "friendly");
});

test("ThreeBox persist keeps keys by default and clears them when rememberKeys is false", () => {
  const store = installMemoryLocalStorage();
  persistThreeBoxSettings({
    ai: {
      rememberKeys: true,
      providers: [{ id: "p1", apiKey: "secret" }]
    }
  });
  let saved = JSON.parse(Array.from(store.values())[0]);
  assert.equal(saved.ai.providers[0].apiKey, "secret");

  store.clear();
  persistThreeBoxSettings({
    ai: {
      rememberKeys: false,
      providers: [{ id: "p1", apiKey: "secret" }]
    }
  });
  saved = JSON.parse(Array.from(store.values())[0]);
  assert.equal(saved.ai.providers[0].apiKey, "");
});

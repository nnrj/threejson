import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  THREEBOX_SETTINGS_DEFAULTS as BASELINE_DEFAULTS,
  THREEBOX_SETTINGS_FIELDS as BASELINE_FIELDS
} from "../tools/scene-host/threebox/js/threeBoxSettingsSchema.js";
import {
  THREEBOX_SETTINGS_DEFAULTS as REACT_DEFAULTS,
  THREEBOX_SETTINGS_FIELDS as REACT_FIELDS
} from "../apps/threebox/src/lib/threeBoxSettingsSchema.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

test("React ThreeBox exposes every baseline setting with matching product semantics", () => {
  const baselineByPath = new Map(BASELINE_FIELDS.map((field) => [field.path, field]));
  const reactByPath = new Map(REACT_FIELDS.map((field) => [field.path, field]));
  assert.deepEqual([...reactByPath.keys()], [...baselineByPath.keys()]);
  for (const [fieldPath, baseline] of baselineByPath) {
    const react = reactByPath.get(fieldPath);
    for (const key of ["type", "label", "hint", "placeholder", "testEndpoint", "min", "max"]) {
      assert.deepEqual(react?.[key], baseline[key], `${fieldPath}.${key}`);
    }
    assert.deepEqual(react?.options, baseline.options, `${fieldPath}.options`);
  }

  for (const section of ["general", "ai", "io", "sync"]) {
    for (const [key, value] of Object.entries(BASELINE_DEFAULTS[section])) {
      assert.deepEqual(REACT_DEFAULTS[section]?.[key], value, `${section}.${key}`);
    }
  }
});

test("React ThreeBox request, persistence and replay paths retain baseline safeguards", () => {
  const source = read("apps/threebox/src/App.jsx");
  assert.match(source, /createSceneAgentTurnContext\(currentTurnId, userPrompt\)/);
  assert.match(source, /threeBoxTurnContext:\s*turnContext/);
  assert.match(source, /options\.provider === "deepseek"[\s\S]*getDisplayDeviceId\(\)/);
  assert.match(source, /createUnsuccessfulTurnRecord\(/);
  assert.match(source, /status === "stopped"/);
  assert.match(source, /turn\.commands\?\.length[\s\S]*kind: "commands"/);
  assert.match(source, /turn\.patch\?\.length[\s\S]*kind: "patch"/);
  assert.match(source, /projectSceneAgentJsonString\([\s\S]*settings\.io\.sceneJsonFormat/);
  assert.match(source, /rawOutputRef\.current/);
  assert.match(source, /selfHostedSync\.syncNow\(\)/);
  assert.match(source, /THREEBOX_PEER_URLS\.editor/);
  assert.match(source, /THREEBOX_PEER_URLS\.player/);
  assert.doesNotMatch(source, /href="http:\/\/localhost:518[03]/);
});

test("React ThreeBox upload and large JSON views preserve responsiveness contracts", () => {
  const uploadSource = read("apps/threebox/src/useComposerAttach.js");
  const jsonSource = read("apps/threebox/src/JsonCollapse.jsx");
  assert.match(uploadSource, /kind === "tjz" \|\| kind === "model"[\s\S]*enqueueSceneAgentLoad/);
  assert.match(jsonSource, /requestIdleCallback/);
  assert.match(jsonSource, /document\.createDocumentFragment\(\)/);
  assert.match(jsonSource, /pre\.replaceChildren\(rich\)/);
});

test("React ThreeBox reuses the baseline privacy dialog contract", () => {
  const entrySource = read("apps/threebox/src/main.jsx");
  const dialogSource = read("apps/threebox/src/PrivacyDialog.jsx");
  assert.match(entrySource, /@threejson\/host-kit\/css\/builtin-provider-privacy\.css/);
  for (const className of [
    "builtinPrivacyOverlay",
    "builtinPrivacyDialog",
    "builtinPrivacyHeader",
    "builtinPrivacyBody",
    "builtinPrivacyFooter",
    "builtinPrivacyButton"
  ]) {
    assert.match(dialogSource, new RegExp(className));
  }
  assert.match(dialogSource, /t\("builtinPrivacy\.title"/);
  assert.match(dialogSource, /document\.body\.classList\.add\("builtinPrivacyOpen"\)/);
  assert.match(dialogSource, /event\.key === "Escape"/);
  assert.match(dialogSource, /event\.key !== "Tab"/);
});

test("React scene-load tracker permits independent canvases to load concurrently", async () => {
  const priorWindow = globalThis.window;
  const priorCustomEvent = globalThis.CustomEvent;
  const events = [];
  globalThis.window = { dispatchEvent: (event) => events.push(event.detail) };
  globalThis.CustomEvent = class CustomEvent {
    constructor(_name, options = {}) { this.detail = options.detail; }
  };
  try {
    const url = pathToFileURL(path.join(ROOT, "packages/react-scene-agent/src/sceneLoadQueue.js"));
    url.searchParams.set("parity", String(Date.now()));
    const { enqueueSceneAgentLoad, isSceneAgentLoadBusy } = await import(url.href);
    const started = [];
    let releaseFirst;
    let releaseSecond;
    const first = enqueueSceneAgentLoad(() => {
      started.push("first");
      return new Promise((resolve) => { releaseFirst = resolve; });
    });
    const second = enqueueSceneAgentLoad(() => {
      started.push("second");
      return new Promise((resolve) => { releaseSecond = resolve; });
    });
    assert.deepEqual(started, ["first", "second"]);
    assert.equal(isSceneAgentLoadBusy(), true);
    assert.equal(events.at(-1)?.activeCount, 2);
    releaseSecond("second");
    releaseFirst("first");
    assert.deepEqual(await Promise.all([first, second]), ["first", "second"]);
    assert.equal(isSceneAgentLoadBusy(), false);
    assert.equal(events.at(-1)?.activeCount, 0);
  } finally {
    globalThis.window = priorWindow;
    globalThis.CustomEvent = priorCustomEvent;
  }
});

test("React settings never persist user or texture keys when key memory is disabled", async () => {
  const priorLocalStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
  try {
    const store = await import("../apps/threebox/src/lib/threeBoxSettingsStore.js");
    const settings = store.cloneThreeBoxSettings(REACT_DEFAULTS);
    settings.ai.rememberKeys = false;
    settings.ai.textureServiceApiKey = "texture-secret";
    settings.ai.providers = [
      { id: "user", provider: "deepseek", apiKey: "user-secret" },
      { id: "builtin", provider: "threebox-builtin", apiKey: "revocable-trial" }
    ];
    store.persistThreeBoxSettings(settings);
    const persisted = JSON.parse(values.get("threejson.threebox.settings.v1"));
    assert.equal(persisted.ai.providers[0].apiKey, "");
    assert.equal(persisted.ai.providers[1].apiKey, "revocable-trial");
    assert.equal(persisted.ai.textureServiceApiKey, "");
  } finally {
    globalThis.localStorage = priorLocalStorage;
  }
});

test("React host error feedback recognizes the product-neutral intent failure code", async () => {
  const { getAiErrorFeedback } = await import("@threejson/host-kit/js/aiErrorFeedback.js");
  const feedback = getAiErrorFeedback({
    code: "SCENE_AGENT_INTENT_CLASSIFICATION_FAILED",
    message: "classification failed"
  });
  assert.equal(feedback.code, "SCENE_AGENT_INTENT_CLASSIFICATION_FAILED");
  assert.match(feedback.message, /判断|classif/i);
});

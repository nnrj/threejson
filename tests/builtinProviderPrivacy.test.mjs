import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, test } from "node:test";
import {
  BUILTIN_PRIVACY_ACCEPTED,
  BUILTIN_PRIVACY_DECLINED,
  getBuiltinPrivacyDecision,
  isBuiltinPrivacyAccepted,
  setBuiltinPrivacyDecision
} from "../tools/scene-host/shared/js/builtinProviderPrivacy.js";

const originalLocalStorage = globalThis.localStorage;

function installMemoryStorage() {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

afterEach(() => {
  if (originalLocalStorage === undefined) {
    delete globalThis.localStorage;
  } else {
    globalThis.localStorage = originalLocalStorage;
  }
});

test("built-in privacy decisions are persisted independently for ThreeBox and Editor", () => {
  installMemoryStorage();
  assert.equal(getBuiltinPrivacyDecision("threebox"), null);
  assert.equal(getBuiltinPrivacyDecision("editor"), null);

  setBuiltinPrivacyDecision("threebox", BUILTIN_PRIVACY_ACCEPTED);
  setBuiltinPrivacyDecision("editor", BUILTIN_PRIVACY_DECLINED);

  assert.equal(isBuiltinPrivacyAccepted("threebox"), true);
  assert.equal(isBuiltinPrivacyAccepted("editor"), false);
  assert.equal(getBuiltinPrivacyDecision("editor"), BUILTIN_PRIVACY_DECLINED);
});

test("both hosts gate built-in key issuance and expose an agreement reopening path", async () => {
  const [threeboxProvider, editorProvider, threeboxSettings, editorSettings] = await Promise.all([
    readFile(new URL("../tools/scene-host/threebox/js/threeBoxBuiltinProvider.js", import.meta.url), "utf8"),
    readFile(new URL("../tools/scene-host/shared/js/editorBuiltinAiProvider.js", import.meta.url), "utf8"),
    readFile(new URL("../tools/scene-host/threebox/js/threeBoxSettingsModal.js", import.meta.url), "utf8"),
    readFile(new URL("../tools/scene-host/editor/js/settingsModal.js", import.meta.url), "utf8")
  ]);

  assert.match(threeboxProvider, /isBuiltinPrivacyAccepted\("threebox"\)/);
  assert.match(editorProvider, /isBuiltinPrivacyAccepted\("editor"\)/);
  assert.match(threeboxSettings, /onOpenBuiltinPrivacy/);
  assert.match(editorSettings, /openBuiltinPrivacyAgreement/);
});

test("agreement actions use unambiguous Chinese and English labels", async () => {
  const [dialogSource, englishLabels] = await Promise.all([
    readFile(new URL("../tools/scene-host/shared/js/builtinProviderPrivacy.js", import.meta.url), "utf8"),
    readFile(new URL("../tools/scene-host/shared/i18n/builtinProviderPrivacyLabels.en.js", import.meta.url), "utf8")
  ]);

  assert.match(dialogSource, /"我同意"/);
  assert.match(dialogSource, /"我拒绝"/);
  assert.match(englishLabels, /"builtinPrivacy\.accept": "I Agree"/);
  assert.match(englishLabels, /"builtinPrivacy\.decline": "Decline"/);
});

test("privacy dialog stylesheet provides bounded mobile scrolling and stacked actions", async () => {
  const css = await readFile(
    new URL("../tools/scene-host/shared/css/builtin-provider-privacy.css", import.meta.url),
    "utf8"
  );
  assert.match(css, /overflow-y:\s*auto/);
  assert.match(css, /100dvh/);
  assert.match(css, /scrollbar-width:\s*thin/);
  assert.match(css, /@media\s*\(max-width:\s*640px\)/);
  assert.match(css, /flex-direction:\s*column-reverse/);
});

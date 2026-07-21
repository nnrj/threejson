import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const codeModeUrl = new URL("../tools/scene-host/editor/js/codeEditorMode.js", import.meta.url);

test("Code mode renders when the optional AI sidebar hook is absent", async () => {
  const source = await readFile(codeModeUrl, "utf8");

  assert.match(source, /if \(aiOk === false\) \{\s*return false;/);
  assert.doesNotMatch(source, /if \(!aiOk\) \{\s*return false;/);
  assert.match(source, /if \(rendered\) \{\s*host\.showMessage\("自动渲染完成。", "success"\);/);
});

test("Code mode protects pasted JSON when leaving an empty scene", async () => {
  const source = await readFile(codeModeUrl, "utf8");

  assert.match(
    source,
    /const codeRaw = String\(getActiveCodeJsonText\(\) \|\| ""\)\.trim\(\);[\s\S]*?if \(!host\.getScene\(\)\?\.isScene\) \{\s*return true;/
  );
  assert.match(source, /if \(!\(await confirmLeaveCodeModeIfNeeded\(\)\)\) \{\s*return;/);
});

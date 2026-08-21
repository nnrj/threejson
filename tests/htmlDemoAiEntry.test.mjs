import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("minimal AI scene demo imports AI from the explicit package subpath", () => {
  const source = fs.readFileSync(
    path.join(REPO_ROOT, "examples/html-demo/track-05-tooling/05-03-ai-scene-mini.html"),
    "utf8"
  );
  assert.match(source, /"threejson\/ai"\s*:\s*"\.\.\/\.\.\/\.\.\/core\/ai\/index\.js"/);
  assert.match(source, /import\s+\{\s*createSceneAiClient\s*\}\s+from\s+"threejson\/ai"/);
  assert.doesNotMatch(source, /import\s+\{[^}]*createSceneAiClient[^}]*\}\s+from\s+"threejson"/s);
});

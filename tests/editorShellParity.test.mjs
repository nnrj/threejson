import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../tools/scene-host/editor/${name}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
test("Editor generation template retains every browser import mapping used by the deployed HTML", () => {
  const imports = (source) => JSON.parse(source.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
  assert.deepEqual(imports(read("index.template.html")), imports(read("index.html")));
});
test("Editor generated body and reusable shell have the same controls", () => {
  const ids = (source) => [...source.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(ids(read("index.html")), ids(read("_shell-body.html")));
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

describe("node boundary (M0)", () => {
  it("core/index.js does not export Node-only util modules", () => {
    const indexSrc = fs.readFileSync("core/index.js", "utf8");
    assert.doesNotMatch(indexSrc, /nodeSceneFile|nodeTextureSink/);
  });

  it("textBuilder does not statically import sdfText (troika lazy path)", () => {
    const src = fs.readFileSync("core/builder/textBuilder.js", "utf8");
    assert.doesNotMatch(src, /^import\s+.*from\s+["']\.\/text\/sdfText\.js["']/m);
    assert.match(src, /loadSdfTextModule/);
  });
});

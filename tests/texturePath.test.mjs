import assert from "node:assert/strict";
import { test } from "node:test";
import { toSiteRelativeTexturePath } from "../core/ai/textureAiService.js";

test("toSiteRelativeTexturePath returns /resources path when under project root", () => {
  const root = "E:/proj/ThreeJSON".replace(/\//g, "\\");
  const full = "E:/proj/ThreeJSON/assets/textures/ai-generated/a.png".replace(/\//g, "\\");
  const rel = toSiteRelativeTexturePath(full, root);
  assert.ok(rel.includes("/assets/textures/"));
});

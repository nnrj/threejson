import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveBoxDefaultTextureUrl } from "../core/util/boxTextureUrl.js";

test("resolveBoxDefaultTextureUrl falls back to material.textureUrl", () => {
  const material = {
    type: "standard",
    textureUrl: "/assets/textures/test.png"
  };
  const url = resolveBoxDefaultTextureUrl({
    material,
    materials: [
      { type: "standard", map: {} },
      { type: "standard", map: {} },
      { type: "standard", map: {} },
      { type: "standard", map: {} },
      { type: "standard", map: {} },
      { type: "standard", map: {} }
    ]
  });
  assert.equal(url, "/assets/textures/test.png");
});

test("resolveBoxDefaultTextureUrl prefers materials[] URL when present", () => {
  const url = resolveBoxDefaultTextureUrl({
    material: { textureUrl: "/fallback.png" },
    materials: [{ textureUrl: "/face0.png" }]
  });
  assert.equal(url, "/face0.png");
});

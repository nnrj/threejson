import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clearAssetRegistry,
  registerAssetLibrary
} from "../core/cache/assetRegistry.js";
import {
  resolveTextureSource,
  materialJsonHasResolvableTexture
} from "../core/util/resolveTextureSource.js";

test("resolveTextureSource uses non-empty textureUrl", () => {
  assert.equal(
    resolveTextureSource({ textureUrl: "/assets/a.png" }),
    "/assets/a.png"
  );
});

test("resolveTextureSource ignores empty textureUrl and map string", () => {
  assert.equal(resolveTextureSource({ textureUrl: "" }), null);
  assert.equal(resolveTextureSource({ map: "/legacy.png" }), null);
});

test("resolveTextureSource resolves lib:// via assetRegistry", () => {
  clearAssetRegistry();
  registerAssetLibrary([
    { threeJsonId: "tex-wood", assetKind: "texture", url: "/assets/wood.png", name: "wood" }
  ]);
  assert.equal(resolveTextureSource({ textureUrl: "lib://tex-wood" }), "/assets/wood.png");
  assert.equal(resolveTextureSource({ textureUrl: "lib://wood" }), "/assets/wood.png");
  assert.equal(resolveTextureSource({ textureUrl: "lib://missing" }), null);
  clearAssetRegistry();
});

test("materialJsonHasResolvableTexture", () => {
  assert.equal(materialJsonHasResolvableTexture({ textureUrl: "/x.png" }), true);
  assert.equal(materialJsonHasResolvableTexture({ textureUrl: "" }), false);
});

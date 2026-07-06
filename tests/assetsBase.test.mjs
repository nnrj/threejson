import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ASSETS_PACKAGE_VERSION,
  DEFAULT_CDN_ASSETS_BASE,
  LOCAL_ASSETS_BASE,
  assetUrl,
  assetUrlCandidates,
  getAssetsBaseMode,
  getAssetsBaseUrl,
  normalizeAssetsBaseMode,
  resolveAssetsBaseFromLoad,
  resolveAssetsBaseModeFromLoad,
  resolvePublicAssetUrl,
  resolvePublicAssetUrlCandidates,
  setAssetsBaseMode,
  setAssetsBaseUrl
} from "../core/util/assetsBase.js";
import { loadTextureFromMaterialJson } from "../core/util/loadTextureFromMaterialJson.js";

test("default assets base is base-first with jsDelivr fallback", () => {
  assert.equal(getAssetsBaseUrl(), LOCAL_ASSETS_BASE);
  assert.equal(getAssetsBaseMode(), "base-first");
  assert.equal(normalizeAssetsBaseMode(""), "base-first");
  assert.equal(normalizeAssetsBaseMode("unknown"), "base-first");
  assert.ok(DEFAULT_CDN_ASSETS_BASE.includes(`@threejson/assets@${ASSETS_PACKAGE_VERSION}`));
  assert.deepEqual(assetUrlCandidates("textures/foo.png"), [
    "/assets/textures/foo.png",
    `${DEFAULT_CDN_ASSETS_BASE}/textures/foo.png`
  ]);
});

test("setAssetsBaseUrl defaults to base-first CDN fallback", () => {
  setAssetsBaseUrl("./assets");
  assert.equal(assetUrl("textures/foo.png"), "./assets/textures/foo.png");
  assert.deepEqual(assetUrlCandidates("textures/foo.png"), [
    "./assets/textures/foo.png",
    `${DEFAULT_CDN_ASSETS_BASE}/textures/foo.png`
  ]);
  setAssetsBaseUrl(LOCAL_ASSETS_BASE);
});

test("resolvePublicAssetUrl rewrites /assets/ prefix to the first candidate", () => {
  setAssetsBaseMode("local-first");
  assert.equal(
    resolvePublicAssetUrl("/assets/textures/device/cabinet/cabinet_left_door.png"),
    "/assets/textures/device/cabinet/cabinet_left_door.png"
  );
  setAssetsBaseMode("cdn-first");
  assert.ok(
    resolvePublicAssetUrl("/assets/textures/device/cabinet/cabinet_left_door.png").startsWith(
      DEFAULT_CDN_ASSETS_BASE
    )
  );
  setAssetsBaseMode("base-first");
});

test("resolvePublicAssetUrlCandidates exposes local/CDN fallback order", () => {
  setAssetsBaseMode("local-first");
  assert.deepEqual(resolvePublicAssetUrlCandidates("/assets/textures/foo.png"), [
    "/assets/textures/foo.png",
    `${DEFAULT_CDN_ASSETS_BASE}/textures/foo.png`
  ]);
  setAssetsBaseMode("cdn-first");
  assert.deepEqual(resolvePublicAssetUrlCandidates("/assets/textures/foo.png"), [
    `${DEFAULT_CDN_ASSETS_BASE}/textures/foo.png`,
    "/assets/textures/foo.png"
  ]);
  setAssetsBaseMode("base-first");
});

test("resolvePublicAssetUrl leaves absolute https URLs unchanged", () => {
  const url = "https://example.com/textures/foo.png";
  assert.equal(resolvePublicAssetUrl(url), url);
  assert.deepEqual(resolvePublicAssetUrlCandidates(url), [url]);
});

test("resolveAssetsBaseFromLoad prefers createJsonScene options over sceneConfig", () => {
  const payload = { sceneConfig: { assetsBase: "/assets", assetsBaseMode: "cdn-first" } };
  assert.equal(resolveAssetsBaseFromLoad(payload, {}), "/assets");
  assert.equal(
    resolveAssetsBaseFromLoad(payload, { assetsBase: "https://cdn.example.com/pkg" }),
    "https://cdn.example.com/pkg"
  );
  assert.equal(resolveAssetsBaseModeFromLoad(payload, {}), "cdn-first");
  assert.equal(resolveAssetsBaseModeFromLoad(payload, { assetsBaseMode: "local-only" }), "local-only");
});

test("loadTextureFromMaterialJson falls back from local assets to CDN", async () => {
  setAssetsBaseMode("local-first");
  const calls = [];
  const primaryTexture = { repeat: { set() {} } };
  const loader = {
    load(url, onLoad, _onProgress, onError) {
      calls.push(url);
      if (calls.length === 1) {
        queueMicrotask(() => onError(new Error("missing local asset")));
        return primaryTexture;
      }
      queueMicrotask(() => onLoad({
        image: "cdn-image",
        source: "cdn-source",
        flipY: false,
        colorSpace: "srgb"
      }));
      return { repeat: { set() {} } };
    }
  };
  const texture = loadTextureFromMaterialJson(
    { textureUrl: "/assets/textures/fallback-test.png" },
    { loader }
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(texture, primaryTexture);
  assert.deepEqual(calls, [
    "/assets/textures/fallback-test.png",
    `${DEFAULT_CDN_ASSETS_BASE}/textures/fallback-test.png`
  ]);
  assert.equal(texture.image, "cdn-image");
  assert.equal(texture.userData.threeJsonResolvedUrl, `${DEFAULT_CDN_ASSETS_BASE}/textures/fallback-test.png`);
  setAssetsBaseMode("base-first");
});

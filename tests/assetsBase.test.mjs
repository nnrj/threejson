import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Texture } from "three";

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
import { loadTextureFromMaterialJson, whenTextureReady } from "../core/util/loadTextureFromMaterialJson.js";
test("ASSETS_PACKAGE_VERSION matches the workspace @threejson/assets package", () => {
  // Catches exactly the drift that once let this go stale (pinned to 1.0.0 well after 1.1.2 had
  // shipped, silently missing files the newer version had) — see assetsBase.js's docblock.
  const workspaceVersion = JSON.parse(
    readFileSync(new URL("../assets/package.json", import.meta.url), "utf8")
  ).version;
  assert.equal(
    ASSETS_PACKAGE_VERSION,
    workspaceVersion,
    `ASSETS_PACKAGE_VERSION ("${ASSETS_PACKAGE_VERSION}") in core/util/assetsBase.js no longer matches assets/package.json ("${workspaceVersion}") — publish @threejson/assets before publishing a ThreeJSON release that pins it.`
  );
});

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
  const primaryTexture = new Texture();
  const loader = {
    load(url, onLoad, _onProgress, onError) {
      calls.push(url);
      if (calls.length === 1) {
        queueMicrotask(() => onError(new Error("missing local asset")));
        return primaryTexture;
      }
      const loaded = new Texture("cdn-image");
      loaded.flipY = false;
      queueMicrotask(() => onLoad(loaded));
      return loaded;
    }
  };
  const texture = loadTextureFromMaterialJson(
    { textureUrl: "/assets/textures/fallback-test.png" },
    { loader }
  );
  await whenTextureReady(texture);
  assert.notEqual(texture, primaryTexture, "the failed candidate is not the owned texture view");
  assert.deepEqual(calls, [
    "/assets/textures/fallback-test.png",
    `${DEFAULT_CDN_ASSETS_BASE}/textures/fallback-test.png`
  ]);
  assert.equal(texture.image, "cdn-image");
  assert.equal(texture.userData.threeJsonResolvedUrl, `${DEFAULT_CDN_ASSETS_BASE}/textures/fallback-test.png`);
  texture.dispose();
  setAssetsBaseMode("base-first");
});

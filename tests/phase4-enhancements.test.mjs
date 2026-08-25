import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clearTextureUrlCache,
  configureTextureUrlCacheForDeploy,
  isTextureUrlCacheEnabled,
  rememberCanonicalTexture,
  getCanonicalTexture
} from "../core/cache/textureUrlCache.js";

test("textureUrlCache disabled by default", () => {
  clearTextureUrlCache();
  configureTextureUrlCacheForDeploy({ sceneConfig: { extensions: {} } });
  assert.equal(isTextureUrlCacheEnabled(), false);
  rememberCanonicalTexture("/tex/a.png", { isTexture: true });
  assert.equal(getCanonicalTexture("/tex/a.png"), null);
});

test("textureUrlCache enabled from sceneConfig.extensions.assetLibrary", () => {
  configureTextureUrlCacheForDeploy({
    sceneConfig: {
      extensions: {
        assetLibrary: { textureUrlCache: true }
      }
    }
  });
  assert.equal(isTextureUrlCacheEnabled(), true);
  const canonical = { isTexture: true, url: "/tex/a.png" };
  rememberCanonicalTexture("/tex/a.png", canonical);
  assert.equal(getCanonicalTexture("/tex/a.png"), canonical);
  configureTextureUrlCacheForDeploy({ sceneConfig: {} });
  assert.equal(isTextureUrlCacheEnabled(), false);
  clearTextureUrlCache();
});

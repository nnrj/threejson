import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clearTextureUrlCache,
  configureTextureUrlCacheForDeploy,
  isTextureUrlCacheEnabled,
  rememberCanonicalTexture,
  getCanonicalTexture
} from "../core/cache/textureUrlCache.js";
import {
  _clearParticleProvidersForTests,
  getParticleEmitterProvider,
  registerParticleEmitterProvider,
  resolveParticleProviderId,
  tryDeployParticleEmitterByProvider
} from "../core/builder/particle/particleProviderRegistry.js";

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

test("particle provider registry resolves and dispatches", () => {
  _clearParticleProvidersForTests();
  assert.equal(resolveParticleProviderId({ provider: "nebula" }), "nebula");
  assert.equal(resolveParticleProviderId({ provider: "core" }), "");
  assert.equal(getParticleEmitterProvider("nebula"), null);

  let calls = 0;
  registerParticleEmitterProvider("nebula", () => {
    calls += 1;
    return { type: "Points" };
  });

  const hit = tryDeployParticleEmitterByProvider({ provider: "nebula" }, {}, {});
  assert.equal(calls, 1);
  assert.equal(hit?.type, "Points");
  assert.equal(tryDeployParticleEmitterByProvider({ provider: "missing" }, {}, {}), undefined);
  _clearParticleProvidersForTests();
});

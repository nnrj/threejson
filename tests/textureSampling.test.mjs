import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import {
  applyTexturePropsFromRecord,
  applyUiTextureSampling,
  configureTextureDefaultsForDeploy,
  normalizeTextureFilter,
  parseTextureQuality,
  resolveTextureProps,
  serializeTextureFilter,
  _resetTextureSamplingForDeployForTests
} from "../core/util/textureSampling.js";

test("applyUiTextureSampling uses ui profile defaults", () => {
  const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  applyUiTextureSampling(texture);
  assert.equal(texture.generateMipmaps, false);
  assert.equal(texture.minFilter, THREE.LinearFilter);
  assert.equal(texture.magFilter, THREE.LinearFilter);
  assert.equal(texture.anisotropy, 4);
  if (THREE.SRGBColorSpace !== undefined) {
    assert.equal(texture.colorSpace, THREE.SRGBColorSpace);
  }
});

test("applyTexturePropsFromRecord imageMap keeps mipmaps and sets anisotropy", () => {
  const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  applyTexturePropsFromRecord(texture, "imageMap");
  assert.equal(texture.generateMipmaps, true);
  assert.equal(texture.anisotropy, 4);
});

test("opt-out textureSampling false skips preset", () => {
  const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  texture.anisotropy = 1;
  applyTexturePropsFromRecord(texture, "imageMap", { textureSampling: false });
  assert.equal(texture.anisotropy, 1);
});

test("textureQuality high tier raises anisotropy on imageMap", () => {
  const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  applyTexturePropsFromRecord(texture, "imageMap", { textureQuality: 3 });
  assert.equal(texture.anisotropy, 8);
  assert.equal(texture.minFilter, THREE.LinearMipmapLinearFilter);
});

test("explicit anisotropy overrides tier", () => {
  const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  applyTexturePropsFromRecord(texture, "imageMap", { textureQuality: 1, anisotropy: 6 });
  assert.equal(texture.anisotropy, 6);
});

test("textureAnisotropy alias on ui profile", () => {
  const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  applyUiTextureSampling(texture, { textureAnisotropy: 6 });
  assert.equal(texture.anisotropy, 6);
});

test("configureTextureDefaultsForDeploy merges sceneConfig textureDefaults and quality", () => {
  try {
    configureTextureDefaultsForDeploy({
      sceneConfig: {
        textureQuality: 3,
        textureDefaults: {
          ui: { anisotropy: 2 },
          imageMap: { anisotropy: 6 }
        }
      }
    });
    const ui = resolveTextureProps("ui", { textureQuality: 2 });
    const image = resolveTextureProps("imageMap", { textureQuality: 3 });
    assert.equal(ui.settings.anisotropy, 4);
    assert.equal(image.settings.anisotropy, 8);
  } finally {
    _resetTextureSamplingForDeployForTests();
  }
});

test("normalizeTextureFilter string and three integer", () => {
  assert.equal(normalizeTextureFilter("linearMipmapLinear"), THREE.LinearMipmapLinearFilter);
  assert.equal(normalizeTextureFilter(1008), THREE.LinearMipmapLinearFilter);
  assert.equal(normalizeTextureFilter(9999), undefined);
});

test("serializeTextureFilter", () => {
  assert.equal(serializeTextureFilter(THREE.LinearFilter), "linear");
});

test("parseTextureQuality accepts int and strings", () => {
  assert.equal(parseTextureQuality(0), 0);
  assert.equal(parseTextureQuality("high"), 3);
  assert.equal(parseTextureQuality("medium"), 2);
  assert.equal(parseTextureQuality(null), null);
});

test("textureQuality 0 is opt-out", () => {
  const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  texture.anisotropy = 2;
  applyTexturePropsFromRecord(texture, "imageMap", { textureQuality: 0 });
  assert.equal(texture.anisotropy, 2);
});

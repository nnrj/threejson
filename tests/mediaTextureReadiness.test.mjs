import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { loadTextureFromMaterialJson } from "../core/util/loadTextureFromMaterialJson.js";
import { registerTextureReadiness, bindTextureWhenReady, whenTextureReady, cloneTextureResource, getTextureLoadState } from "../core/resource/textureRequest.js";

test("pending/failed animated textures keep base color and release the media only after the last material view", async () => {
  let ready, stopped = 0;
  const pending = new Promise((resolve) => { ready = resolve; });
  const original = registerTextureReadiness(new THREE.Texture(), pending, { dispose: () => stopped++ });
  const copy = cloneTextureResource(original);
  const material = new THREE.MeshStandardMaterial({ color: "red" });
  const binding = bindTextureWhenReady(material, "map", copy);
  assert.equal(material.map, null);
  original.dispose(); assert.equal(stopped, 0);
  ready(); await binding;
  assert.equal(material.map, copy);
  copy.dispose(); assert.equal(stopped, 1);
  material.dispose();
  const failed = registerTextureReadiness(new THREE.Texture(), Promise.reject(new Error("decode failure")));
  const base = new THREE.MeshStandardMaterial({ color: "blue" });
  await assert.rejects(bindTextureWhenReady(base, "map", failed), /decode failure/);
  assert.equal(base.map, null); assert.equal(base.color.getHexString(), "0000ff"); base.dispose();
});

test("video map waits for a decoded first frame, not its empty VideoTexture placeholder", async (t) => {
  const previous = globalThis.document;
  class Video extends EventTarget {
    readyState = 0; videoWidth = 0; videoHeight = 0;
    setAttribute() {} removeAttribute() {} load() {} pause() {} play() { return Promise.resolve(); }
  }
  const video = new Video(); globalThis.document = { createElement: () => video };
  t.after(() => { globalThis.document = previous; });
  const texture = loadTextureFromMaterialJson({ textureKind: "video", textureUrl: "https://example.org/movie.mp4", videoAutoplay: false });
  const material = new THREE.MeshStandardMaterial({ color: "#e08040" });
  const binding = bindTextureWhenReady(material, "map", texture);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(getTextureLoadState(texture), "loading"); assert.equal(material.map, null);
  video.readyState = 2; video.videoWidth = 128; video.videoHeight = 64;
  video.dispatchEvent(new Event("loadeddata"));
  await whenTextureReady(texture); await binding;
  assert.equal(material.map, texture); assert.equal(getTextureLoadState(texture), "ready");
  texture.dispose(); material.dispose();
});

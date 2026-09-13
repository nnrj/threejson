import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { applySceneBackdropFromHints, disposeThreeJsonSceneBackdrop } from "../core/handler/sceneBackdropResolver.js";

test("backdrop replacement does not let the old disposer clear the newly loaded texture", async (t) => {
  const created = [];
  t.mock.method(THREE.TextureLoader.prototype, "load", (url, success, _, failure) => {
    if (url.includes("broken")) { failure(new Error("decode failure")); return; }
    const texture = new THREE.Texture({ width: 2, height: 2 });
    const entry = { texture, disposed: 0 }; texture.addEventListener("dispose", () => entry.disposed++);
    created.push(entry); success(texture); return texture;
  });
  const scene = new THREE.Scene();
  await applySceneBackdropFromHints(scene, { background: { type: "equirect", url: "a.png" } });
  const first = scene.background;
  await applySceneBackdropFromHints(scene, { background: { type: "equirect", url: "b.png" } });
  assert.notEqual(scene.background, first); assert.equal(scene.background, created[1].texture);
  assert.equal(created[0].disposed, 1); assert.equal(created[1].disposed, 0);
  const result = await applySceneBackdropFromHints(scene, { background: { type: "equirect", url: "broken.png" } });
  assert.equal(result.diagnostics[0].code, "BACKDROP_RESOURCE_FAILED");
  assert.equal(scene.background, created[1].texture);
  await applySceneBackdropFromHints(scene, { background: "#123456" });
  assert.equal(scene.background.getHexString(), "123456"); assert.equal(created[1].disposed, 1);
  disposeThreeJsonSceneBackdrop(scene);
  assert.equal(created[1].disposed, 1);
});

test("disposing or superseding a backdrop request prevents late results from being attached", async (t) => {
  const pending = [], disposed = [];
  t.mock.method(THREE.TextureLoader.prototype, "load", (url, done) => {
    const texture = new THREE.Texture();
    texture.addEventListener("dispose", () => disposed.push(url));
    pending.push(() => done(texture)); return texture;
  });
  const scene = new THREE.Scene();
  const first = applySceneBackdropFromHints(scene, { background: { type: "equirect", url: "first.png" } });
  const firstRejected = assert.rejects(first, { name: "AbortError" });
  await applySceneBackdropFromHints(scene, { background: "blue" });
  pending.shift()(); await firstRejected;
  assert.equal(scene.background.getHexString(), "0000ff");
  const second = applySceneBackdropFromHints(scene, { background: { type: "equirect", url: "second.png" } });
  const secondRejected = assert.rejects(second, { name: "AbortError" });
  disposeThreeJsonSceneBackdrop(scene); pending.shift()(); await secondRejected;
  assert.equal(scene.background, null); assert.equal(disposed.length, 2);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeExtensionMaps,
  readExtensionConfig,
  resolveSceneExtensions
} from "../core/util/extensionsUtil.js";
test("mergeExtensionMaps deep-merges per extension id", () => {
  const out = mergeExtensionMaps(
    { "physics-rapier": { enabled: true, gravity: { y: -9 } } },
    { "physics-rapier": { stepHz: 60 } }
  );
  assert.equal(out["physics-rapier"].enabled, true);
  assert.equal(out["physics-rapier"].stepHz, 60);
  assert.equal(out["physics-rapier"].gravity.y, -9);
});

test("readExtensionConfig reads object extensions map", () => {
  const cfg = readExtensionConfig(
    { extensions: { "physics-rapier": { rigidBody: "dynamic" } } },
    "physics-rapier"
  );
  assert.equal(cfg.rigidBody, "dynamic");
});

test("resolveSceneExtensions merges worldInfo and sceneConfig", () => {
  const ext = resolveSceneExtensions(
    { extensions: { foo: { a: 1 } } },
    { extensions: { foo: { b: 2 }, bar: { x: 1 } } }
  );
  assert.equal(ext.foo.a, 1);
  assert.equal(ext.foo.b, 2);
  assert.equal(ext.bar.x, 1);
});

test("mergeExtensionMaps preserves distinct extension ids", () => {
  const out = mergeExtensionMaps(
    { "physics-rapier": { enabled: true } },
    { "other-ext": { flag: 1 } }
  );
  assert.equal(out["physics-rapier"].enabled, true);
  assert.equal(out["other-ext"].flag, 1);
});

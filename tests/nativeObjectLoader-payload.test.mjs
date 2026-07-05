import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test } from "node:test";

import {
  buildMinimalWorldJsonForNativeThreeInline,
  isThreeJsObjectExportJson,
  resolveScenePayloadForLoad
} from "../core/builder/nativeObjectLoader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sampleNative = JSON.parse(
  readFileSync(join(__dirname, "../assets/json/three_native.json"), "utf8")
);

test("isThreeJsObjectExportJson detects ObjectLoader root export", () => {
  assert.equal(isThreeJsObjectExportJson(sampleNative), true);
  assert.equal(isThreeJsObjectExportJson({ worldInfo: {} }), false);
  assert.equal(isThreeJsObjectExportJson(null), false);
});

test("resolveScenePayloadForLoad wraps native export into worldInfo shell", () => {
  const resolved = resolveScenePayloadForLoad(sampleNative, { label: "demo.json" });
  assert.ok(resolved.worldInfo && typeof resolved.worldInfo === "object");
  assert.equal(Array.isArray(resolved.worldInfo.domainModelList), true);
  assert.equal(resolved.worldInfo.domainModelList.length, 1);
  assert.equal(resolved.worldInfo.domainModelList[0].domain, "nativeThree");
  assert.equal(resolved.worldInfo.domainModelList[0].handler, "parseInline");
  assert.equal(resolved.worldInfo.domainModelList[0].json, sampleNative);
  assert.equal(resolved.label, "demo");
});

test("resolveScenePayloadForLoad leaves ThreeJSON payloads unchanged", () => {
  const threeJson = buildMinimalWorldJsonForNativeThreeInline(sampleNative);
  const again = resolveScenePayloadForLoad(threeJson);
  assert.equal(again, threeJson);
});

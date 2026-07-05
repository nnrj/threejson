import { test } from "node:test";
import assert from "node:assert/strict";
import { inferSystemBucketTags } from "../core/handler/inferSystemBucketTags.js";
import {
  addSystemBucketTag,
  assignCustomBucket,
  clearAllBucketIndexes,
  getSystemBucketTagsForThreeJsonId,
  getThreeJsonIdsInCustomBucket,
  getThreeJsonIdsInSystemBucket,
  removeSystemBucketTag,
  syncBucketIndexesForRecord
} from "../core/handler/bucketIndex.js";
import {
  clearObjectRegistry,
  getObjectByThreeJsonId,
  registerObject,
  unregisterObject
} from "../core/handler/objectRegistry.js";
import { getObjectsInSystemBucket } from "../core/util/bucketQuery.js";

test("inferSystemBucketTags multi-tag for domain and models", () => {
  assert.deepEqual(inferSystemBucketTags({ objType: "domain" }), ["domain", "objects"]);
  assert.deepEqual(inferSystemBucketTags({ objType: "skinned" }), ["models", "objects"]);
  assert.deepEqual(inferSystemBucketTags({ objType: "box" }), ["objects"]);
  assert.deepEqual(inferSystemBucketTags({ objType: "gridHelper" }), ["assist"]);
  assert.deepEqual(inferSystemBucketTags({ objType: "light" }), ["environment"]);
  assert.deepEqual(inferSystemBucketTags({ objType: "native" }), ["native-record", "objects"]);
  assert.deepEqual(inferSystemBucketTags({}, { isRuntimeSpawn: true }), ["temp"]);
});

test("system bucket allows multiple tags per threeJsonId", () => {
  clearAllBucketIndexes();
  addSystemBucketTag("tj-a", "objects");
  addSystemBucketTag("tj-a", "models");
  assert.deepEqual(getSystemBucketTagsForThreeJsonId("tj-a").sort(), ["models", "objects"]);
  assert.ok(getThreeJsonIdsInSystemBucket("system:models").includes("tj-a"));
  removeSystemBucketTag("tj-a", "models");
  assert.deepEqual(getSystemBucketTagsForThreeJsonId("tj-a"), ["objects"]);
});

test("registerObject syncs bucket tags from descriptor", () => {
  clearObjectRegistry();
  const mesh = { uuid: "u1", name: "m1", userData: {} };
  registerObject(mesh, { objType: "box", threeJsonId: "tj-box-1", name: "m1" }, { recursive: false });
  assert.deepEqual(getSystemBucketTagsForThreeJsonId("tj-box-1"), ["objects"]);
  unregisterObject(mesh, { recursive: false });
  assert.deepEqual(getSystemBucketTagsForThreeJsonId("tj-box-1"), []);
});

test("customBucket local and global map", () => {
  clearAllBucketIndexes();
  syncBucketIndexesForRecord("tj-1", { objType: "box", customBucket: "layer-a" });
  assert.deepEqual(getThreeJsonIdsInCustomBucket("layer-a"), ["tj-1"]);
  clearAllBucketIndexes();
  syncBucketIndexesForRecord(
    "tj-2",
    { objType: "box", threeJsonId: "tj-2" },
    { customBuckets: { BBB: ["tj-2", "tj-x"] } }
  );
  assert.deepEqual(getThreeJsonIdsInCustomBucket("BBB"), ["tj-2"]);
});

test("getObjectsInSystemBucket resolves registry", () => {
  clearObjectRegistry();
  const obj = { uuid: "u2", name: "m2", userData: {} };
  registerObject(obj, { objType: "domain", threeJsonId: "tj-d1" }, { recursive: false });
  const list = getObjectsInSystemBucket("domain");
  assert.equal(list.length, 1);
  assert.equal(getObjectByThreeJsonId("tj-d1"), obj);
});

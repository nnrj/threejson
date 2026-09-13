import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { trackDisposableResource, getTrackedResourceBucketForDispose } from "../core/handler/trackedResourceRegistry.js";
import { createRuntimeSceneSession, executeSceneSessionCommands } from "../core/session.js";

test("disposing individual resources removes them from the diagnostic index", () => {
  const bucket = getTrackedResourceBucketForDispose(), before = bucket.size;
  for (let i = 0; i < 60; i++) {
    const resource = trackDisposableResource(new THREE.BoxGeometry());
    assert.equal(bucket.has(resource), true); resource.dispose(); assert.equal(bucket.has(resource), false);
  }
  assert.equal(bucket.size, before);
});

test("repeated atomic material/geometry replacement does not accumulate retired resources", async () => {
  const session = await createRuntimeSceneSession({ objectList: [{ objType: "box", threeJsonId: "one", material: { color: "red" } }] });
  const bucket = getTrackedResourceBucketForDispose();
  try {
    const before = bucket.size;
    for (let i = 0; i < 30; i++) {
      const result = await executeSceneSessionCommands(session, [{ op: "object.patch", args: { id: "one", partial: {
        material: { color: i % 2 ? "blue" : "green" }, geometry: { width: i + 1 }
      } } }]);
      assert.equal(result.ok, true, result.error);
    }
    assert.ok(bucket.size <= before + 6, `live resource index grew from ${before} to ${bucket.size}`);
  } finally { session.dispose(); }
});

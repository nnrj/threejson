import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  collectBoxHelperBindings,
  collectBoxHelperTargetIds,
  deployBoundBoxHelpersFromPayload
} from "../core/handler/boxHelperDeploy.js";
import { inferSystemBucketTags } from "../core/handler/inferSystemBucketTags.js";
import { registerObject, rebuildObjectRegistryFromScene } from "../core/handler/objectRegistry.js";
import { normalizeHelpersConfig } from "../core/builder/sceneHelperBuilder.js";
import { filterNonPassRecords } from "../core/handler/postProcessPassDeploy.js";

test("normalizeHelpersConfig ignores legacy helpers.boxHelper", () => {
  const cfg = normalizeHelpersConfig(
    { helpers: { grid: { size: 10 }, boxHelper: { color: "#fff" } } },
    {}
  );
  assert.ok(cfg?.grid);
  assert.equal(cfg.boxHelper, undefined);
});

test("collectBoxHelperTargetIds merges single and array fields", () => {
  assert.deepEqual(collectBoxHelperTargetIds({ targetThreeJsonId: "a" }), ["a"]);
  assert.deepEqual(
    collectBoxHelperTargetIds({ targetThreeJsonIds: ["a", "b"], targetThreeJsonId: "c" }),
    ["a", "b", "c"]
  );
});

test("collectBoxHelperBindings expands standalone and inline records", () => {
  const bindings = collectBoxHelperBindings({
    objectList: [
      {
        objType: "box",
        threeJsonId: "tj-wall",
        boxHelper: { color: "#111111", visible: false }
      },
      {
        objType: "boxHelper",
        threeJsonId: "bh-group",
        targetThreeJsonIds: ["tj-wall", "tj-door"],
        color: "#222222"
      }
    ]
  });
  assert.equal(bindings.length, 3);
  const inline = bindings.find((b) => b.helperThreeJsonId === "tj-wall@boxHelper");
  assert.ok(inline);
  assert.equal(inline.targetThreeJsonId, "tj-wall");
  assert.equal(inline.visible, false);
  assert.equal(inline.color, "#111111");
  const expanded = bindings.find((b) => b.helperThreeJsonId === "bh-group@tj-door");
  assert.ok(expanded);
  assert.equal(expanded.source, "record");
});

test("deployBoundBoxHelpersFromPayload creates hidden helpers and registers assist bucket", () => {
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial()
  );
  mesh.userData.objJson = { objType: "box", threeJsonId: "tj-box-1" };
  scene.add(mesh);
  registerObject(mesh, mesh.userData.objJson, { recursive: false });
  rebuildObjectRegistryFromScene(scene);

  const deployed = deployBoundBoxHelpersFromPayload(scene, {
    objectList: [
      {
        objType: "boxHelper",
        threeJsonId: "bh-1",
        targetThreeJsonId: "tj-box-1",
        visible: false,
        color: "#E59520"
      }
    ]
  });

  assert.equal(deployed.length, 1);
  assert.equal(deployed[0].visible, false);
  assert.equal(deployed[0].userData.objJson.objType, "boxHelper");
  assert.equal(deployed[0].userData.objJson.threeJsonId, "bh-1@tj-box-1");
  assert.deepEqual(inferSystemBucketTags({ objType: "boxHelper" }), ["assist"]);
});

test("filterNonPassRecords excludes boxHelper records from canonical deploy", () => {
  const out = filterNonPassRecords([
    { objType: "box", threeJsonId: "a" },
    { objType: "boxHelper", threeJsonId: "bh" },
    { objType: "pass", passType: "outline" }
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].objType, "box");
});

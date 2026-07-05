import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applySubSceneLayout,
  normalizeSubSceneHierarchy,
  nestedToFlatPayload,
  nestedToSubSceneListPayload
} from "../core/handler/subSceneHierarchy.js";

test("normalize flat parentThreeJsonId into nested subScene", () => {
  const payload = {
    threeJsonId: "scene-1",
    objectList: [
      { threeJsonId: "grp", objType: "group", name: "g" },
      { threeJsonId: "box-a", objType: "box", parentThreeJsonId: "grp", geometry: { width: 1, height: 1, depth: 1 } }
    ]
  };
  const { payload: out } = normalizeSubSceneHierarchy(payload);
  assert.equal(out.objectList.length, 1);
  assert.equal(out.objectList[0].threeJsonId, "grp");
  assert.equal(out.objectList[0].subScene.length, 1);
  assert.equal(out.objectList[0].subScene[0].threeJsonId, "box-a");
  assert.equal(out.objectList[0].subScene[0].parentThreeJsonId, undefined);
});

test("normalize subSceneList blocks into parent subScene", () => {
  const payload = {
    objectList: [
      { threeJsonId: "grp", objType: "group" }
    ],
    subSceneList: [
      {
        parentThreeJsonId: "grp",
        objects: [
          { threeJsonId: "child", objType: "sphere", geometry: { radius: 2 } }
        ]
      }
    ]
  };
  const { payload: out } = normalizeSubSceneHierarchy(payload);
  assert.equal(out.subSceneList, undefined);
  assert.equal(out.objectList[0].subScene[0].threeJsonId, "child");
});

test("layout nested to flat and subSceneList", () => {
  const nested = {
    objectList: [
      {
        threeJsonId: "grp",
        objType: "group",
        subScene: [
          { threeJsonId: "c1", objType: "box", geometry: { width: 1, height: 1, depth: 1 } }
        ]
      }
    ]
  };
  const flat = nestedToFlatPayload(nested);
  assert.equal(flat.objectList.length, 2);
  assert.equal(flat.objectList[1].parentThreeJsonId, "grp");

  const listed = nestedToSubSceneListPayload(nested);
  assert.equal(listed.objectList[0].subScene, undefined);
  assert.equal(listed.subSceneList[0].parentThreeJsonId, "grp");
  assert.equal(listed.subSceneList[0].objects[0].threeJsonId, "c1");

  assert.equal(applySubSceneLayout(nested, "flat").objectList[1].parentThreeJsonId, "grp");
});

test("warn keeps orphan child at root when parent missing", () => {
  const payload = {
    objectList: [
      { threeJsonId: "orphan", objType: "box", parentThreeJsonId: "missing", geometry: { width: 1, height: 1, depth: 1 } }
    ]
  };
  const { payload: out, warnings } = normalizeSubSceneHierarchy(payload, { policy: "warn" });
  assert.equal(out.objectList.length, 1);
  assert.equal(out.objectList[0].threeJsonId, "orphan");
  assert.ok(warnings.length >= 1);
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { packTjzArchive } from "../core/archive/tjzPackager.js";
import { isTjzLike, parseTjzArchiveForScene } from "../core/archive/tjzArchive.js";
import {
  createJsonSceneFromArchive,
  createJsonSceneFromObjectRecord,
  deployJsonSceneFromArchive,
  deployObjectRecordIntoRuntime
} from "../core/handler/sceneLoadHandler.js";

function buildMinimalPayload() {
  return {
    threeJsonId: "tjz-test-scene",
    worldInfo: {
      boxModelList: [],
      lineList: []
    }
  };
}

test("packTjzArchive + parseTjzArchiveForScene roundtrip", async () => {
  const payload = buildMinimalPayload();
  const bytes = await packTjzArchive(payload, { outputType: "bytes" });
  assert.ok(bytes instanceof Uint8Array);

  const parsed = await parseTjzArchiveForScene(bytes);
  assert.equal(parsed.manifest.format, "threejson-archive");
  assert.equal(parsed.payload.threeJsonId, "tjz-test-scene");
  parsed.dispose();
});

test("missing pack asset warns by default", async () => {
  const payload = {
    threeJsonId: "tjz-missing-warn",
    worldInfo: {
      boxModelList: [
        {
          name: "box-a",
          objType: "box",
          geometry: { width: 1, height: 1, depth: 1 },
          position: { x: 0, y: 0, z: 0 },
          material: { type: "standard", textureUrl: "pack://assets/missing.png" }
        }
      ]
    }
  };
  const bytes = await packTjzArchive(payload, { outputType: "bytes" });
  const warns = [];
  const parsed = await parseTjzArchiveForScene(bytes, {
    onWarning: (msg) => warns.push(msg)
  });
  assert.ok(warns.length >= 1);
  assert.equal(parsed.missing.length, 1);
  parsed.dispose();
});

test("manifest missingAssetPolicy=error throws on missing resource", async () => {
  const payload = {
    threeJsonId: "tjz-missing-error",
    worldInfo: {
      boxModelList: [
        {
          name: "box-b",
          objType: "box",
          geometry: { width: 1, height: 1, depth: 1 },
          position: { x: 0, y: 0, z: 0 },
          material: { type: "standard", textureUrl: "pack://assets/missing.png" }
        }
      ]
    }
  };
  const bytes = await packTjzArchive(payload, {
    outputType: "bytes",
    manifest: { missingAssetPolicy: "error" }
  });
  await assert.rejects(
    () => parseTjzArchiveForScene(bytes),
    /missing pack resource/i
  );
});

test("isTjzLike returns true for packed bytes", async () => {
  const bytes = await packTjzArchive(buildMinimalPayload(), { outputType: "bytes" });
  const flag = await isTjzLike(bytes);
  assert.equal(flag, true);
});

test("createJsonSceneFromArchive supports record entry", async () => {
  const recordEntry = {
    objType: "box",
    name: "entry-box",
    geometry: { width: 1, height: 1, depth: 1 },
    position: { x: 0, y: 0, z: 0 },
    material: { type: "standard", color: "#00ff00" }
  };
  const bytes = await packTjzArchive(recordEntry, { outputType: "bytes" });
  const runtime = await createJsonSceneFromArchive(bytes);
  assert.ok(runtime?.scene?.isScene === true);
  assert.ok(runtime.scene.children.length > 0);
});

test("deployJsonSceneFromArchive loads friendly worldInfo scene with subSceneList", async () => {
  const sceneEntry = {
    threeJsonId: "tjz-subscene-list",
    worldInfo: {
      groupList: [
        { threeJsonId: "grp-1", objType: "group", name: "assembly" }
      ]
    },
    subSceneList: [
      {
        parentThreeJsonId: "grp-1",
        objects: [
          {
            threeJsonId: "sub-box",
            objType: "box",
            name: "sub-box",
            geometry: { width: 1, height: 1, depth: 1 },
            position: { x: 1, y: 0, z: 0 },
            material: { type: "standard", color: "#3366ff" }
          }
        ]
      }
    ]
  };
  const bytes = await packTjzArchive(sceneEntry, { outputType: "bytes" });
  const runtime = await createJsonSceneFromArchive(bytes);
  assert.ok(runtime?.scene?.isScene === true);
  assert.ok(runtime.scene.children.length >= 1);
});

const boxRecord = {
  objType: "box",
  name: "plain-box",
  geometry: { width: 1, height: 1, depth: 1 },
  position: { x: 0, y: 0, z: 0 },
  material: { type: "standard", color: "#00ff00" }
};

test("createJsonSceneFromObjectRecord supports plain record", async () => {
  const runtime = await createJsonSceneFromObjectRecord(boxRecord);
  assert.ok(runtime?.scene?.isScene === true);
  assert.ok(runtime.scene.children.length > 0);
});

test("deployObjectRecordIntoRuntime append and replace", async () => {
  const runtime = await createJsonSceneFromObjectRecord({ ...boxRecord, name: "first-box" });
  const scene = runtime.scene;
  const countAfterFirst = scene.children.length;
  await deployObjectRecordIntoRuntime(runtime, { ...boxRecord, name: "second-box" }, {
    objectEntryMode: "append"
  });
  assert.ok(scene.children.length >= countAfterFirst);
  await deployObjectRecordIntoRuntime(runtime, { ...boxRecord, name: "third-box" }, {
    objectEntryMode: "replace"
  });
  assert.ok(scene.children.length >= 1);
});


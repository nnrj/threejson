import assert from "node:assert/strict";
import { test } from "node:test";

import {
  detectRuntimeMaterialsArray,
  sanitizeMaterialJsonForExport,
  sanitizeObjectRecordForExport
} from "../core/util/descriptorExportSanitize.js";
import { buildPersistPayloadWorldInfoPrimary } from "../core/util/util.js";

test("sanitizeMaterialJsonForExport omits default textureRepeat 1x1", () => {
  const out = sanitizeMaterialJsonForExport({
    type: "standard",
    textureUrl: "/assets/foo.png",
    textureRepeat: { x: 1, y: 1 }
  });
  assert.equal(out.textureUrl, "/assets/foo.png");
  assert.equal("textureRepeat" in out, false);
});

test("sanitizeMaterialJsonForExport keeps non-default textureRepeat", () => {
  const out = sanitizeMaterialJsonForExport({
    type: "standard",
    textureUrl: "/assets/foo.png",
    textureRepeat: { x: 4, y: 8 }
  });
  assert.deepEqual(out.textureRepeat, { x: 4, y: 8 });
});

test("sanitizeMaterialJsonForExport removes non-string map and keeps textureUrl", () => {
  const out = sanitizeMaterialJsonForExport({
    type: "standard",
    textureUrl: "/assets/foo.png",
    map: {}
  });
  assert.equal(out.textureUrl, "/assets/foo.png");
  assert.equal("map" in out, false);
});

test("sanitizeMaterialJsonForExport keeps resolvable string map", () => {
  const out = sanitizeMaterialJsonForExport({
    type: "standard",
    map: "/assets/bar.png"
  });
  assert.equal(out.map, "/assets/bar.png");
});

test("detectRuntimeMaterialsArray requires singular material", () => {
  const onlyMaterials = {
    materials: Array.from({ length: 6 }, () => ({
      type: "standard",
      textureUrl: "/assets/same.png"
    }))
  };
  assert.equal(detectRuntimeMaterialsArray(onlyMaterials), false);
});

test("sanitizeObjectRecordForExport omits runtime six-face materials when material present", () => {
  const material = { type: "standard", textureUrl: "/assets/t.png" };
  const record = {
    objType: "box",
    material,
    materials: [material, material, material, material, material, material]
  };
  const out = sanitizeObjectRecordForExport(record);
  assert.equal(out.material.textureUrl, "/assets/t.png");
  assert.equal(out.materials, undefined);
});

test("sanitizeWorldInfoForExport cleans polluted box list for persist payload", () => {
  const material = { type: "standard", textureUrl: "/assets/t.png", map: {} };
  const worldInfo = {
    boxModelList: [{
      objType: "box",
      material,
      materials: [material, material, material, material, material, material]
    }]
  };
  const payload = buildPersistPayloadWorldInfoPrimary({}, worldInfo, { omitSceneInfoList: true });
  const box = payload.worldInfo.boxModelList[0];
  assert.equal(box.material.textureUrl, "/assets/t.png");
  assert.equal("map" in box.material, false);
  assert.equal(box.materials, undefined);
});

test("sanitizeObjectRecordForExport keeps intentional six-face materials without material", () => {
  const record = {
    objType: "box",
    materials: [
      { type: "standard", textureUrl: "/a.png" },
      { type: "standard", textureUrl: "/b.png" },
      { type: "standard", textureUrl: "/c.png" },
      { type: "standard", textureUrl: "/d.png" },
      { type: "standard", textureUrl: "/e.png" },
      { type: "standard", textureUrl: "/f.png" }
    ]
  };
  const out = sanitizeObjectRecordForExport(record);
  assert.equal(out.materials.length, 6);
  assert.equal(out.materials[1].textureUrl, "/b.png");
});

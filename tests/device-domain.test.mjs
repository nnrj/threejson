import { test } from "node:test";
import assert from "node:assert/strict";

import { generatedBusinessDomainDescriptors } from "../builtins/builtinDomainManifest.generated.js";
import { createCabinetJson } from "../domains/device/cabinet/cabinetFactory.js";
import { normalizeCabinetDomainRecord } from "../domains/device/cabinet/index.js";
import {
  computeDeviceCenterY,
  getUUsage,
  isUSlotRangeFree
} from "../domains/device/deviceShared.js";
import { createUpsJson } from "../domains/device/ups/upsFactory.js";

test("device domains registered in manifest", () => {
  const ids = generatedBusinessDomainDescriptors.map((d) => d.id);
  for (const id of [
    "device",
    "device.cabinet",
    "device.server",
    "device.switch",
    "device.airConditioner",
    "device.ups"
  ]) {
    assert.ok(ids.includes(id), `missing domain ${id}`);
  }
});

test("computeDeviceCenterY uses 1-based bottom U", () => {
  const slots = { total: 9, unitHeight: 1, bottomMargin: 0 };
  assert.equal(computeDeviceCenterY(slots, 1, 1), 0.5);
  assert.equal(computeDeviceCenterY(slots, 2, 2), 2);
});

test("isUSlotRangeFree detects overlap", () => {
  const devices = [{ uStart: 10, uSize: 2 }, { uStart: 20, uSize: 1 }];
  assert.equal(isUSlotRangeFree(devices, 11, 1), false);
  assert.equal(isUSlotRangeFree(devices, 15, 2), true);
});

test("createCabinetJson builds deviceCabinet group", () => {
  const json = createCabinetJson({
    name: "rack-a",
    geometry: { width: 6, length: 12, height: 20 },
    slots: { total: 9, unitHeight: 0.48, bottomMargin: 0.77 },
    devices: [{ deviceType: "server", uStart: 28, uSize: 2, name: "srv" }]
  });
  assert.equal(json.objType, "deviceCabinet");
  assert.ok(Array.isArray(json.subScene) && json.subScene.length > 0);
});

test("device.cabinet dispatcher preserves payload position and outer identity", () => {
  const normalized = normalizeCabinetDomainRecord({
    threeJsonId: "rack-payload-1",
    objType: "domain",
    domain: "device.cabinet",
    handler: "createCabinet",
    payload: {
      name: "cabinet",
      geometry: { width: 6, length: 12, height: 20 },
      position: { x: 18, y: 0, z: -12 }
    }
  });
  assert.equal(normalized.threeJsonId, "rack-payload-1");
  assert.deepEqual(normalized.geometry, { width: 6, length: 12, height: 20 });
  assert.deepEqual(normalized.position, { x: 18, y: 0, z: -12 });
  assert.equal(normalized.payload, undefined);
});

test("createUpsJson with glass door", () => {
  const json = createUpsJson({
    geometry: { width: 8, length: 10, height: 16 },
    door: { panelKind: "glass", swing: "right" }
  });
  assert.equal(json.objType, "deviceUps");
  assert.ok(Array.isArray(json.subScene) && json.subScene.length > 0);
});

test("getUUsage from devices", () => {
  const usage = getUUsage({
    slots: { total: 9 },
    devices: [{ uStart: 1, uSize: 2 }, { uStart: 5, uSize: 1 }]
  });
  assert.equal(usage.used, 3);
  assert.equal(usage.total, 9);
});

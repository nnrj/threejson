import assert from "node:assert/strict";
import { test } from "node:test";

import "../builtins/register.js";
import {
  capturePersistDescriptor,
  mergePersistDescriptor
} from "../domains/device/cabinet/cabinetPersist.js";

test("mergePersistDescriptor: rich base + poor fresh keeps doors and applies transforms", () => {
  const base = {
    name: "cabinet",
    label: "机柜A",
    businessInfo: { cabNum: "01" },
    doors: [{ side: "front", type: "right" }],
    devices: [{ name: "服务器1" }],
    geometry: { width: 6, length: 12, height: 20 }
  };
  const fresh = {
    name: "cabinet",
    label: "机柜A",
    businessInfo: { cabNum: "01" },
    objType: "deviceCabinet",
    boxModelList: [{ name: "cabinetBottom" }],
    position: { x: 1, y: 2, z: 3 },
    rotation: { rotationX: 0.1, rotationY: 0.2, rotationZ: 0.3 },
    scale: { scaleX: 2, scaleY: 2, scaleZ: 2 }
  };
  const merged = mergePersistDescriptor(base, fresh);
  assert.equal(merged.doors?.length, 1);
  assert.equal(merged.devices?.length, 1);
  assert.equal(merged.position.x, 1);
  assert.equal(merged.rotation.rotationY, 0.2);
  assert.equal(merged.scale.scaleZ, 2);
});

test("mergePersistDescriptor: rich fresh replaces base shell", () => {
  const base = {
    name: "cabinet",
    label: "机柜B",
    objType: "deviceCabinet",
    boxModelList: [{ name: "cabinetBottom" }]
  };
  const fresh = {
    name: "cabinet",
    label: "机柜B",
    doors: [{ side: "back" }],
    devices: [{ name: "交换机" }]
  };
  const merged = mergePersistDescriptor(base, fresh);
  assert.equal(merged.doors?.length, 1);
  assert.equal(merged.devices?.length, 1);
});

test("capturePersistDescriptor: instance persistSource with scene transforms", () => {
  const object3D = {
    position: { x: 10, y: 20, z: 30 },
    rotation: { x: 0.5, y: 1.0, z: 1.5 },
    scale: { x: 2, y: 3, z: 4 },
    userData: {
      persistSource: {
        objType: "domain",
        domain: "device.cabinet",
        handler: "createCabinet",
        name: "cabinet",
        label: "机柜C",
        businessInfo: { cabNum: "03" },
        geometry: { width: 6, length: 12, height: 20 }
      },
      objJson: {
        objType: "domain",
        domain: "device.cabinet",
        handler: "createCabinet",
        name: "cabinet",
        label: "机柜C",
        businessInfo: { cabNum: "03" },
        geometry: { width: 6, length: 12, height: 20 }
      }
    }
  };
  const captured = capturePersistDescriptor(object3D);
  assert.ok(captured);
  assert.equal(captured.objType, "domain");
  assert.equal(captured.domain, "device.cabinet");
  assert.equal(captured.name, "cabinet");
  assert.equal(captured.label, "机柜C");
  assert.equal(captured.position.x, 10);
  assert.equal(captured.rotation.rotationZ, 1.5);
  assert.equal(captured.scale.scaleY, 3);
});

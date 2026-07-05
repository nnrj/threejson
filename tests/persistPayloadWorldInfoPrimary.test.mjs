import assert from "node:assert/strict";
import { test } from "node:test";

import "../builtins/register.js";
import {
  buildPersistPayloadWorldInfoPrimary,
  mergeWorldInfoModelListByIdentity
} from "../core/util/util.js";

test("mergeWorldInfoModelListByIdentity: empty fresh preserves base boxModelList", () => {
  const base = [
    { name: "device-a", materials: [{ textureUrl: "/a.png" }] },
    { name: "device-b", materials: [{ textureUrl: "/b.png" }] }
  ];
  const merged = mergeWorldInfoModelListByIdentity(base, []);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].name, "device-a");
});

test("buildPersistPayloadWorldInfoPrimary: empty scene lists do not wipe base boxModelList", () => {
  const root = {
    threeJsonId: "persist-test",
    worldInfo: {
      boxModelList: [
        { name: "device-a", objType: "box", materials: [{ textureUrl: "/assets/test/a.png" }] },
        { name: "device-b", objType: "box", materials: [{ textureUrl: "/assets/test/b.jpg" }] }
      ],
      domainModelList: [{ domain: "device.cabinet", handler: "deployCabinet", items: [{ name: "rack-1" }] }]
    }
  };
  const fromScene = {
    boxModelList: [],
    groupList: [{ name: "wrapperGroup", objType: "group" }],
    domainModelList: []
  };
  const out = buildPersistPayloadWorldInfoPrimary(root, fromScene, { omitSceneInfoList: true });
  assert.equal(out.worldInfo.boxModelList.length, 2);
  assert.equal(out.worldInfo.boxModelList.find((b) => b.name === "device-a")?.materials?.[0]?.textureUrl, "/assets/test/a.png");
  assert.equal(out.worldInfo.domainModelList.length, 1);
  assert.equal(out.worldInfo.domainModelList[0].domain, "device.cabinet");
});

test("buildPersistPayloadWorldInfoPrimary: same-name cabinets keep distinct positions via cabNum merge key", () => {
  const root = {
    threeJsonId: "persist-test",
    worldInfo: {
      domainModelList: [
        {
          domain: "device.cabinet",
          handler: "createCabinet",
          items: [
            {
              name: "测试新机柜",
              businessInfo: { cabNum: "01" },
              doors: [{ side: "front" }],
              position: { x: 10, y: 0, z: 0 }
            },
            {
              name: "测试新机柜",
              businessInfo: { cabNum: "02" },
              doors: [{ side: "front" }],
              position: { x: 20, y: 0, z: 0 }
            }
          ]
        }
      ]
    }
  };
  const fromScene = {
    domainModelList: [
      {
        domain: "device.cabinet",
        handler: "createCabinet",
        items: [
          {
            name: "测试新机柜",
            businessInfo: { cabNum: "01" },
            objType: "deviceCabinet",
            boxModelList: [{ name: "cabinetBottom" }],
            position: { x: 11, y: 1, z: 1 }
          },
          {
            name: "测试新机柜",
            businessInfo: { cabNum: "02" },
            objType: "deviceCabinet",
            boxModelList: [{ name: "cabinetBottom" }],
            position: { x: 21, y: 1, z: 1 }
          }
        ]
      }
    ]
  };
  const out = buildPersistPayloadWorldInfoPrimary(root, fromScene, { omitSceneInfoList: true });
  const items = out.worldInfo.domainModelList[0].items;
  assert.equal(items.length, 2);
  assert.equal(items[0].position.x, 11);
  assert.equal(items[1].position.x, 21);
  assert.equal(items[0].doors?.length, 1);
  assert.equal(items[1].doors?.length, 1);
});

test("buildPersistPayloadWorldInfoPrimary: poor fresh cabinet shell does not strip doors from base", () => {
  const root = {
    threeJsonId: "persist-test",
    worldInfo: {
      domainModelList: [
        {
          domain: "device.cabinet",
          handler: "createCabinet",
          items: [
            {
              name: "cabinet",
              label: "机柜A",
              businessInfo: { cabNum: "01" },
              doors: [{ side: "front", type: "right" }],
              devices: [{ name: "服务器1", textureUrl: "/t.jpg" }],
              geometry: { width: 6, length: 12, height: 20 }
            }
          ]
        }
      ]
    }
  };
  const fromScene = {
    domainModelList: [
      {
        domain: "device.cabinet",
        handler: "createCabinet",
        items: [
          {
            name: "cabinet",
            label: "机柜A",
            businessInfo: { cabNum: "01" },
            objType: "deviceCabinet",
            boxModelList: [{ name: "cabinetBottom" }],
            position: { x: 1, y: 2, z: 3 }
          }
        ]
      }
    ]
  };
  const out = buildPersistPayloadWorldInfoPrimary(root, fromScene, { omitSceneInfoList: true });
  const item = out.worldInfo.domainModelList[0].items[0];
  assert.equal(item.doors?.length, 1);
  assert.equal(item.devices?.length, 1);
  assert.equal(item.position.x, 1);
});

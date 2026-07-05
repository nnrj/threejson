import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import {
  sceneToStandardJson,
  sceneToStandardJsonSimple,
  sceneToFriendlyJson,
  collectObjectListFromScene
} from "../core/util/sceneToJson.js";
import { initBusinessDomains } from "../core/handler/businessDomainRegistry.js";
import {
  detectScenePayloadViewFormat,
  isCanonicalScenePayload,
  isLoadableScenePayload,
  normalizeScenePayload
} from "../core/handler/sceneFriendlyNormalizer.js";
import { JSON_ORIGIN_CONFIG, JSON_ORIGIN_LIST } from "../core/util/sceneJsonOrigin.js";

function makeSceneWithBox() {
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  mesh.userData.objJson = {
    objType: "box",
    name: "scene-box",
    threeJsonId: "scene-box-1",
    geometry: { width: 1, height: 1, depth: 1 },
    position: { x: 0, y: 0, z: 0 },
    material: { type: "standard", color: "#ffffff" }
  };
  scene.add(mesh);
  return scene;
}

test("collectObjectListFromScene reads deploy root objJson", () => {
  const scene = makeSceneWithBox();
  const list = collectObjectListFromScene(scene);
  assert.equal(list.length, 1);
  assert.equal(list[0].threeJsonId, "scene-box-1");
  assert.equal(list[0].objType, "box");
});

test("collectObjectListFromScene exports door deploy root as flat instance at hinge position", () => {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  const doorRecord = {
    objType: "door",
    domain: "door",
    handler: "addToScene",
    name: "glass-door",
    threeJsonId: "door-export-1",
    doorType: "left",
    glassKind: "clear",
    geometry: { width: 0.2, depth: 5, height: 19 },
    position: { x: 0, y: 0, z: 0 },
    rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
    scale: { scaleX: 1, scaleY: 1, scaleZ: 1 }
  };
  group.userData.objJson = doorRecord;
  group.userData.persistSource = { ...doorRecord };
  group.position.set(1, 2, 3);
  scene.add(group);
  const list = collectObjectListFromScene(scene);
  assert.equal(list.length, 1);
  assert.equal(list[0].objType, "door");
  assert.equal(list[0].domain, "door");
  assert.equal(list[0].position.x, 1);
  assert.equal(list[0].position.y, 2);
  assert.equal(list[0].position.z, 3);
  assert.equal(list[0].items, undefined);
});

test("collectObjectListFromScene keeps instance box Group exported as box", () => {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  group.userData.objJson = {
    objType: "box",
    name: "空调",
    instance: true,
    transforms: [
      { position: { x: 1, y: 2, z: 3 }, rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 }, scale: { scaleX: 1, scaleY: 1, scaleZ: 1 } }
    ],
    geometry: { width: 6, height: 20, depth: 12 }
  };
  scene.add(group);
  const list = collectObjectListFromScene(scene);
  assert.equal(list.length, 1);
  assert.equal(list[0].objType, "box");
  assert.equal(list[0].instance, true);
  assert.equal(list[0].transforms.length, 1);
});

test("sceneToStandardJsonSimple default options omit top-level subSceneList", () => {
  const scene = makeSceneWithBox();
  const payload = sceneToStandardJsonSimple(scene);
  assert.equal(payload.subSceneList, undefined);
});

test("sceneToStandardJson produces objectList and sceneConfig with jsonOrigin", async () => {
  const scene = makeSceneWithBox();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(1, 2, 3);
  scene.add(camera);
  const payload = await sceneToStandardJson(scene, {
    runtimeTarget: { scene, camera }
  });
  assert.ok(Array.isArray(payload.objectList));
  assert.equal(payload.objectList.length, 1);
  assert.ok(payload.sceneConfig?.camera?.position);
  assert.equal(payload.sceneConfig.camera.jsonOrigin, JSON_ORIGIN_CONFIG);
  assert.equal(payload.saveMeta?.exportMode, "standard_primary");
});

test("collectObjectListFromScene preserves externalModel modelPath for OBJ snapshot reload", () => {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  group.name = "巡洋舰-泊1";
  group.position.set(-101, 10, -467);
  group.userData.objJson = {
    objType: "externalModel",
    name: "巡洋舰-泊1",
    threeJsonId: "cruiser-ship-1",
    modelPath: "/assets/model/obj/cruiser_ship_2012/Cruiser 2012.obj",
    mtlPath: "/assets/model/obj/cruiser_ship_2012/Cruiser_2012.mtl",
    modelFileType: "obj",
    position: { x: -101, y: 10, z: -467 },
    rotation: { rotationX: 0, rotationY: -1.57, rotationZ: 0 },
    scale: { scaleX: 0.36, scaleY: 0.36, scaleZ: 0.36 }
  };
  scene.add(group);
  const list = collectObjectListFromScene(scene);
  assert.equal(list.length, 1);
  assert.equal(list[0].objType, "externalModel");
  assert.ok(String(list[0].modelPath).includes("cruiser_ship_2012"));
  assert.equal(list[0].position.y, 10);
});

test("sceneToFriendlyJson includes worldInfo", async () => {
  const scene = makeSceneWithBox();
  const friendly = await sceneToFriendlyJson(scene);
  assert.ok(friendly.worldInfo);
  assert.ok(Array.isArray(friendly.worldInfo.meshList) && friendly.worldInfo.meshList.length === 1);
});

test("working standard payload passes load validation shape", async () => {
  const scene = makeSceneWithBox();
  const payload = await sceneToStandardJson(scene);
  assert.equal(isCanonicalScenePayload(payload), false);
  assert.ok(payload.sceneConfig);
  assert.ok(Array.isArray(payload.objectList) && payload.objectList.length > 0);
  const normalized = normalizeScenePayload(payload);
  assert.equal(normalized.objectList.length, payload.objectList.length);
});

test("normalize merges sceneConfig camera when objectList has duplicate camera", () => {
  const payload = {
    version: "next",
    sceneConfig: {
      camera: {
        threeJsonId: "main-cam",
        fov: 60,
        position: { x: 0, y: 2, z: 5 }
      }
    },
    objectList: [
      {
        objType: "camera",
        threeJsonId: "main-cam",
        fov: 45,
        position: { x: 1, y: 1, z: 1 }
      },
      {
        objType: "box",
        threeJsonId: "box-1",
        name: "floor",
        geometry: { width: 1, height: 1, depth: 1 }
      }
    ]
  };
  const normalized = normalizeScenePayload(payload);
  const cameras = normalized.objectList.filter((r) => r.objType === "camera");
  assert.equal(cameras.length, 1);
  assert.equal(cameras[0].threeJsonId, "main-cam");
  assert.equal(cameras[0].fov, 60);
  assert.equal(cameras[0].jsonOrigin, JSON_ORIGIN_CONFIG);
  assert.equal(normalized.cameraConfig?.fov, 60);
  assert.equal(normalized.objectList.filter((r) => r.objType === "box").length, 1);
});

test("normalize keeps extra camera in objectList when not duplicated in sceneConfig", () => {
  const payload = {
    sceneConfig: {
      camera: { threeJsonId: "main-cam", fov: 60, position: { x: 0, y: 0, z: 5 } }
    },
    objectList: [
      {
        objType: "camera",
        threeJsonId: "overview-cam",
        fov: 40,
        position: { x: 5, y: 5, z: 5 }
      }
    ]
  };
  const normalized = normalizeScenePayload(payload);
  const cameras = normalized.objectList.filter((r) => r.objType === "camera");
  assert.equal(cameras.length, 2);
  assert.equal(cameras[0].threeJsonId, "overview-cam");
  assert.equal(cameras[0].jsonOrigin, JSON_ORIGIN_LIST);
  assert.equal(cameras[1].threeJsonId, "main-cam");
  assert.equal(cameras[1].jsonOrigin, JSON_ORIGIN_CONFIG);
});

test("isLoadableScenePayload accepts sceneConfig-only standard JSON", () => {
  assert.equal(isLoadableScenePayload({
    sceneConfig: { camera: { fov: 60, position: { x: 0, y: 0, z: 5 } } }
  }), true);
  assert.equal(isLoadableScenePayload({ objectList: [] }), false);
});

test("normalize sceneConfig-only payload produces camera config", () => {
  const normalized = normalizeScenePayload({
    sceneConfig: {
      camera: { fov: 55, position: { x: 1, y: 2, z: 3 } }
    }
  });
  assert.equal(normalized.cameraConfig?.fov, 55);
  assert.equal(normalized.objectList.filter((r) => r.objType === "box").length, 0);
  assert.equal(normalized.objectList.filter((r) => r.objType === "camera").length, 1);
});

test("normalize friendly worldInfo with sceneConfig loads content and camera", () => {
  const payload = {
    sceneConfig: {
      camera: {
        fov: 50,
        near: 0.015,
        far: 250,
        position: { x: -88, y: 46.7, z: 49.8 }
      }
    },
    worldInfo: {
      boxModelList: [
        {
          name: "机房地板",
          geometry: { width: 10, height: 0.5, depth: 10 },
          material: { color: "#2F3133" }
        }
      ]
    }
  };
  const normalized = normalizeScenePayload(payload);
  assert.equal(normalized.cameraConfig?.fov, 50);
  assert.equal(normalized.cameraConfig?.position?.x, -88);
  assert.ok(normalized.objectList.some((r) => r.objType === "box" && r.name === "机房地板"));
});

test("detectScenePayloadViewFormat distinguishes friendly and standard payloads", () => {
  assert.equal(detectScenePayloadViewFormat({
    worldInfo: { boxModelList: [] }
  }), "friendly");
  assert.equal(detectScenePayloadViewFormat({
    objectList: [{ objType: "box", threeJsonId: "box-1" }]
  }), "standard");
  assert.equal(detectScenePayloadViewFormat({
    worldInfo: { boxModelList: [] },
    objectList: [{ objType: "box", threeJsonId: "box-1" }]
  }), "standard");
  assert.equal(detectScenePayloadViewFormat({
    sceneConfig: { camera: { fov: 60, position: { x: 0, y: 0, z: 5 } } }
  }), "standard");
});

test("merge keeps base objectList entry when fresh scan empty", async () => {
  const scene = new THREE.Scene();
  const payload = await sceneToStandardJson(scene, {
    basePayload: {
      objectList: [{
        objType: "box",
        threeJsonId: "orphan-1",
        name: "from-base"
      }]
    },
    merge: true
  });
  assert.equal(payload.objectList.length, 1);
  assert.equal(payload.objectList[0].threeJsonId, "orphan-1");
});

function makeCabinetDeployRootOnScene(scene, { threeJsonId, cabNum, childName }) {
  initBusinessDomains();
  const group = new THREE.Group();
  const item = {
    objType: "deviceCabinet",
    name: `cabinet-${cabNum}`,
    threeJsonId,
    cabLabel: cabNum,
    geometry: { width: 6, length: 12, height: 20 },
    position: { x: 0, y: 0, z: 0 }
  };
  group.userData.objJson = {
    objType: "domain",
    domain: "device.cabinet",
    handler: "deployCabinet",
    threeJsonId,
    items: [item]
  };
  const child = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  child.userData.objJson = {
    objType: "box",
    name: childName,
    geometry: { width: 1, height: 1, depth: 1 }
  };
  group.add(child);
  scene.add(group);
}

test("collectObjectListFromScene does not export domain-owned runtime children as subScene", () => {
  const scene = new THREE.Scene();
  makeCabinetDeployRootOnScene(scene, {
    threeJsonId: "cab-1",
    cabNum: "A01",
    childName: "cab-wall"
  });
  const list = collectObjectListFromScene(scene);
  assert.equal(list.length, 1);
  assert.equal(list[0].domain, "device.cabinet");
  assert.equal(list[0].subScene, undefined);
});

test("merge true with friendly combined domain base duplicates per-cabinet fresh captures", async () => {
  const scene = new THREE.Scene();
  makeCabinetDeployRootOnScene(scene, {
    threeJsonId: "cab-1",
    cabNum: "A01",
    childName: "wall-a"
  });
  makeCabinetDeployRootOnScene(scene, {
    threeJsonId: "cab-2",
    cabNum: "A02",
    childName: "wall-b"
  });
  const friendlyBase = {
    sceneConfig: { camera: { fov: 60, position: { x: 0, y: 0, z: 5 } } },
    worldInfo: {
      domainModelList: [{
        domain: "cabinet",
        handler: "createCabinet",
        items: [
          { objType: "deviceCabinet", cabLabel: "A01" },
          { objType: "deviceCabinet", cabLabel: "A02" }
        ]
      }]
    }
  };
  const freshOnly = await sceneToStandardJson(scene, {
    basePayload: friendlyBase,
    merge: false,
    subSceneLayout: "nested"
  });
  assert.equal(freshOnly.objectList.length, 2);

  const merged = await sceneToStandardJson(scene, {
    basePayload: friendlyBase,
    merge: true,
    subSceneLayout: "nested"
  });
  assert.ok(
    merged.objectList.length > freshOnly.objectList.length,
    "incremental merge must not retain combined friendly domain row alongside per-cabinet captures"
  );
});

test("collectObjectListFromScene exports camera-attached ambient audio", () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const audio = new THREE.Group();
  audio.type = "Audio";
  audio.userData = {
    objJson: {
      objType: "audio",
      name: "farewell-bgm",
      threeJsonId: "audio-bgm-1",
      mode: "ambient",
      audioUrl: "/assets/audio/farewell.mp3",
      loop: true,
      volume: 0.5
    },
    threeJsonSceneAudio: true
  };
  camera.add(audio);

  const list = collectObjectListFromScene(scene, { runtimeTarget: { camera, scene } });
  const audioRecord = list.find((item) => item.threeJsonId === "audio-bgm-1");
  assert.ok(audioRecord, "ambient audio on camera should export to objectList");
  assert.equal(audioRecord.objType, "audio");
  assert.equal(audioRecord.mode, "ambient");
  assert.equal(audioRecord.audioUrl, "/assets/audio/farewell.mp3");
});

test("sceneToStandardJsonSimple fullReplace preserves audioList from friendly base when camera scan misses", () => {
  const scene = makeSceneWithBox();
  const camera = new THREE.PerspectiveCamera();
  const basePayload = {
    worldInfo: {
      audioList: [{
        objType: "audio",
        name: "farewell-bgm",
        threeJsonId: "audio-bgm-fallback",
        mode: "ambient",
        audioUrl: "/assets/audio/farewell.mp3",
        loop: true
      }]
    }
  };
  const payload = sceneToStandardJsonSimple(scene, {
    merge: false,
    basePayload,
    runtimeTarget: { camera, scene }
  });
  const audioRecord = payload.objectList.find((item) => item.threeJsonId === "audio-bgm-fallback");
  assert.ok(audioRecord, "fullReplace export should fall back to base worldInfo.audioList");
  assert.equal(audioRecord.objType, "audio");
});

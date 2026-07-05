import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import "../builtins/register.js";
import { businessDomains } from "../core/handler/businessDomainRegistry.js";
import { getObjectByThreeJsonId } from "../core/handler/objectRegistry.js";

test("device.cabinet stat view toggles per-cabinet overlay", () => {
  const scene = new THREE.Scene();
  const cabinetRoot = new THREE.Group();
  cabinetRoot.name = "cabinet";
  cabinetRoot.userData = {
    objJson: {
      threeJsonId: "cabinet-stat-test",
      objType: "deviceCabinet",
      name: "cabinet",
      label: "机柜统计测试",
      geometry: { width: 6, length: 12, height: 20 },
      slots: { total: 9, unitHeight: 0.48, bottomMargin: 0.77 },
      devices: [{ deviceType: "server", uStart: 28, uSize: 2, name: "srv-1" }]
    }
  };
  cabinetRoot.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
  scene.add(cabinetRoot);
  const childCountBefore = cabinetRoot.children.length;

  businessDomains.device.cabinet.showRackSpaceStats(cabinetRoot, scene, { animate: true });
  const overlayId = cabinetRoot.userData?._cabinetStatOverlayId;
  assert.ok(overlayId, "showRackSpaceStats should create overlay id");
  const overlayObj = getObjectByThreeJsonId(overlayId);
  assert.ok(overlayObj, "overlay should be registered in object registry");
  assert.ok(cabinetRoot.children.length > childCountBefore, "overlay should attach as cabinet child");
  const nonOverlayChildren = cabinetRoot.children.filter(
    (child) => (child?.userData?.objJson?.threeJsonId || child.uuid) !== overlayId
  );
  assert.ok(nonOverlayChildren.every((child) => child.visible === false), "cabinet body should be hidden");

  businessDomains.device.cabinet.clearCabinetStatView(cabinetRoot, scene);
  assert.equal(getObjectByThreeJsonId(overlayId), null, "overlay should be removed on clear");
  assert.ok(cabinetRoot.children.every((child) => child.visible !== false), "cabinet body should restore visibility");
});

test("device.cabinet showCapacityStats deploys stat bar mesh on cabinet root", () => {
  const scene = new THREE.Scene();
  const cabinetRoot = new THREE.Group();
  cabinetRoot.name = "cabinet";
  cabinetRoot.userData = {
    objJson: {
      threeJsonId: "cabinet-capacity-test",
      objType: "deviceCabinet",
      name: "cabinet",
      geometry: { width: 6, length: 12, height: 20 },
      slots: { total: 9, unitHeight: 0.48, bottomMargin: 0.77 },
      devices: [{ deviceType: "server", uStart: 28, uSize: 2, name: "srv-1" }]
    }
  };
  cabinetRoot.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
  scene.add(cabinetRoot);

  businessDomains.device.cabinet.showCapacityStats(cabinetRoot, scene, { animate: true });
  let meshCount = 0;
  cabinetRoot.traverse((node) => {
    if (node?.isMesh) {
      meshCount += 1;
    }
  });
  assert.ok(meshCount > 0, "showCapacityStats should attach a visible stat bar mesh");
  businessDomains.device.cabinet.clearCabinetStatView(cabinetRoot, scene);
});

test("device.cabinet stat bar footprint matches cabinet geometry", () => {
  const scene = new THREE.Scene();
  const cabinetRoot = new THREE.Group();
  cabinetRoot.name = "cabinet";
  cabinetRoot.userData = {
    objJson: {
      threeJsonId: "cabinet-footprint-test",
      objType: "deviceCabinet",
      geometry: { width: 6, length: 12, height: 20 },
      slots: { total: 9, unitHeight: 0.48, bottomMargin: 0.77 },
      devices: [{ deviceType: "server", uStart: 1, uSize: 10, name: "srv-1" }]
    }
  };
  cabinetRoot.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
  scene.add(cabinetRoot);

  businessDomains.device.cabinet.showCapacityStats(cabinetRoot, scene, { animate: true });
  let statMesh = null;
  cabinetRoot.traverse((node) => {
    if (node?.isMesh && node.userData?.objJson?.objType === "statBar") {
      statMesh = node;
    }
  });
  assert.ok(statMesh, "stat bar mesh should exist");
  const params = statMesh.geometry?.parameters;
  assert.equal(params?.width, 6, "bar width should match cabinet width");
  assert.equal(params?.depth, 12, "bar depth should match cabinet length");
  assert.ok(params?.height <= 20, "bar height should not exceed cabinet height");
  businessDomains.device.cabinet.clearCabinetStatView(cabinetRoot, scene);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import { initBusinessDomains } from "../core/handler/businessDomainRegistry.js";
import {
  finalizeDomainDeployRoot,
  getPersistSource,
  isDomainDeployRootObjJson
} from "../core/handler/domainDeployDescriptor.js";
import { collectObjectListFromScene } from "../core/util/sceneToJson.js";
import { createPortJson } from "../domains/port/portFactory.js";
import { normalizeScenePayload } from "../core/handler/sceneFriendlyNormalizer.js";

initBusinessDomains();

const SAMPLE_CRANE = {
  objType: "domain",
  domain: "port",
  handler: "dockCrane",
  name: "dock-crane",
  label: "岸桥1",
  threeJsonId: "shore-crane-1",
  geometry: { width: 70, length: 90, height: 280, depth: 90 },
  position: { x: -80, y: 2, z: -250 },
  material: { type: "standard", color: "#ffffff" },
  businessInfo: { deviceTypeCode: "crane" }
};

test("createPortJson does not inherit domain objType on composite shell", () => {
  const groupJson = createPortJson(SAMPLE_CRANE);
  assert.ok(groupJson);
  assert.notEqual(String(groupJson.objType || "").toLowerCase(), "domain");
  assert.ok(Array.isArray(groupJson.subScene) && groupJson.subScene.length > 0);
});

test("flat port record finalize exports reloadable dockCrane without items shell", () => {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  group.name = SAMPLE_CRANE.name;
  scene.add(group);
  finalizeDomainDeployRoot(group, {
    domainId: "port",
    handler: "dockCrane",
    loadRecord: SAMPLE_CRANE,
    extras: { threeJsonId: SAMPLE_CRANE.threeJsonId }
  });
  assert.equal(isDomainDeployRootObjJson(group.userData?.objJson), true);
  assert.ok(getPersistSource(group));
  assert.equal(group.userData.objJson.name, "dock-crane");
  assert.equal(group.userData.objJson.label, "岸桥1");
  assert.equal(group.userData.objJson.items, undefined);

  const exported = collectObjectListFromScene(scene, {});
  assert.equal(exported.length, 1);
  const ex = exported[0];
  assert.equal(ex.domain, "port");
  assert.equal(ex.handler, "dockCrane");
  assert.equal(ex.name, "dock-crane");
  assert.equal(ex.label, "岸桥1");
  assert.ok(ex.geometry);
  assert.equal(ex.items, undefined);
});

test("flat port snapshot payload normalizes without items shell", () => {
  const norm = normalizeScenePayload({ objectList: [SAMPLE_CRANE] });
  const crane = norm.objectList.find((r) => r.handler === "dockCrane");
  assert.ok(crane);
  assert.equal(crane.name, "dock-crane");
  assert.equal(crane.label, "岸桥1");
  assert.ok(crane.geometry);
  assert.equal(crane.items, undefined);
});

test("deployPort finalize contract keeps flat loadRecord on deploy root", () => {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  group.name = SAMPLE_CRANE.name;
  scene.add(group);
  finalizeDomainDeployRoot(group, {
    domainId: "port",
    handler: "dockCrane",
    loadRecord: SAMPLE_CRANE,
    extras: { threeJsonId: SAMPLE_CRANE.threeJsonId }
  });
  assert.equal(scene.children[0].userData?.objJson?.name, "dock-crane");
  assert.equal(scene.children[0].userData?.objJson?.handler, "dockCrane");
  assert.equal(scene.children[0].userData?.objJson?.items, undefined);
  const exported = collectObjectListFromScene(scene, {});
  assert.equal(exported[0].handler, "dockCrane");
  assert.equal(exported[0].items, undefined);
});

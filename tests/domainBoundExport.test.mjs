import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import "../builtins/register.js";
import {
  getDomain,
  initBusinessDomains,
  isKnownDomainHandler
} from "../core/handler/businessDomainRegistry.js";
import {
  collectDomainExportCaveats,
  DOMAIN_EDIT_STATES,
  exportDeployRootDescriptor,
  finalizeDomainDeployRoot,
  setDomainChildTransformBaseline,
  setDomainEditState,
  snapshotDomainChildTransforms
} from "../core/handler/domainDeployDescriptor.js";
import {
  assertSceneExportable,
  collectObjectListFromScene
} from "../core/util/sceneToJson.js";
import { bindDomainParserOnRoot } from "../tools/common/editor-single/domainEditSession.js";

initBusinessDomains();

const SAMPLE_PORT = {
  objType: "domain",
  domain: "port",
  handler: "dockCrane",
  name: "dock-crane",
  label: "岸桥 bound 测试",
  threeJsonId: "port-bound-1",
  geometry: { width: 70, length: 90, height: 280, depth: 90 },
  position: { x: 0, y: 0, z: 0 }
};

const SAMPLE_CABINET = {
  objType: "domain",
  domain: "device.cabinet",
  handler: "deployCabinet",
  name: "cabinet",
  label: "机柜 bound 测试",
  threeJsonId: "cab-bound-1",
  geometry: { width: 6, length: 12, height: 20 },
  doors: [{ side: "front", swing: "right", leafCount: 1 }],
  position: { x: 0, y: 0, z: 0 }
};

test("isKnownDomainHandler accepts port dockCrane and rejects unknown", () => {
  const port = getDomain("port");
  assert.equal(isKnownDomainHandler(port, "dockCrane"), true);
  assert.equal(isKnownDomainHandler(port, "notARealHandler"), false);
});

test("bindDomainParserOnRoot rejects unknown handler", () => {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  scene.add(group);
  finalizeDomainDeployRoot(group, {
    domainId: "port",
    handler: "dockCrane",
    loadRecord: SAMPLE_PORT
  });
  const result = bindDomainParserOnRoot(group, {
    domain: "port",
    handler: "notARealHandler",
    childBaseline: {}
  });
  assert.equal(result.ok, false);
  assert.match(result.error || "", /handler/i);
});

test("bound port with child drift and no capture still exports persistSource", () => {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  const child = new THREE.Group();
  child.name = "child-part";
  child.userData = { objJson: { threeJsonId: "child-part-1" } };
  group.add(child);
  scene.add(group);
  finalizeDomainDeployRoot(group, {
    domainId: "port",
    handler: "dockCrane",
    loadRecord: SAMPLE_PORT
  });
  const baseline = snapshotDomainChildTransforms(group);
  child.position.set(12, 0, 0);
  setDomainChildTransformBaseline(group, baseline);
  setDomainEditState(group, DOMAIN_EDIT_STATES.BOUND);
  group.position.set(5, 0, 0);
  const check = assertSceneExportable(scene, {});
  assert.equal(check.ok, true);
  const exported = exportDeployRootDescriptor(group);
  assert.ok(exported);
  assert.equal(exported.handler, "dockCrane");
  assert.equal(exported.position.x, 5);
});

test("bound port without child drift exports persistSource", () => {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  scene.add(group);
  finalizeDomainDeployRoot(group, {
    domainId: "port",
    handler: "dockCrane",
    loadRecord: SAMPLE_PORT
  });
  setDomainChildTransformBaseline(group, snapshotDomainChildTransforms(group));
  setDomainEditState(group, DOMAIN_EDIT_STATES.BOUND);
  group.position.set(42, 1, -3);
  const check = assertSceneExportable(scene, {});
  assert.equal(check.ok, true);
  const exported = collectObjectListFromScene(scene, {});
  assert.equal(exported.length, 1);
  assert.equal(exported[0].handler, "dockCrane");
  assert.equal(exported[0].position.x, 42);
});

test("collectDomainExportCaveats lists bound roots with child drift", () => {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  group.name = SAMPLE_PORT.name;
  const child = new THREE.Group();
  child.userData = { objJson: { threeJsonId: "c1" } };
  group.add(child);
  scene.add(group);
  finalizeDomainDeployRoot(group, {
    domainId: "port",
    handler: "dockCrane",
    loadRecord: SAMPLE_PORT
  });
  const baseline = snapshotDomainChildTransforms(group);
  child.position.set(3, 0, 0);
  setDomainChildTransformBaseline(group, baseline);
  setDomainEditState(group, DOMAIN_EDIT_STATES.BOUND);
  const caveats = collectDomainExportCaveats(scene, {});
  assert.equal(caveats.length, 1);
  assert.equal(caveats[0].name, "dock-crane");
  assert.equal(caveats[0].domainId, "port");
  assert.equal(caveats[0].hasCapture, false);
});

test("bound port without child drift skips caveat list", () => {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  scene.add(group);
  finalizeDomainDeployRoot(group, {
    domainId: "port",
    handler: "dockCrane",
    loadRecord: SAMPLE_PORT
  });
  setDomainChildTransformBaseline(group, snapshotDomainChildTransforms(group));
  setDomainEditState(group, DOMAIN_EDIT_STATES.BOUND);
  assert.equal(collectDomainExportCaveats(scene, {}).length, 0);
});

test("bound cabinet exports instance with root transform via capture", () => {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  scene.add(group);
  finalizeDomainDeployRoot(group, {
    domainId: "device.cabinet",
    handler: "deployCabinet",
    loadRecord: SAMPLE_CABINET
  });
  setDomainChildTransformBaseline(group, snapshotDomainChildTransforms(group));
  setDomainEditState(group, DOMAIN_EDIT_STATES.BOUND);
  group.position.set(7, 8, 9);
  const exported = exportDeployRootDescriptor(group);
  assert.ok(exported);
  assert.equal(exported.objType, "domain");
  assert.equal(exported.domain, "device.cabinet");
  assert.equal(exported.handler, "deployCabinet");
  assert.equal(exported.position.x, 7);
  assert.equal(exported.doors?.length, 1);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import { initBusinessDomains } from "../core/handler/businessDomainRegistry.js";
import {
  DOMAIN_EDIT_STATES,
  finalizeDomainDeployRoot,
  getPersistSource,
  setDomainEditState
} from "../core/handler/domainDeployDescriptor.js";
import {
  assertSceneExportable,
  collectObjectListFromScene,
  sceneToStandardJsonSimple
} from "../core/util/sceneToJson.js";

initBusinessDomains();

const SAMPLE_CRANE = {
  objType: "domain",
  domain: "port",
  handler: "dockCrane",
  name: "dock-crane",
  label: "岸桥测试",
  threeJsonId: "crane-persist-1",
  geometry: { width: 70, length: 90, height: 280, depth: 90 },
  position: { x: 10, y: 2, z: -20 },
  material: { type: "standard", color: "#ffffff" }
};

test("finalizeDomainDeployRoot stores flat persistSource without items shell", () => {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  scene.add(group);
  finalizeDomainDeployRoot(group, {
    domainId: "port",
    handler: "dockCrane",
    loadRecord: SAMPLE_CRANE,
    extras: { threeJsonId: SAMPLE_CRANE.threeJsonId }
  });
  const persist = getPersistSource(group);
  assert.equal(persist.domain, "port");
  assert.equal(persist.handler, "dockCrane");
  assert.equal(persist.name, "dock-crane");
  assert.equal(persist.label, "岸桥测试");
  assert.ok(persist.geometry);
  assert.equal(persist.items, undefined);
  assert.deepEqual(group.userData.objJson, persist);
});

test("pristine export syncs root transform onto flat persistSource", () => {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  scene.add(group);
  finalizeDomainDeployRoot(group, {
    domainId: "port",
    handler: "dockCrane",
    loadRecord: SAMPLE_CRANE,
    extras: { threeJsonId: SAMPLE_CRANE.threeJsonId }
  });
  group.position.set(99, 2, -20);
  const exported = collectObjectListFromScene(scene, {});
  assert.equal(exported.length, 1);
  assert.equal(exported[0].position.x, 99);
  assert.equal(exported[0].handler, "dockCrane");
  assert.equal(exported[0].items, undefined);
});

test("pending domain edit blocks export when assertExportable", () => {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  scene.add(group);
  finalizeDomainDeployRoot(group, {
    domainId: "port",
    handler: "dockCrane",
    loadRecord: SAMPLE_CRANE,
    extras: { threeJsonId: SAMPLE_CRANE.threeJsonId }
  });
  setDomainEditState(group, DOMAIN_EDIT_STATES.PENDING_RESOLUTION);
  const check = assertSceneExportable(scene, {});
  assert.equal(check.ok, false);
  assert.throws(
    () => sceneToStandardJsonSimple(scene, { assertExportable: true, merge: false }),
    /Scene export blocked/
  );
});

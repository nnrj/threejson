import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import "../builtins/register.js";
import { assignDomainPartIds, applyDomainPartDescriptorOverrides, indexDomainPartDescriptors } from "../core/document/domainParts.js";
import { initializeDomainPartState, captureDomainPartOverrides } from "../core/runtime/domainPartState.js";
import { DOMAIN_EDIT_STATES, finalizeDomainDeployRoot, exportDeployRootDescriptor, setDomainEditState } from "../core/handler/domainDeployDescriptor.js";
import { deployPort } from "../domains/port/portFactory.js";
import { buildCabinetGroupJson } from "../domains/device/cabinet/cabinetFactory.js";
import { createDoor } from "../domains/door/index.js";
import { applyDomainChildEditResolution } from "../tools/common/editor-single/domainEditSession.js";

const findPart = (root, id) => {
  let result;
  root.traverse((object) => { if (object.userData?.objJson?.domainPartId === id) result = object; });
  return result;
};

test("port part transform and material edits round-trip without baking or changing factory parameters", () => {
  const source = { objType: "domain", domain: "port", handler: "dockCrane", threeJsonId: "crane", geometry: { width: 70, length: 90, height: 280 } };
  const scene = new THREE.Scene();
  deployPort(source, scene);
  const root = scene.children[0];
  for (const name of ["岸桥腿L", "岸桥腿R", "岸桥大梁", "岸桥前臂", "岸桥小车", "吊具", "司机室"]) {
    assert.ok(root.getObjectByName(name)?.isMesh, `Main crane part must render without a permissive fallback: ${name}`);
  }
  const part = root.children.find((object) => object.isMesh && object.userData?.objJson?.material);
  assert.ok(part);
  const id = part.userData.objJson.domainPartId;
  part.position.set(13, 25, -37);
  part.userData.objJson.material.color = "#ff0044";
  setDomainEditState(root, DOMAIN_EDIT_STATES.BOUND);
  const exported = exportDeployRootDescriptor(root);
  assert.deepEqual(exported.geometry, source.geometry);
  assert.equal(exported.objType, "domain");
  assert.equal(exported.domainOverrides.parts.length, 1);
  const reloaded = new THREE.Scene();
  deployPort(JSON.parse(JSON.stringify(exported)), reloaded);
  const restored = findPart(reloaded.children[0], id);
  assert.deepEqual(restored.position.toArray(), [13, 25, -37]);
  assert.equal(restored.userData.objJson.material.color, "#ff0044");
  assert.equal(restored.material.color.getHexString(), "ff0044");
  // Repeated load/export must not grow a second copy of the same operations.
  setDomainEditState(reloaded.children[0], DOMAIN_EDIT_STATES.BOUND);
  assert.deepEqual(exportDeployRootDescriptor(reloaded.children[0]).domainOverrides, exported.domainOverrides);
});

test("cabinet part identities survive dimensions and support nested door factory overrides", () => {
  const source = { threeJsonId: "cabinet", geometry: { width: 6, length: 12, height: 20 }, doors: [{ side: "front", swing: "right", leafCount: 1 }] };
  const generated = buildCabinetGroupJson(source);
  const door = [...indexDomainPartDescriptors(generated).values()].find((part) => part.objType === "door");
  assert.ok(door);
  const larger = buildCabinetGroupJson({ ...source, geometry: { width: 8, length: 15, height: 30 } });
  assert.deepEqual(larger.subScene.map((part) => part.domainPartId), generated.subScene.map((part) => part.domainPartId));
  const leafId = `${door.domainPartId}/leaf`;
  const edited = buildCabinetGroupJson({ ...source, domainOverrides: { partSchemaVersion: 1, parts: [{ id: leafId, operations: [{ op: "add", path: "/material/color", value: "#cc1188" }], transform: { position: [2, 3, 4] } }] } });
  const leafDesc = [...indexDomainPartDescriptors(edited).values()].find((part) => part.objType === "door");
  const hinge = createDoor(leafDesc);
  const leaf = findPart(hinge, leafId);
  assert.deepEqual(leaf.position.toArray(), [2, 3, 4]);
  assert.equal(leaf.userData.objJson.material.color, "#cc1188");
  assert.equal(hinge.userData.objJson.threeJsonId, door.threeJsonId);
});

test("descriptor batches reject unknown parts and identity/structure changes without partially modifying inputs", () => {
  const group = assignDomainPartIds({ subScene: [{ name: "shell", material: { color: "blue" } }] });
  const original = JSON.stringify(group);
  const parts = [{ id: "parts/shell", operations: [{ op: "replace", path: "/material/color", value: "red" }] }, { id: "missing", operations: [] }];
  assert.throws(() => applyDomainPartDescriptorOverrides(group, { domainOverrides: { partSchemaVersion: 1, parts } }), { code: "DOMAIN_PART_CONFLICT" });
  assert.equal(JSON.stringify(group), original);
  assert.throws(() => applyDomainPartDescriptorOverrides(group, { domainOverrides: { partSchemaVersion: 2, parts: [] } }), { code: "DOMAIN_PART_VERSION_CONFLICT" });
  assert.throws(() => applyDomainPartDescriptorOverrides(group, { domainOverrides: { partSchemaVersion: 1, parts: [{ id: "parts/shell", operations: [{ op: "add", path: "/subScene", value: [] }] }] } }), { code: "DOMAIN_PART_CONFLICT" });
});

test("invalid runtime transforms are validated as a batch before changing any part", () => {
  const root = new THREE.Group();
  for (const id of ["a", "b"]) {
    const part = new THREE.Group();
    part.userData.objJson = { domainPartId: id };
    root.add(part);
  }
  assert.throws(() => initializeDomainPartState(root, { domainOverrides: { partSchemaVersion: 1, parts: [
    { id: "a", transform: { position: [1, 2, 3] } },
    { id: "b", transform: { quaternion: [0, 0, 0, 0] } }
  ] } }), { code: "DOMAIN_PART_CONFLICT" });
  assert.deepEqual(root.children[0].position.toArray(), [0, 0, 0]);
});

test("parent and child descriptor overrides both survive one batch", () => {
  const tree = assignDomainPartIds({ subScene: [{ name: "assembly", material: { color: "blue" }, subScene: [{ name: "leaf", material: { color: "green" } }] }] });
  applyDomainPartDescriptorOverrides(tree, { domainOverrides: { partSchemaVersion: 1, parts: [
    { id: "parts/assembly", operations: [{ op: "replace", path: "/material/color", value: "red" }] },
    { id: "parts/assembly/leaf", operations: [{ op: "replace", path: "/material/color", value: "yellow" }] }
  ] } });
  assert.equal(tree.subScene[0].material.color, "red");
  assert.equal(tree.subScene[0].subScene[0].material.color, "yellow");
});

test("unaddressed edits and structural changes are explicit conflicts; bind failure never silently bakes", () => {
  const root = new THREE.Group();
  root.add(new THREE.Group());
  finalizeDomainDeployRoot(root, { domainId: "port", handler: "dockCrane", loadRecord: { objType: "domain", domain: "port", handler: "dockCrane" } });
  root.children[0].position.x = 10;
  assert.throws(() => captureDomainPartOverrides(root), { code: "DOMAIN_PART_CONFLICT" });
  const result = applyDomainChildEditResolution("bind", root, { binding: { domain: "port", handler: "dockCrane" }, fallbackDegradeOnBindFail: true });
  assert.equal(result.ok, false);
  assert.equal(root.userData.objJson.objType, "domain");
  assert.ok(root.userData.persistSource);
});

test("pose changes during playback do not rewrite a pristine Domain record", () => {
  const source = { name: "door", threeJsonId: "door-1", geometry: { width: 4, height: 10, depth: 1 } };
  const door = createDoor(source);
  const before = exportDeployRootDescriptor(door);
  door.children[0].rotation.y = 0.75;
  assert.deepEqual(exportDeployRootDescriptor(door), before);
});

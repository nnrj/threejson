import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import { pickEditableObject } from "../core/util/meshPick.js";

test("pickEditableObject uses setFromCamera and resolves editable ancestor", () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  const parent = new THREE.Group();
  parent.userData = { objJson: { objType: "box", name: "parent" } };
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2),
    new THREE.MeshBasicMaterial()
  );
  mesh.position.set(0, 0, 0);
  mesh.userData = { objJson: { objType: "box", name: "child" } };
  parent.add(mesh);
  scene.add(parent);

  const picked = pickEditableObject({
    ndc: new THREE.Vector2(0, 0),
    camera,
    scene,
    objects: scene.children,
    isEditable: (obj) => Boolean(obj?.userData?.objJson?.objType)
  });

  assert.ok(picked);
  assert.equal(picked.userData.objJson.name, "child");
});

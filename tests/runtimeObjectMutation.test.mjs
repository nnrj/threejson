import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  applyObjectChange,
  applyObjectPartial,
  applyObjectSnapshot,
  captureObjectSnapshot
} from "../core/runtime/objectMutation/index.js";
import { clearObjectRegistry, registerObject, unregisterObject } from "../core/handler/objectRegistry.js";
import { configureTextureDefaultsForDeploy, _resetTextureSamplingForDeployForTests } from "../core/util/textureSampling.js";

function createRegisteredMesh(threeJsonId = "obj-1") {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  mesh.userData = {
    objJson: {
      threeJsonId,
      name: "before",
      visible: true,
      position: { x: 0, y: 0, z: 0 },
      rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
      scale: { scaleX: 1, scaleY: 1, scaleZ: 1 },
      material: {
        color: "#ffffff"
      }
    }
  };
  registerObject(mesh, mesh.userData.objJson, { recursive: false });
  return mesh;
}

test("applyObjectChange defaults strict for missing parent path", () => {
  clearObjectRegistry();
  const mesh = createRegisteredMesh("strict-1");
  const res = applyObjectChange("strict-1", "material.textureUrl.path", "/x.png");
  assert.equal(res.ok, false);
  assert.match(String(res.error), /missing/i);
  unregisterObject(mesh, { recursive: false });
  clearObjectRegistry();
});

test("applyObjectChange can create missing path with createMissing", () => {
  clearObjectRegistry();
  const mesh = createRegisteredMesh("strict-2");
  const res = applyObjectChange("strict-2", "material.textureUrl.path", "/x.png", {
    createMissing: true
  });
  assert.equal(res.ok, true);
  assert.equal(mesh.userData.objJson.material.textureUrl.path, "/x.png");
  unregisterObject(mesh, { recursive: false });
  clearObjectRegistry();
});

test("applyObjectPartial syncs transform/name/visible to object", () => {
  clearObjectRegistry();
  const mesh = createRegisteredMesh("partial-1");
  const res = applyObjectPartial("partial-1", {
    name: "after",
    visible: false,
    position: { x: 4, y: 5, z: 6 }
  });
  assert.equal(res.ok, true);
  assert.equal(mesh.name, "after");
  assert.equal(mesh.visible, false);
  assert.equal(mesh.position.x, 4);
  assert.equal(mesh.position.y, 5);
  assert.equal(mesh.position.z, 6);
  unregisterObject(mesh, { recursive: false });
  clearObjectRegistry();
});

test("applyObjectSnapshot restores extended material fields", () => {
  clearObjectRegistry();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xffffff })
  );
  mesh.userData = {
    objJson: {
      threeJsonId: "mat-1",
      name: "box",
      position: { x: 0, y: 0, z: 0 },
      rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
      scale: { scaleX: 1, scaleY: 1, scaleZ: 1 },
      castShadow: false,
      receiveShadow: false,
      material: {
        color: "#ffffff",
        emissive: "#000000",
        emissiveIntensity: 0,
        opacity: 1,
        metalness: 0,
        roughness: 1,
        wireframe: false,
        side: "front",
        textureUrl: ""
      }
    }
  };
  registerObject(mesh, mesh.userData.objJson, { recursive: false });
  const snapshot = captureObjectSnapshot("mat-1");
  assert.ok(snapshot);

  mesh.userData.objJson.castShadow = true;
  mesh.userData.objJson.receiveShadow = true;
  mesh.userData.objJson.material = {
    color: "#ff0000",
    emissive: "#00ff00",
    emissiveIntensity: 0.5,
    opacity: 0.8,
    metalness: 0.9,
    roughness: 0.2,
    wireframe: true,
    side: "double",
    textureUrl: ""
  };
  const changed = applyObjectSnapshot("mat-1", mesh.userData.objJson);
  assert.equal(changed.ok, true);
  assert.equal(mesh.material.color.getHexString(), "ff0000");
  assert.equal(mesh.material.emissive.getHexString(), "00ff00");
  assert.equal(mesh.material.metalness, 0.9);
  assert.equal(mesh.material.wireframe, true);
  assert.equal(mesh.castShadow, true);
  assert.equal(mesh.receiveShadow, true);

  const restored = applyObjectSnapshot("mat-1", snapshot);
  assert.equal(restored.ok, true);
  assert.equal(mesh.material.color.getHexString(), "ffffff");
  assert.equal(mesh.material.metalness, 0);
  assert.equal(mesh.material.wireframe, false);
  assert.equal(mesh.castShadow, false);
  assert.equal(mesh.receiveShadow, false);

  unregisterObject(mesh, { recursive: false });
  clearObjectRegistry();
});

test("applyObjectSnapshot clears material map when textureUrl is empty", () => {
  clearObjectRegistry();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xffffff })
  );
  mesh.material.map = { dispose: () => {} };
  mesh.userData = {
    objJson: {
      threeJsonId: "mat-map",
      name: "box",
      position: { x: 0, y: 0, z: 0 },
      rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
      scale: { scaleX: 1, scaleY: 1, scaleZ: 1 },
      material: { color: "#ffffff", textureUrl: "" }
    }
  };
  registerObject(mesh, mesh.userData.objJson, { recursive: false });
  assert.ok(mesh.material.map);

  const cleared = applyObjectSnapshot("mat-map", mesh.userData.objJson);
  assert.equal(cleared.ok, true);
  assert.equal(mesh.material.map, null);

  unregisterObject(mesh, { recursive: false });
  clearObjectRegistry();
});

test("captureObjectSnapshot + applyObjectSnapshot restores descriptor and transform", () => {
  clearObjectRegistry();
  const mesh = createRegisteredMesh("snap-1");
  const snapshot = captureObjectSnapshot("snap-1");
  assert.ok(snapshot);

  const changed = applyObjectPartial("snap-1", {
    name: "changed",
    position: { x: 9, y: 9, z: 9 }
  });
  assert.equal(changed.ok, true);
  assert.equal(mesh.position.x, 9);

  const restored = applyObjectSnapshot("snap-1", snapshot);
  assert.equal(restored.ok, true);
  assert.equal(mesh.name, "before");
  assert.equal(mesh.position.x, 0);
  assert.equal(mesh.position.y, 0);
  assert.equal(mesh.position.z, 0);
  unregisterObject(mesh, { recursive: false });
  clearObjectRegistry();
});

test("applyObjectChange hot-updates material.textureQuality on loaded map", () => {
  _resetTextureSamplingForDeployForTests();
  configureTextureDefaultsForDeploy({ sceneConfig: { textureQuality: 2 } });
  clearObjectRegistry();
  const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ map: texture })
  );
  mesh.userData = {
    objJson: {
      threeJsonId: "tex-q",
      material: {
        color: "#ffffff",
        textureQuality: 1
      }
    }
  };
  registerObject(mesh, mesh.userData.objJson, { recursive: false });
  assert.equal(mesh.material.map.anisotropy, 1);

  const res = applyObjectChange("tex-q", "material.textureQuality", 3, { createMissing: true });
  assert.equal(res.ok, true);
  assert.equal(mesh.userData.objJson.material.textureQuality, 3);
  assert.equal(mesh.material.map.anisotropy, 8);

  _resetTextureSamplingForDeployForTests();
  unregisterObject(mesh, { recursive: false });
  clearObjectRegistry();
});

test("applyObjectChange reloads texture when textureUrl changes on existing map", async () => {
  clearObjectRegistry();
  const oldTex = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  oldTex.userData = { threeJsonResolvedUrl: "/textures/old.png" };
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ map: oldTex })
  );
  mesh.userData = {
    objJson: {
      threeJsonId: "tex-url",
      material: {
        color: "#ffffff",
        textureUrl: "/textures/old.png"
      }
    }
  };
  registerObject(mesh, mesh.userData.objJson, { recursive: false });

  const origLoad = THREE.TextureLoader.prototype.load;
  THREE.TextureLoader.prototype.load = function stubTextureLoaderLoad(url, onLoad) {
    const tex = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    tex.userData = { threeJsonResolvedUrl: String(url) };
    onLoad?.(tex);
    return tex;
  };
  try {
    const res = applyObjectChange("tex-url", "material.textureUrl", "/textures/new.png");
    assert.equal(res.ok, true);
    await Promise.resolve();

    assert.notEqual(mesh.material.map, oldTex);
    assert.equal(mesh.material.map?.userData?.threeJsonResolvedUrl, "/textures/new.png");
  } finally {
    THREE.TextureLoader.prototype.load = origLoad;
  }

  unregisterObject(mesh, { recursive: false });
  clearObjectRegistry();
});

test("applyObjectChange reuses map when textureUrl unchanged on existing map", () => {
  clearObjectRegistry();
  const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  texture.userData = { threeJsonResolvedUrl: "/textures/same.png" };
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ map: texture })
  );
  mesh.userData = {
    objJson: {
      threeJsonId: "tex-same",
      material: {
        color: "#ffffff",
        textureUrl: "/textures/same.png",
        textureQuality: 1
      }
    }
  };
  registerObject(mesh, mesh.userData.objJson, { recursive: false });

  const res = applyObjectChange("tex-same", "material.textureQuality", 3, { createMissing: true });
  assert.equal(res.ok, true);
  assert.equal(mesh.material.map, texture);

  unregisterObject(mesh, { recursive: false });
  clearObjectRegistry();
});

import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  applyModelMaterialBindings,
  listModelMaterialSlots
} from "../core/builder/modelMaterialBindings.js";

function fixture() {
  const root = new THREE.Group();
  root.name = "ImportedModel";
  const headMaterial = new THREE.MeshStandardMaterial({ color: "#ffffff" });
  headMaterial.name = "Skin";
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: "#888888" });
  bodyMaterial.name = "Clothes";
  const head = new THREE.Mesh(new THREE.BoxGeometry(), headMaterial);
  head.name = "HeadMesh";
  const body = new THREE.Mesh(new THREE.BoxGeometry(), bodyMaterial);
  body.name = "BodyMesh";
  root.add(head, body);
  return { root, head, body, headMaterial, bodyMaterial };
}

test("external-model bindings select nodes by wildcard and replace only matching slots", () => {
  const { root, head, body, headMaterial, bodyMaterial } = fixture();
  let disposedHead = 0;
  let disposedBody = 0;
  headMaterial.addEventListener("dispose", () => { disposedHead += 1; });
  bodyMaterial.addEventListener("dispose", () => { disposedBody += 1; });
  const summary = applyModelMaterialBindings(root, {
    materialBindings: [{
      selector: { nodeName: "Head*", materialName: "Skin" },
      material: { type: "standard", color: "#ff3300", roughness: 0.7 }
    }]
  });
  assert.equal(summary.replacedSlots, 1);
  assert.equal(summary.disposedMaterials, 1);
  assert.equal(disposedHead, 1);
  assert.equal(disposedBody, 0);
  assert.notEqual(head.material, headMaterial);
  assert.equal(head.material.color.getHexString(), "ff3300");
  assert.equal(head.material.name, "Skin");
  assert.equal(body.material, bodyMaterial);
  assert.equal(listModelMaterialSlots(root)[0].nodePath, "/ImportedModel/HeadMesh");
  root.traverse((object) => object.geometry?.dispose?.());
  head.material.dispose();
  body.material.dispose();
  headMaterial.dispose();
});

test("material-array selectors can replace one slot and strict unmatched bindings diagnose errors", () => {
  const root = new THREE.Group();
  root.name = "Root";
  const materials = [
    new THREE.MeshBasicMaterial({ color: "#ffffff" }),
    new THREE.MeshBasicMaterial({ color: "#000000" })
  ];
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), materials);
  mesh.name = "Multi";
  root.add(mesh);
  applyModelMaterialBindings(root, {
    materialBindings: [{
      selector: { nodePath: "*/Multi", materialIndex: 1 },
      material: { type: "basic", color: "#00ff00" }
    }]
  });
  assert.equal(mesh.material[0], materials[0]);
  assert.equal(mesh.material[1].color.getHexString(), "00ff00");
  assert.throws(
    () => applyModelMaterialBindings(root, {
      materialBindingsStrict: true,
      materialBindings: [{
        selector: { nodeName: "Missing" },
        material: { type: "basic", color: "#ffffff" }
      }]
    }),
    (error) => error.code === "E_MODEL_MATERIAL_BINDING_UNMATCHED"
  );
  assert.throws(
    () => applyModelMaterialBindings(root, {
      materialBindings: [{
        selector: { nodeNmae: "Multi" },
        material: { type: "basic", color: "#ffffff" }
      }]
    }),
    (error) => error.code === "E_MODEL_MATERIAL_SELECTOR_INVALID"
  );
  mesh.geometry.dispose();
  for (const material of mesh.material) material.dispose();
  materials[1].dispose();
});

test("replaced-model cleanup preserves textures still used by an unmatched material", () => {
  const { root, head, body, headMaterial, bodyMaterial } = fixture();
  const sharedTexture = new THREE.Texture();
  const detachedTexture = new THREE.Texture();
  headMaterial.map = sharedTexture;
  headMaterial.normalMap = detachedTexture;
  bodyMaterial.map = sharedTexture;
  let sharedDisposals = 0;
  let detachedDisposals = 0;
  sharedTexture.addEventListener("dispose", () => { sharedDisposals += 1; });
  detachedTexture.addEventListener("dispose", () => { detachedDisposals += 1; });

  applyModelMaterialBindings(root, {
    materialBindings: [{
      selector: { nodeName: "HeadMesh" },
      material: { type: "standard", color: "#ff3300" }
    }]
  });

  assert.equal(detachedDisposals, 1);
  assert.equal(sharedDisposals, 0);
  assert.equal(body.material.map, sharedTexture);
  root.traverse((object) => object.geometry?.dispose?.());
  head.material.dispose();
  body.material.dispose();
  sharedTexture.dispose();
});

test("external-model bindings use optional TSL material factories without a core dependency", async () => {
  const { root, head, body, headMaterial, bodyMaterial } = fixture();
  const originalMap = new THREE.Texture();
  headMaterial.map = originalMap;
  await import("../webgpu/index.js");
  applyModelMaterialBindings(root, {
    materialBindings: [{
      selector: { all: true },
      inheritOriginal: "textures",
      material: {
        type: "tsl",
        base: "standard",
        transparent: true,
        side: "double",
        tsl: {
          kind: "graph",
          source: {
            inline: {
              graphVersion: 1,
              nodes: [
                { id: "surface", type: "color", value: "#cccccc" },
                { id: "opacity", type: "constant", value: 0.8 }
              ],
              outputs: { color: "surface", opacity: "opacity" }
            }
          }
        }
      }
    }]
  });
  assert.equal(head.material.isNodeMaterial, true);
  assert.equal(head.material, body.material);
  assert.equal(head.material.colorNode.isNode, true);
  assert.equal(head.material.opacityNode.isNode, true);
  assert.equal(head.material.map, originalMap);
  root.traverse((object) => object.geometry?.dispose?.());
  head.material.dispose();
  originalMap.dispose();
  headMaterial.dispose();
  bodyMaterial.dispose();
});

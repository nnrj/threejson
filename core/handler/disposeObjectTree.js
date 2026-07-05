import { unregisterObject } from "./objectRegistry.js";
import { disposeThreeJsonAudioNode } from "../builder/audioBuilder.js";

function disposeTexture(texture, state) {
  if (!texture || texture.isTexture !== true || state.textures.has(texture)) {
    return;
  }
  state.textures.add(texture);
  texture.dispose?.();
}

function disposeMaterial(material, state) {
  if (!material || material.isMaterial !== true || state.materials.has(material)) {
    return;
  }
  state.materials.add(material);
  for (const value of Object.values(material)) {
    disposeTexture(value, state);
  }
  if (material.uniforms && typeof material.uniforms === "object") {
    for (const uniform of Object.values(material.uniforms)) {
      if (!uniform) {
        continue;
      }
      if (Array.isArray(uniform.value)) {
        for (let i = 0; i < uniform.value.length; i++) {
          disposeTexture(uniform.value[i], state);
        }
      } else {
        disposeTexture(uniform.value, state);
      }
    }
  }
  material.dispose?.();
}

/**
 * Remove an object subtree from the scene graph: unregister, detach, and release GPU/audio resources by default.
 *
 * @param {import("three").Object3D|null|undefined} root
 */
function disposeObjectTree(root) {
  if (!root) {
    return;
  }
  unregisterObject(root, { recursive: true, keepDescriptor: false });
  if (root.parent) {
    root.parent.remove(root);
  }

  const state = {
    geometries: new Set(),
    materials: new Set(),
    textures: new Set()
  };
  const nodes = [];
  if (typeof root.traverse === "function") {
    root.traverse((node) => nodes.push(node));
  } else {
    nodes.push(root);
  }

  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    if (!node) {
      continue;
    }
    if (disposeThreeJsonAudioNode(node)) {
      continue;
    }
    if (node.isCSS3DObject === true && node.element instanceof HTMLElement) {
      node.element.remove();
      continue;
    }
    if (node.geometry && node.geometry.isBufferGeometry === true && !state.geometries.has(node.geometry)) {
      state.geometries.add(node.geometry);
      node.geometry.dispose?.();
    }
    if (Array.isArray(node.material)) {
      for (let mi = 0; mi < node.material.length; mi++) {
        disposeMaterial(node.material[mi], state);
      }
    } else {
      disposeMaterial(node.material, state);
    }
    disposeTexture(node.shadow?.map, state);
    if (typeof node.clear === "function") {
      node.clear();
    }
  }
}

/**
 * Detach and unregister only; do not dispose geometry/material (advanced scenarios).
 *
 * @param {import("three").Object3D|null|undefined} root
 */
function detachObjectTree(root) {
  if (!root) {
    return;
  }
  unregisterObject(root, { recursive: true, keepDescriptor: false });
  if (root.parent) {
    root.parent.remove(root);
  }
}

/**
 * Dispose a single material and its map/uniform textures (reused by tracked resource reclaim, etc.).
 *
 * @param {import("three").Material|null|undefined} material
 * @param {{ materials?: Set, textures?: Set }} [state]
 */
function disposeMaterialResource(material, state) {
  const bucket = state || { materials: new Set(), textures: new Set() };
  if (!bucket.materials) {
    bucket.materials = new Set();
  }
  if (!bucket.textures) {
    bucket.textures = new Set();
  }
  disposeMaterial(material, bucket);
}

export { disposeObjectTree, detachObjectTree, disposeMaterialResource };

import TWEEN, { createTween } from "../../core/compat/adapters/tween.js";
import { resolveDomainItemDescriptor } from "../../core/handler/domainDeployDescriptor.js";
import { readObjJsonFromUserData } from "../../core/util/spatialQueryUtil.js";
import { isDoorDescriptor, resolveOpenRotationY } from "./doorDescriptor.js";

/**
 * @param {import("three").Object3D} root
 * @returns {import("three").Mesh|null}
 */
function findFirstMeshDescendant(root) {
  if (root?.isMesh) {
    return root;
  }
  if (!root || typeof root.traverse !== "function") {
    return null;
  }
  let found = null;
  root.traverse((child) => {
    if (!found && child?.isMesh) {
      found = child;
    }
  });
  return found;
}

/**
 * @param {import("three").Object3D|null|undefined} object3D
 * @returns {boolean}
 */
export function isDoorInteractable(object3D) {
  return resolveDoorForAnimation(object3D) != null;
}

/**
 * @param {import("three").Object3D|null|undefined} object3D
 * @returns {{ hinge: import("three").Object3D, leaf: import("three").Object3D, descriptor: object }|null}
 */
export function resolveDoorForAnimation(object3D) {
  let node = object3D;
  while (node) {
    const shellJson = readObjJsonFromUserData(node.userData);
    if (isDoorDescriptor(shellJson)) {
      const leaf = node.isMesh ? node : findFirstMeshDescendant(node);
      if (!leaf) {
        return null;
      }
      const hinge =
        leaf.parent && leaf.parent.type === "Group" ? leaf.parent : leaf;
      const descriptor = resolveDomainItemDescriptor(shellJson) || shellJson;
      return { hinge, leaf, descriptor };
    }
    node = node.parent;
  }
  return null;
}

/**
 * Open/close tween on door object (uses hinge Group rotation.y).
 * @param {import("three").Object3D} currObj door leaf Mesh or door Group
 */
export function openOrCloseDoor(currObj) {
  const resolved = resolveDoorForAnimation(currObj);
  if (!resolved) {
    return;
  }
  const { hinge, descriptor } = resolved;
  const openAngle = resolveOpenRotationY(descriptor);
  const isClosed = Math.abs(hinge.rotation.y) < 1e-6;
  if (isClosed) {
    createTween(hinge.rotation)
      .to({ y: openAngle }, 1500)
      .easing(TWEEN.Easing.Elastic.Out)
      .start();
  } else {
    createTween(hinge.rotation).to({ y: 0 }, 300).start();
  }
}

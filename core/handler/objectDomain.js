/**
 * Query domain deploy roots by `objJson.domain` via domainIndex / objectRegistry.
 */
import { getObjectByThreeJsonId } from "./objectRegistry.js";
import { getThreeJsonIdsByDomain } from "./domainIndex.js";

function normalizeDomainId(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {import("three").Object3D|null|undefined} object
 * @param {import("three").Object3D|null|undefined} root
 * @returns {boolean}
 */
function isDescendantOf(object, root) {
  if (!object || !root) {
    return false;
  }
  let node = object;
  while (node) {
    if (node === root) {
      return true;
    }
    node = node.parent;
  }
  return false;
}

/**
 * @param {import("three").Scene|import("three").Object3D|null|undefined} scene
 * @param {string} domainId
 * @param {{ root?: import("three").Object3D|null }} [options]
 * @returns {import("three").Object3D[]}
 */
export function getObjectsByDomain(scene, domainId, options = {}) {
  const domainKey = normalizeDomainId(domainId);
  if (!domainKey) {
    return [];
  }
  const root = options.root ?? scene ?? null;
  const ids = getThreeJsonIdsByDomain(domainKey);
  const out = [];
  for (let i = 0; i < ids.length; i++) {
    const obj = getObjectByThreeJsonId(ids[i]);
    if (!obj) {
      continue;
    }
    if (root && !isDescendantOf(obj, root)) {
      continue;
    }
    out.push(obj);
  }
  return out;
}

/**
 * @param {import("three").Scene|import("three").Object3D|null|undefined} scene
 * @param {string} domainId
 * @param {{ root?: import("three").Object3D|null }} [options]
 * @returns {object[]}
 */
export function getObjJsonListByDomain(scene, domainId, options = {}) {
  const objects = getObjectsByDomain(scene, domainId, options);
  const out = [];
  for (let i = 0; i < objects.length; i++) {
    const j = objects[i]?.userData?.objJson;
    if (j && typeof j === "object" && !Array.isArray(j)) {
      out.push(j);
    }
  }
  return out;
}

export { getThreeJsonIdsByDomain } from "./domainIndex.js";

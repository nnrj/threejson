/**
 * Canonical scene object deployers by objType (registered by domains at load time).
 */

/** @type {Map<string, (record: object, scene: import("three").Scene, ctx?: object) => void>} */
const deployersByObjType = new Map();

function normalizeObjType(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * @param {string} objType
 * @param {(record: object, scene: import("three").Scene, ctx?: object) => void} deployer
 */
export function registerObjTypeDeployer(objType, deployer) {
  const key = normalizeObjType(objType);
  if (!key || typeof deployer !== "function") {
    throw new Error("[objTypeDeploy] objType and deployer function are required");
  }
  deployersByObjType.set(key, deployer);
}

/**
 * @param {string} objType
 * @param {object} record
 * @param {import("three").Scene} scene
 * @param {object} [ctx]
 * @returns {boolean} true if a deployer ran
 */
export function deployCanonicalObjType(objType, record, scene, ctx) {
  const key = normalizeObjType(objType);
  const deployer = deployersByObjType.get(key);
  if (!deployer) {
    return false;
  }
  deployer(record, scene, ctx);
  return true;
}

/**
 * @param {string} objType
 * @returns {boolean}
 */
export function hasObjTypeDeployer(objType) {
  return deployersByObjType.has(normalizeObjType(objType));
}

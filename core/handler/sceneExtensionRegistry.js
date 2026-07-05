/**
 * Scene extension registry: objType deploy and interaction resolution (registered by domain or app at startup; core does not import domains).
 */

/** @typedef {(record: object, scene: import("three").Scene|import("three").Object3D, ctx?: object) => void} ObjTypeDeployer */

/** @typedef {(object3D: import("three").Object3D) => { hinge: import("three").Object3D, descriptor: object }|null} InteractionResolver */

/** @typedef {(parent: import("three").Object3D, child: object, ctx?: object) => boolean} SubSceneChildDeployer */

/** @type {Map<string, ObjTypeDeployer>} */
const objTypeDeployers = new Map();

/** @type {InteractionResolver[]} */
const interactionResolvers = [];

/** @type {SubSceneChildDeployer[]} */
const subSceneChildDeployers = [];

/**
 * @param {string} objType Normalized lowercase objType, e.g. `wind`
 * @param {ObjTypeDeployer} deployer
 */
export function registerObjTypeDeployer(objType, deployer) {
  const key = String(objType || "").trim().toLowerCase();
  if (!key || typeof deployer !== "function") {
    throw new Error("[sceneExtension] registerObjTypeDeployer requires objType and function");
  }
  objTypeDeployers.set(key, deployer);
}

/**
 * @param {InteractionResolver} resolver
 */
export function registerInteractionResolver(resolver) {
  if (typeof resolver !== "function") {
    throw new Error("[sceneExtension] registerInteractionResolver requires a function");
  }
  interactionResolvers.push(resolver);
}

/**
 * @param {SubSceneChildDeployer} deployer Return true when this subScene child was handled
 */
export function registerSubSceneChildDeployer(deployer) {
  if (typeof deployer !== "function") {
    throw new Error("[sceneExtension] registerSubSceneChildDeployer requires a function");
  }
  subSceneChildDeployers.push(deployer);
}

/**
 * @param {string} objType
 * @returns {ObjTypeDeployer|null}
 */
export function getObjTypeDeployer(objType) {
  const key = String(objType || "").trim().toLowerCase();
  return objTypeDeployers.get(key) ?? null;
}

/**
 * @param {object} record
 * @param {import("three").Scene|import("three").Object3D} scene
 * @param {object} [ctx]
 * @returns {boolean} Whether an extension handled the deploy
 */
export function deployByObjTypeExtension(record, scene, ctx) {
  const key = String(record?.objType || "").trim().toLowerCase();
  if (!key) {
    return false;
  }
  const deployer = objTypeDeployers.get(key);
  if (!deployer) {
    return false;
  }
  deployer(record, scene, ctx);
  return true;
}

/**
 * @param {import("three").Object3D} object3D
 * @returns {{ hinge: import("three").Object3D, descriptor: object }|null}
 */
export function resolveInteractionTarget(object3D) {
  for (let i = 0; i < interactionResolvers.length; i++) {
    const resolved = interactionResolvers[i](object3D);
    if (resolved) {
      return resolved;
    }
  }
  return null;
}

/**
 * @param {import("three").Object3D} parent
 * @param {object} child
 * @param {object} [ctx]
 * @returns {boolean}
 */
export function tryDeploySubSceneChildByExtension(parent, child, ctx) {
  for (let i = 0; i < subSceneChildDeployers.length; i += 1) {
    if (subSceneChildDeployers[i](parent, child, ctx) === true) {
      return true;
    }
  }
  return false;
}

/** Clear for tests or hot reload (non-public API; unit tests only) */
export function _clearSceneExtensionsForTests() {
  objTypeDeployers.clear();
  interactionResolvers.length = 0;
  subSceneChildDeployers.length = 0;
}

/**
 * Scene helpers: GridHelper / AxesHelper (sceneConfig.helpers).
 */
import * as THREE from "three";
import { trackDisposableResource } from "../handler/trackedResourceRegistry.js";
import { registerObject, unregisterObject } from "../handler/objectRegistry.js";

const ASSIST_HELPER_OBJ_TYPES = new Set(["gridhelper", "axeshelper", "boxhelper"]);

function hasOwn(source, key) {
  return Boolean(source) && Object.prototype.hasOwnProperty.call(source, key);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasValue(value) {
  return value !== undefined && value !== null;
}

function clonePlainObject(value) {
  if (!isPlainObject(value)) {
    return null;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_e) {
    return { ...value };
  }
}

function normalizePosition(position = {}) {
  return {
    x: Number(hasValue(position.x) ? position.x : 0),
    y: Number(hasValue(position.y) ? position.y : 0),
    z: Number(hasValue(position.z) ? position.z : 0)
  };
}

function normalizeRotation(rotation = {}) {
  return {
    rotationX: Number(hasValue(rotation.rotationX) ? rotation.rotationX : 0),
    rotationY: Number(hasValue(rotation.rotationY) ? rotation.rotationY : 0),
    rotationZ: Number(hasValue(rotation.rotationZ) ? rotation.rotationZ : 0)
  };
}

function applyHelperTransform(object3D, config = {}) {
  const position = normalizePosition(config.position);
  const rotation = normalizeRotation(config.rotation);
  object3D.position.set(position.x, position.y, position.z);
  object3D.rotation.set(rotation.rotationX, rotation.rotationY, rotation.rotationZ);
  object3D.visible = config.visible !== false;
}

/**
 * Merge helpers from sceneConfig / worldInfo (includes gridHelper / axesHelper sugar).
 * `helpers.grid` / `helpers.axes` take precedence over top-level aliases; sceneConfig over worldInfo.
 *
 * @param {object} [sceneConfig]
 * @param {object} [worldInfo]
 * @returns {{ grid?: object, axes?: object }|null}
 */
export function normalizeHelpersConfig(sceneConfig = {}, worldInfo = {}) {
  const sc = isPlainObject(sceneConfig) ? sceneConfig : {};
  const wi = isPlainObject(worldInfo) ? worldInfo : {};
  const scHelpers = isPlainObject(sc.helpers) ? sc.helpers : {};
  const wiHelpers = isPlainObject(wi.helpers) ? wi.helpers : {};

  /** @type {{ grid?: object, axes?: object }} */
  const out = {};

  if (hasOwn(scHelpers, "grid") && isPlainObject(scHelpers.grid)) {
    out.grid = clonePlainObject(scHelpers.grid);
  } else if (hasOwn(wiHelpers, "grid") && isPlainObject(wiHelpers.grid)) {
    out.grid = clonePlainObject(wiHelpers.grid);
  } else if (hasOwn(sc, "gridHelper") && isPlainObject(sc.gridHelper)) {
    out.grid = clonePlainObject(sc.gridHelper);
  } else if (hasOwn(wi, "gridHelper") && isPlainObject(wi.gridHelper)) {
    out.grid = clonePlainObject(wi.gridHelper);
  }

  if (hasOwn(scHelpers, "axes") && isPlainObject(scHelpers.axes)) {
    out.axes = clonePlainObject(scHelpers.axes);
  } else if (hasOwn(wiHelpers, "axes") && isPlainObject(wiHelpers.axes)) {
    out.axes = clonePlainObject(wiHelpers.axes);
  } else if (hasOwn(sc, "axesHelper") && isPlainObject(sc.axesHelper)) {
    out.axes = clonePlainObject(sc.axesHelper);
  } else if (hasOwn(wi, "axesHelper") && isPlainObject(wi.axesHelper)) {
    out.axes = clonePlainObject(wi.axesHelper);
  }

  if (!out.grid && !out.axes) {
    return null;
  }
  return out;
}

/**
 * @param {object|null|undefined} helpersConfig
 * @returns {object|null}
 */
export function canonicalizeHelpersForSceneConfig(helpersConfig) {
  if (!helpersConfig || typeof helpersConfig !== "object") {
    return null;
  }
  const next = {};
  if (isPlainObject(helpersConfig.grid)) {
    next.grid = clonePlainObject(helpersConfig.grid);
  }
  if (isPlainObject(helpersConfig.axes)) {
    next.axes = clonePlainObject(helpersConfig.axes);
  }
  return Object.keys(next).length > 0 ? next : null;
}

/**
 * @param {object} config
 * @param {string} objType
 * @returns {THREE.GridHelper|THREE.AxesHelper|null}
 */
export function createSceneHelperFromConfig(config, objType) {
  if (!config || typeof config !== "object") {
    return null;
  }
  if (config.visible === false) {
    return null;
  }

  let helper = null;
  if (objType === "gridHelper") {
    const size = Number(hasValue(config.size) ? config.size : 10);
    const divisions = Math.max(1, Math.floor(Number(hasValue(config.divisions) ? config.divisions : 10)));
    const colorCenterLine = hasValue(config.colorCenterLine) ? config.colorCenterLine : 0x444444;
    const colorGrid = hasValue(config.colorGrid) ? config.colorGrid : 0x888888;
    helper = new THREE.GridHelper(size, divisions, colorCenterLine, colorGrid);
  } else if (objType === "axesHelper") {
    const size = Number(hasValue(config.size) ? config.size : 10);
    helper = new THREE.AxesHelper(size);
  } else {
    return null;
  }

  trackDisposableResource(helper);
  applyHelperTransform(helper, config);
  helper.userData = {
    ...(typeof helper.userData === "object" && helper.userData ? helper.userData : {}),
    objJson: {
      objType,
      ...clonePlainObject(config)
    }
  };
  return helper;
}

function isAssistHelperNode(child) {
  const objType = typeof child?.userData?.objJson?.objType === "string"
    ? child.userData.objJson.objType.trim().toLowerCase()
    : "";
  return ASSIST_HELPER_OBJ_TYPES.has(objType);
}

function disposeAssistHelperNode(child) {
  if (!child) {
    return;
  }
  unregisterObject(child, { recursive: true, keepDescriptor: false });
  if (child.geometry && typeof child.geometry.dispose === "function") {
    child.geometry.dispose();
  }
  if (child.material && typeof child.material.dispose === "function") {
    child.material.dispose();
  }
  if (child.parent) {
    child.parent.remove(child);
  }
}

/**
 * @param {import("three").Object3D} parent Usually Scene; only replaces/removes assist helper nodes
 * @param {{ grid?: object, axes?: object }|null|undefined} helpersConfig
 */
export function mountSceneHelpers(parent, helpersConfig) {
  if (!parent) {
    return;
  }
  if (typeof parent.traverse === "function") {
    const toRemove = [];
    parent.traverse((child) => {
      if (child !== parent && isAssistHelperNode(child)) {
        toRemove.push(child);
      }
    });
    for (let i = 0; i < toRemove.length; i++) {
      disposeAssistHelperNode(toRemove[i]);
    }
  }

  if (!helpersConfig || typeof helpersConfig !== "object") {
    return;
  }

  if (helpersConfig.grid) {
    const grid = createSceneHelperFromConfig(helpersConfig.grid, "gridHelper");
    if (grid) {
      parent.add(grid);
      registerObject(grid, grid.userData?.objJson, { recursive: false });
    }
  }
  if (helpersConfig.axes) {
    const axes = createSceneHelperFromConfig(helpersConfig.axes, "axesHelper");
    if (axes) {
      parent.add(axes);
      registerObject(axes, axes.userData?.objJson, { recursive: false });
    }
  }
}

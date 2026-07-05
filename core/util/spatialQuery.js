import * as THREE from "three";

import {
  aabbOverlaps,
  readObjJsonFromUserData,
  shouldSkipObjType
} from "./spatialQueryUtil.js";

/**
 * @param {THREE.Box3} box3
 * @param {THREE.Object3D} object
 * @param {{ precise?: boolean }} [options]
 * @returns {THREE.Box3}
 */
export function setBox3FromObject(box3, object, options = {}) {
  if (!box3 || !object) {
    return box3;
  }
  box3.setFromObject(object, options.precise === true);
  return box3;
}

/**
 * @param {THREE.Box3} a
 * @param {THREE.Box3} b
 * @returns {boolean}
 */
export function box3IntersectsBox3(a, b) {
  if (!a || !b) {
    return false;
  }
  return a.intersectsBox(b);
}

/**
 * @param {THREE.Box3} box3
 * @returns {{ halfX: number, halfY: number, halfZ: number, center: THREE.Vector3, size: THREE.Vector3 }}
 */
/**
 * Estimate object center Y at rest from floor AABB top + object half-height (not a physics engine).
 * @param {THREE.Object3D|null} floorObject
 * @param {THREE.Object3D|null} object
 * @param {{ fallbackCenterY?: number }} [options]
 * @returns {number}
 */
export function computeMeshCenterRestYOnAabbFloor(floorObject, object, options = {}) {
  const fallback = Number.isFinite(options.fallbackCenterY) ? options.fallbackCenterY : 0;
  if (!floorObject || !object || typeof floorObject.updateWorldMatrix !== "function") {
    return fallback;
  }
  const floorBox = new THREE.Box3().setFromObject(floorObject);
  const objBox = new THREE.Box3().setFromObject(object);
  const objSize = new THREE.Vector3();
  objBox.getSize(objSize);
  const halfY = Math.max(objSize.y * 0.5, 1e-4);
  return floorBox.max.y + halfY;
}

export function box3ToCuboidHalfExtents(box3) {
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  if (!box3) {
    return { halfX: 0.5, halfY: 0.5, halfZ: 0.5, center, size };
  }
  box3.getSize(size);
  box3.getCenter(center);
  return {
    halfX: Math.max(size.x * 0.5, 1e-4),
    halfY: Math.max(size.y * 0.5, 1e-4),
    halfZ: Math.max(size.z * 0.5, 1e-4),
    center,
    size
  };
}

/**
 * @param {THREE.Object3D} root
 * @param {object} [options]
 * @param {string} [options.excludeUuid]
 * @param {boolean} [options.skipBoxHelper=true]
 * @param {boolean} [options.requireGeometry=true]
 * @param {boolean} [options.requireObjJson=true]
 * @param {Iterable<string>|Set<string>} [options.skipObjTypes]
 * @param {(obj: THREE.Object3D) => boolean} [options.predicate]
 * @returns {THREE.Object3D[]}
 */
export function collectObjectsWithObjJson(root, options = {}) {
  if (!root || typeof root.traverse !== "function") {
    return [];
  }
  const excludeUuid = options.excludeUuid;
  const skipBoxHelper = options.skipBoxHelper !== false;
  const requireGeometry = options.requireGeometry !== false;
  const requireObjJson = options.requireObjJson !== false;
  const skipObjTypes = options.skipObjTypes;
  const predicate = typeof options.predicate === "function" ? options.predicate : null;
  /** @type {THREE.Object3D[]} */
  const results = [];

  root.traverse((subObj) => {
    if (!subObj) {
      return;
    }
    if (excludeUuid && subObj.uuid === excludeUuid) {
      return;
    }
    if (skipBoxHelper && subObj.type === "BoxHelper") {
      return;
    }
    if (requireGeometry && !subObj.geometry) {
      return;
    }
    const objJson = readObjJsonFromUserData(subObj.userData);
    if (requireObjJson && !objJson) {
      return;
    }
    if (objJson && shouldSkipObjType(objJson.objType ?? objJson.type, skipObjTypes)) {
      return;
    }
    if (predicate && !predicate(subObj)) {
      return;
    }
    results.push(subObj);
  });

  return results;
}

/**
 * AABB intersection query (does not modify scene or add helpers).
 * @param {THREE.Object3D} sourceObject
 * @param {THREE.Object3D} sceneRoot
 * @param {object} [options] same as {@link collectObjectsWithObjJson}
 * @returns {THREE.Object3D[]}
 */
export function findAabbIntersections(sourceObject, sceneRoot, options = {}) {
  if (!sourceObject || !sourceObject.geometry || !sceneRoot) {
    return [];
  }
  const sourceBox = new THREE.Box3().setFromObject(sourceObject);
  const candidates = collectObjectsWithObjJson(sceneRoot, {
    ...options,
    excludeUuid: sourceObject.uuid
  });
  /** @type {THREE.Object3D[]} */
  const hits = [];
  const scratch = new THREE.Box3();

  for (let i = 0; i < candidates.length; i++) {
    const other = candidates[i];
    scratch.setFromObject(other);
    if (sourceBox.intersectsBox(scratch)) {
      hits.push(other);
    }
  }
  return hits;
}

/**
 * @param {{ x: number, y: number }} ndc
 * @param {THREE.Camera} camera
 * @param {THREE.Ray} [target]
 * @returns {THREE.Ray}
 */
export function ndcToRay(ndc, camera, target) {
  const ray = target || new THREE.Ray();
  if (!camera || !ndc) {
    return ray;
  }
  ray.origin.setFromMatrixPosition(camera.matrixWorld);
  ray.direction
    .set(ndc.x, ndc.y, 0.5)
    .unproject(camera)
    .sub(ray.origin)
    .normalize();
  return ray;
}

/**
 * @param {object} params
 * @param {THREE.Raycaster} params.raycaster
 * @param {THREE.Ray} params.ray
 * @param {THREE.Object3D} params.scene
 * @param {THREE.Object3D[]} [params.objects]
 * @param {boolean} [params.recursive=true]
 * @param {number} [params.near]
 * @param {number} [params.far]
 * @returns {THREE.Intersection[]}
 */
export function raycastScene(params) {
  const raycaster = params?.raycaster;
  const ray = params?.ray;
  const scene = params?.scene;
  if (!raycaster || !ray || !scene) {
    return [];
  }
  if (Number.isFinite(params.near)) {
    raycaster.near = params.near;
  }
  if (Number.isFinite(params.far)) {
    raycaster.far = params.far;
  }
  raycaster.set(ray.origin, ray.direction);
  const objects = params.objects;
  const recursive = params.recursive !== false;
  if (Array.isArray(objects) && objects.length > 0) {
    return raycaster.intersectObjects(objects, recursive);
  }
  return raycaster.intersectObject(scene, recursive);
}

export { aabbOverlaps, readObjJsonFromUserData, shouldSkipObjType };

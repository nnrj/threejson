import * as THREE from "three";

import { raycastScene } from "./spatialQuery.js";
import { readObjJsonFromUserData } from "./spatialQueryUtil.js";

/** @type {typeof import("three-mesh-bvh")|null} */
let meshBvhModulePromise = null;

/**
 * Lazy-load `three-mesh-bvh` (browser or installed Node environment).
 * @returns {Promise<typeof import("three-mesh-bvh")>}
 */
export function loadMeshBvhModule() {
  if (!meshBvhModulePromise) {
    meshBvhModulePromise = import("three-mesh-bvh");
  }
  return meshBvhModulePromise;
}

/**
 * @param {object|null|undefined} sceneConfig
 * @param {object|null|undefined} objJson
 * @returns {boolean}
 */
export function shouldUseMeshBvhPick(sceneConfig, objJson) {
  if (sceneConfig?.pick?.meshBvh === true) {
    return true;
  }
  const precision = objJson?.pick?.precision;
  if (typeof precision === "string") {
    const p = precision.trim().toLowerCase();
    return p === "bvh" || p === "meshbvh" || p === "mesh-bvh";
  }
  return false;
}

/**
 * @param {import("three").Mesh} mesh
 * @param {typeof import("three-mesh-bvh")} bvhMod
 */
export function ensureMeshBvhOnMesh(mesh, bvhMod) {
  if (!mesh?.isMesh || !mesh.geometry || !bvhMod) {
    return;
  }
  const geo = mesh.geometry;
  if (!geo.boundsTree && typeof bvhMod.computeBoundsTree === "function") {
    geo.computeBoundsTree = bvhMod.computeBoundsTree;
    geo.disposeBoundsTree = bvhMod.disposeBoundsTree;
    geo.computeBoundsTree();
  }
  if (typeof bvhMod.acceleratedRaycast === "function") {
    mesh.raycast = bvhMod.acceleratedRaycast;
  }
}

/**
 * Install BVH raycast on eligible scene meshes (not called by default; opt-in).
 * @param {import("three").Object3D} root
 * @param {object} [options]
 * @param {boolean} [options.sceneMeshBvh=false]
 * @param {typeof import("three-mesh-bvh")} [options.bvhModule]
 */
export async function applyMeshBvhPickToScene(root, options = {}) {
  const bvhMod = options.bvhModule || (await loadMeshBvhModule());
  const sceneMeshBvh = options.sceneMeshBvh === true;
  if (!root || typeof root.traverse !== "function") {
    return;
  }
  root.traverse((obj) => {
    if (!obj?.isMesh) {
      return;
    }
    const objJson = readObjJsonFromUserData(obj.userData);
    if (sceneMeshBvh || shouldUseMeshBvhPick(null, objJson)) {
      ensureMeshBvhOnMesh(obj, bvhMod);
    }
  });
}

/**
 * Raycast with optional BVH acceleration (target mesh must have {@link ensureMeshBvhOnMesh} applied).
 * @param {object} params same as {@link raycastScene}, plus `useMeshBvh?: boolean`
 * @returns {Promise<THREE.Intersection[]>|THREE.Intersection[]}
 */
export async function raycastSceneWithPick(params) {
  const useMeshBvh = params?.useMeshBvh === true;
  if (useMeshBvh && params?.scene) {
    await applyMeshBvhPickToScene(params.scene, {
      sceneMeshBvh: params.sceneMeshBvh === true,
      bvhModule: params.bvhModule
    });
  }
  return raycastScene(params);
}

const DEFAULT_SKIP_USER_DATA_TYPES = new Set([
  "impactcheckboxhelper",
  "impactcheckbox3",
  "helperboxedge"
]);

/**
 * @param {import("three").Object3D|null|undefined} obj
 * @param {object} [options]
 * @param {(obj: import("three").Object3D) => boolean} [options.isEditable]
 * @param {Set<string>} [options.skipUserDataTypes]
 * @returns {import("three").Object3D|null}
 */
function resolvePickTarget(obj, options = {}) {
  const isEditable =
    typeof options.isEditable === "function" ? options.isEditable : () => true;
  const skipTypes = options.skipUserDataTypes || DEFAULT_SKIP_USER_DATA_TYPES;
  let node = obj;
  while (node) {
    const typeRaw = node.userData?.type;
    const typeKey =
      typeof typeRaw === "string" ? typeRaw.trim().toLowerCase() : "";
    if (typeKey && skipTypes.has(typeKey)) {
      node = node.parent;
      continue;
    }
    if (node.type === "TransformControls") {
      node = node.parent;
      continue;
    }
    if (isEditable(node)) {
      return node;
    }
    node = node.parent;
  }
  return null;
}

/**
 * Editor-oriented pick: NDC ray + optional ancestor resolution (core export only when not wired to a page).
 * @param {object} params
 * @param {import("three").Vector2|{x:number,y:number}} params.ndc
 * @param {import("three").Camera} params.camera
 * @param {import("three").Scene|import("three").Object3D} params.scene
 * @param {import("three").Object3D[]} [params.objects]
 * @param {boolean} [params.recursive=true]
 * @param {(obj: import("three").Object3D) => boolean} [params.isEditable]
 * @param {boolean} [params.resolveAncestors=true]
 * @returns {import("three").Object3D|null}
 */
/**
 * @param {import("three").Object3D|null|undefined} hit
 * @param {import("three").Object3D|null|undefined} root
 * @returns {boolean}
 */
export function isDescendantOf(hit, root) {
  if (!hit || !root) {
    return false;
  }
  let node = hit;
  while (node) {
    if (node === root) {
      return true;
    }
    node = node.parent;
  }
  return false;
}

/**
 * @param {import("three").Object3D|null|undefined} hit
 * @param {import("three").Object3D|null|undefined} helperRoot TransformControls.getHelper() root node
 * @returns {boolean}
 */
export function isHitOnTransformControlsHelper(hit, helperRoot) {
  if (!hit || !helperRoot) {
    return false;
  }
  return isDescendantOf(hit, helperRoot);
}

export function pickEditableObject(params) {
  const camera = params?.camera;
  const scene = params?.scene;
  const ndc = params?.ndc;
  if (!camera || !scene || !ndc) {
    return null;
  }
  const raycaster = new THREE.Raycaster();
  raycaster.camera = camera;
  const mouse = ndc.isVector2 ? ndc : new THREE.Vector2(ndc.x, ndc.y);
  raycaster.setFromCamera(mouse, camera);
  const objects = params.objects;
  const recursive = params.recursive !== false;
  const hits =
    Array.isArray(objects) && objects.length > 0
      ? raycaster.intersectObjects(objects, recursive)
      : raycaster.intersectObject(scene, recursive);
  if (!hits.length) {
    return null;
  }
  if (params.resolveAncestors === false) {
    return hits[0].object;
  }
  return resolvePickTarget(hits[0].object, {
    isEditable: params.isEditable,
    skipUserDataTypes: params.skipUserDataTypes
  });
}

/**
 * @param {THREE.Material|THREE.Material[]|null|undefined} materialLike
 * @returns {THREE.Material}
 */
function resolveRuntimeFallbackMaterial(materialLike) {
  if (Array.isArray(materialLike)) {
    for (let i = 0; i < materialLike.length; i += 1) {
      if (materialLike[i]?.isMaterial === true) {
        return materialLike[i];
      }
    }
  } else if (materialLike?.isMaterial === true) {
    return materialLike;
  }
  return new THREE.MeshStandardMaterial({ color: 0xcccccc });
}

/**
 * CSG / merge may produce sparse material[] arrays, causing Raycaster to read undefined.side.
 * @param {import("three").Mesh|null|undefined} mesh
 * @param {THREE.Material|THREE.Material[]|null|undefined} [fallbackHint]
 * @returns {import("three").Mesh|null|undefined}
 */
export function coerceMeshMaterialForRaycast(mesh, fallbackHint) {
  if (!mesh?.isMesh) {
    return mesh;
  }
  const fallback = resolveRuntimeFallbackMaterial(fallbackHint ?? mesh.material);
  const mat = mesh.material;
  if (!mat) {
    mesh.material = fallback;
    return mesh;
  }
  if (!Array.isArray(mat)) {
    return mesh;
  }
  for (let i = 0; i < mat.length; i += 1) {
    if (!mat[i] || mat[i].isMaterial !== true) {
      mat[i] = fallback;
    }
  }
  const groups = mesh.geometry?.groups;
  if (groups?.length) {
    let maxIdx = 0;
    for (let gi = 0; gi < groups.length; gi += 1) {
      const idx = groups[gi].materialIndex;
      if (Number.isFinite(idx) && idx > maxIdx) {
        maxIdx = idx;
      }
    }
    while (mat.length <= maxIdx) {
      mat.push(fallback);
    }
  }
  return mesh;
}

import { Source } from "three";
import { shouldSkipSceneExportNode } from "./sceneExportNode.js";
import {
  cloneSceneGraphForNativeExport,
  omitExternalFileModelsForNativeExport,
  stripNonSerializableNodesForNativeExport
} from "./util.js";

function resolveSceneFromTarget(target) {
  if (target?.isScene === true) {
    return target;
  }
  if (target?.scene?.isScene === true) {
    return target.scene;
  }
  return null;
}

function normalizeScope(scope) {
  const key = typeof scope === "string" ? scope.trim().toLowerCase() : "scene";
  if (key === "scene" || key === "selection" || key === "object") {
    return key;
  }
  const error = new Error(`E_MESH_EXPORT_SCOPE_INVALID: unsupported scope "${scope}"`);
  error.code = "E_MESH_EXPORT_SCOPE_INVALID";
  throw error;
}

function countSubtreeTriangles(object3D) {
  let total = 0;
  if (!object3D?.traverse) {
    return total;
  }
  object3D.traverse((obj) => {
    if (!obj?.isMesh || !obj.geometry) {
      return;
    }
    const geo = obj.geometry;
    if (geo.index?.count) {
      total += Math.floor(geo.index.count / 3);
      return;
    }
    const pos = geo.attributes?.position;
    if (pos?.count) {
      total += Math.floor(pos.count / 3);
    }
  });
  return total;
}

/**
 * @param {import("three").Object3D} root
 * @returns {{ meshCount: number, triangleCount: number, objectCount: number }}
 */
function measureMeshExportRootStats(root) {
  let meshCount = 0;
  let objectCount = 0;
  if (!root?.traverse) {
    return { meshCount, triangleCount: 0, objectCount };
  }
  root.traverse((obj) => {
    if (!obj) {
      return;
    }
    objectCount += 1;
    if (obj.isMesh || obj.isPoints) {
      meshCount += 1;
    }
  });
  return {
    meshCount,
    triangleCount: countSubtreeTriangles(root),
    objectCount
  };
}

/**
 * @param {import("three").Object3D} root
 * @param {(obj: import("three").Object3D) => boolean} shouldSkip
 */
function removeSkippedTopLevelChildren(root, shouldSkip) {
  if (!root?.children?.length) {
    return 0;
  }
  let removed = 0;
  for (let i = root.children.length - 1; i >= 0; i -= 1) {
    const child = root.children[i];
    if (child && shouldSkip(child)) {
      root.remove(child);
      removed += 1;
    }
  }
  return removed;
}

/** Give the export clone independent materials/textures so recovery or omission never mutates the live scene. */
function cloneMeshExportMaterialsAndTextures(root) {
  const materialClones = new Map();
  const textureClones = new Map();
  const cloneTexture = (texture) => {
    if (!texture?.isTexture) return texture;
    if (textureClones.has(texture)) return textureClones.get(texture);
    const cloned = texture.clone();
    cloned.source = new Source(texture.source?.data ?? texture.image ?? null);
    textureClones.set(texture, cloned);
    return cloned;
  };
  const cloneMaterial = (material) => {
    if (!material?.isMaterial) return material;
    if (materialClones.has(material)) return materialClones.get(material);
    const cloned = material.clone();
    materialClones.set(material, cloned);
    for (const key of Object.keys(cloned)) {
      if (cloned[key]?.isTexture === true) {
        cloned[key] = cloneTexture(cloned[key]);
      }
    }
    return cloned;
  };
  root?.traverse?.((object3D) => {
    if (Array.isArray(object3D?.material)) {
      object3D.material = object3D.material.map(cloneMaterial);
    } else if (object3D?.material) {
      object3D.material = cloneMaterial(object3D.material);
    }
  });
}

/**
 * Prepare a cloned root for mesh export (does not modify the live scene).
 *
 * @param {import("three").Scene | { scene: import("three").Scene } | import("three").Object3D} target
 * @param {object} [options]
 * @param {"scene"|"selection"|"object"} [options.scope]
 * @param {import("three").Object3D} [options.selectedObject3D]
 * @param {import("three").Object3D} [options.object3D]
 * @param {(obj: import("three").Object3D) => boolean} [options.shouldSkipObject]
 * @param {"include"|"omitHeavy"} [options.externalModelPolicy]
 * @returns {{ exportRoot: import("three").Object3D, warnings: object[], omitted: object[], stats: object }}
 */
function prepareMeshExportRoot(target, options = {}) {
  const scope = normalizeScope(options.scope || "scene");
  const shouldSkip = typeof options.shouldSkipObject === "function"
    ? options.shouldSkipObject
    : shouldSkipSceneExportNode;
  /** @type {object[]} */
  const warnings = [];
  /** @type {object[]} */
  let omitted = [];

  let exportRoot;
  if (scope === "object") {
    const source = options.object3D;
    if (!source?.isObject3D) {
      const error = new Error("E_MESH_EXPORT_NO_TARGET: object scope requires object3D");
      error.code = "E_MESH_EXPORT_NO_TARGET";
      throw error;
    }
    exportRoot = source.clone(true);
    stripNonSerializableNodesForNativeExport(exportRoot);
  } else if (scope === "selection") {
    const source = options.selectedObject3D;
    if (!source?.isObject3D) {
      const error = new Error("E_MESH_EXPORT_NO_TARGET: selection scope requires selectedObject3D");
      error.code = "E_MESH_EXPORT_NO_TARGET";
      throw error;
    }
    exportRoot = source.clone(true);
    stripNonSerializableNodesForNativeExport(exportRoot);
  } else {
    const scene = resolveSceneFromTarget(target);
    if (!scene?.isScene) {
      const error = new Error("E_MESH_EXPORT_NO_SCENE: scene scope requires THREE.Scene");
      error.code = "E_MESH_EXPORT_NO_SCENE";
      throw error;
    }
    exportRoot = cloneSceneGraphForNativeExport(scene, []);
    const removed = removeSkippedTopLevelChildren(exportRoot, shouldSkip);
    if (removed > 0) {
      warnings.push({
        code: "skipped_nodes",
        message: `Skipped ${removed} top-level node(s) excluded from export (gizmo/helper/runtime, etc.).`
      });
    }
  }

  cloneMeshExportMaterialsAndTextures(exportRoot);

  const externalModelPolicy = options.externalModelPolicy === "omitHeavy" ? "omitHeavy" : "include";
  if (externalModelPolicy === "omitHeavy") {
    const omitResult = omitExternalFileModelsForNativeExport(exportRoot, options.omitOptions || {});
    omitted = omitResult.omitted || [];
    if (omitResult.removedCount > 0) {
      warnings.push({
        code: "external_models_omitted",
        message: `Omitted ${omitResult.removedCount} heavy external-model subtree(s).`,
        objects: omitted
      });
    }
  }

  const stats = measureMeshExportRootStats(exportRoot);
  if (stats.meshCount <= 0) {
    const error = new Error("E_MESH_EXPORT_EMPTY: no exportable mesh geometry in target");
    error.code = "E_MESH_EXPORT_EMPTY";
    throw error;
  }

  return {
    exportRoot,
    warnings,
    omitted,
    stats
  };
}

export {
  measureMeshExportRootStats,
  cloneMeshExportMaterialsAndTextures,
  normalizeScope,
  prepareMeshExportRoot,
  resolveSceneFromTarget
};

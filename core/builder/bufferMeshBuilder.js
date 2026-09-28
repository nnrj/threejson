/**
 * Full ThreeJSON BufferGeometry mesh entry.
 *
 * Supports the compact positions/indices/normals/uvs shorthand and the complete attributes,
 * index, groups, drawRange and morphAttributes descriptor. There is intentionally no engine-owned
 * vertex/triangle/byte ceiling; a host may inject an optional meshBudget through the deploy
 * context or build options.
 */
import * as THREE from "three";
import { log } from "../util/logger.js";
import { trackDisposableResource } from "../handler/trackedResourceRegistry.js";
import { registerObject } from "../handler/objectRegistry.js";
import { setUserDataObjJson } from "../handler/objectDescriptorAttach.js";
import { applyVisibilityFromDescriptor } from "../util/util.js";
import { applyParallelToOrRotation } from "./shapeTransformUtil.js";
import { createMaterialFromDescriptor } from "./material/materialFactory.js";
import { resolveRuntimeContext } from "../runtime/runtimeContext.js";
import { applyMaterialTextureSetFromJson } from "../util/loadTextureFromMaterialJson.js";

import { buildBufferMeshGeometry as evaluateBufferMeshGeometry } from "../geometry/bufferMeshGeometry.js";

export function buildBufferMeshGeometry(record, options) {
  const result = evaluateBufferMeshGeometry(record, options);
  if (result.geometry) trackDisposableResource(result.geometry);
  return result;
}

/** Build the one or many materials referenced by a buffer/editable mesh descriptor. */
export function buildBufferMeshMaterials(record = {}) {
  const descriptors = Array.isArray(record.materials) && record.materials.length > 0
    ? record.materials
    : [record.material && typeof record.material === "object" ? record.material : {}];
  const materials = descriptors.map((descriptor) => {
    const material = createMaterialFromDescriptor(descriptor, {
      fallbackType: "standard",
      defaultColor: "#cccccc"
    });
    trackDisposableResource(material);
    return material;
  });
  return materials.length === 1 ? materials[0] : materials;
}

/** Apply shared mesh-level fields without rebuilding geometry. */
export function applyBufferMeshRecord(mesh, record = {}) {
  applyParallelToOrRotation(mesh, record);
  applyVisibilityFromDescriptor(mesh, record);
  mesh.castShadow = record.castShadow === true;
  mesh.receiveShadow = record.receiveShadow !== false;
  if (record.name) mesh.name = record.name;
  if (Array.isArray(mesh.morphTargetInfluences)) {
    if (Array.isArray(record.morphInfluences)) {
      for (let i = 0; i < Math.min(record.morphInfluences.length, mesh.morphTargetInfluences.length); i += 1) {
        const value = Number(record.morphInfluences[i]);
        if (Number.isFinite(value)) mesh.morphTargetInfluences[i] = value;
      }
    } else if (record.morphInfluences && typeof record.morphInfluences === "object") {
      for (const [target, rawValue] of Object.entries(record.morphInfluences)) {
        const numericIndex = /^\d+$/.test(target) ? Number(target) : mesh.morphTargetDictionary?.[target];
        const value = Number(rawValue);
        if (Number.isSafeInteger(numericIndex) && numericIndex >= 0 && numericIndex < mesh.morphTargetInfluences.length && Number.isFinite(value)) {
          mesh.morphTargetInfluences[numericIndex] = value;
        }
      }
    }
  }
}

/**
 * @param {object} record
 * @param {import("three").Object3D} parent
 * @param {object} [ctx]
 * @returns {import("three").Mesh|null}
 */
export function createBufferMesh(record, parent, ctx = {}) {
  if (!record || !parent) return null;
  const built = buildBufferMeshGeometry(record, {
    meshBudget: ctx?.meshBudget ?? ctx?.options?.meshBudget,
    resolveBufferReference: ctx?.resolveBufferReference ?? ctx?.options?.resolveBufferReference ?? resolveRuntimeContext(parent).resolveBufferReference
  });
  if (!built.geometry) {
    if (ctx.throwOnError) throw Object.assign(new Error(built.error || "Invalid bufferMesh geometry."), { code: built.code || "INVALID_GEOMETRY" });
    log.warn("[bufferMesh]", built.code || "build failed", built.error || "", record?.name || "");
    return null;
  }
  const mesh = new THREE.Mesh(built.geometry, buildBufferMeshMaterials(record));
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const descriptors = record.materials?.length ? record.materials : [record.material || {}];
  materials.forEach((material, index) => applyMaterialTextureSetFromJson(material, descriptors[index] || {}, { runtimeScope: parent }));
  trackDisposableResource(mesh);
  applyBufferMeshRecord(mesh, record);
  setUserDataObjJson(mesh, record);
  mesh.userData.threeJsonMeshStats = built.stats;
  parent.add(mesh);
  registerObject(mesh, record, {}, parent);
  return mesh;
}

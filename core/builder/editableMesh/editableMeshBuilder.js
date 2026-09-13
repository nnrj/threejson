/** Runtime builder for AI-friendly stable-ID control meshes. */
import * as THREE from "three";
import { log } from "../../util/logger.js";
import { trackDisposableResource } from "../../handler/trackedResourceRegistry.js";
import { registerObject } from "../../handler/objectRegistry.js";
import { setUserDataObjJson } from "../../handler/objectDescriptorAttach.js";
import { buildBufferMeshMaterials, applyBufferMeshRecord } from "../bufferMeshBuilder.js";
import { evaluateEditableMeshGeometry } from "../../geometry/editableMeshGeometry.js";
import { takePreparedGeometry } from "../../geometry/preparedGeometry.js";

export function buildEditableMeshGeometry(record = {}, options = {}) {
  const built = evaluateEditableMeshGeometry(record, options);
  if (built.geometry) trackDisposableResource(built.geometry);
  return built;
}

export function createEditableMesh(record, parent, ctx = {}) {
  if (!record || !parent) return null;
  const built = takePreparedGeometry(record, parent) || buildEditableMeshGeometry(record, {
    meshBudget: ctx?.meshBudget ?? ctx?.options?.meshBudget
  });
  if (!built.geometry) {
    log.warn("[editableMesh]", built.code || "build failed", built.error || "", record?.name || "");
    return null;
  }
  const mesh = new THREE.Mesh(built.geometry, buildBufferMeshMaterials(record));
  trackDisposableResource(mesh);
  applyBufferMeshRecord(mesh, record);
  const descriptor = {
    ...record,
    topology: built.sourceTopology,
    modifiers: Array.isArray(record.modifiers) ? record.modifiers : []
  };
  setUserDataObjJson(mesh, descriptor);
  mesh.userData.threeJsonMeshStats = built.stats;
  parent.add(mesh);
  registerObject(mesh, mesh.userData.objJson, {}, parent);
  return mesh;
}

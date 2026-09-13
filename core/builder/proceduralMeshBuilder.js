/** Compact procedural descriptions for smooth/free-form meshes. */
import * as THREE from "three";
import { evaluateNumericExpression } from "../util/numericExpression.js";
import { log } from "../util/logger.js";
import { trackDisposableResource } from "../handler/trackedResourceRegistry.js";
import { registerObject } from "../handler/objectRegistry.js";
import { setUserDataObjJson } from "../handler/objectDescriptorAttach.js";
import { buildBufferMeshMaterials, applyBufferMeshRecord } from "./bufferMeshBuilder.js";
import { evaluateProceduralMeshGeometry, PROCEDURAL_MESH_OBJ_TYPES } from "../geometry/proceduralMeshGeometry.js";
import { takePreparedGeometry } from "../geometry/preparedGeometry.js";

export function buildProceduralMeshGeometry(record = {}, options = {}) {
  const built = evaluateProceduralMeshGeometry(record, options);
  if (built.geometry) trackDisposableResource(built.geometry);
  return built;
}

export function createProceduralMesh(record, parent, ctx = {}) {
  const built = takePreparedGeometry(record, parent) || buildProceduralMeshGeometry(record, { meshBudget: ctx?.meshBudget ?? ctx?.options?.meshBudget });
  if (!built.geometry) {
    log.warn("[proceduralMesh]", built.code, built.error, record?.name || "");
    return null;
  }
  const mesh = new THREE.Mesh(built.geometry, buildBufferMeshMaterials(record));
  trackDisposableResource(mesh);
  applyBufferMeshRecord(mesh, record);
  setUserDataObjJson(mesh, record);
  mesh.userData.threeJsonMeshStats = built.stats;
  parent.add(mesh);
  registerObject(mesh, record, {}, parent);
  return mesh;
}

export { PROCEDURAL_MESH_OBJ_TYPES };

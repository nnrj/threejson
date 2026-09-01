import { getObjTypeDeployer, registerObjTypeDeployer } from "../handler/sceneExtensionRegistry.js";
import { createEditableMesh } from "./editableMesh/editableMeshBuilder.js";
import { createProceduralMesh, PROCEDURAL_MESH_OBJ_TYPES } from "./proceduralMeshBuilder.js";

let registered = false;

/** Register advanced, authoring-oriented mesh descriptors on demand. The default runtime loads
 * this module only after a scene actually references one of these objTypes. */
export function ensureComplexMeshCapabilityRegistered() {
  if (registered && getObjTypeDeployer("editablemesh")) return;
  registerObjTypeDeployer("editablemesh", (record, parent, ctx) => {
    createEditableMesh(record, parent, ctx);
  });
  for (const type of PROCEDURAL_MESH_OBJ_TYPES) {
    registerObjTypeDeployer(type, (record, parent, ctx) => {
      createProceduralMesh(record, parent, ctx);
    });
  }
  registered = true;
}

export function isComplexMeshCapabilityRegistered() {
  return registered;
}

ensureComplexMeshCapabilityRegistered();

export * from "./editableMesh/index.js";
export * from "./proceduralMeshBuilder.js";
export * from "../runtime/editableMeshOperations.js";
export * from "../runtime/meshRuntime.js";

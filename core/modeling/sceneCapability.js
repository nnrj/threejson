import { Mesh } from "three";
import { registerObjTypeDeployer } from "../handler/sceneExtensionRegistry.js";
import { registerSceneCapabilityPreparer } from "../capabilities/scenePreparationRegistry.js";
import { resolveRuntimeContext } from "../runtime/runtimeContext.js";
import { setUserDataObjJson } from "../handler/objectDescriptorAttach.js";
import { registerObject } from "../handler/objectRegistry.js";
import { trackDisposableResource } from "../handler/trackedResourceRegistry.js";
import { applyBufferMeshRecord, buildBufferMeshMaterials } from "../builder/bufferMeshBuilder.js";
import { applyMaterialTextureSetFromJson } from "../util/loadTextureFromMaterialJson.js";
import { compileAuthoring } from "../document/authoringAdapters.js";
import { evaluateSceneDesign } from "../document/sceneDesign.js";
import { registerBuiltinModelingOperators } from "./builtins.js";
import { evaluateModeledMesh, modelingRecordKey as recordKey } from "./runtimeCompiler.js";
import { modelingMeshToGeometry } from "./meshOperators.js";
import { modelingError } from "./registry.js";

registerBuiltinModelingOperators();

function collect(value, records = [], seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value) || ArrayBuffer.isView(value)) return records;
  seen.add(value);
  if (String(value.objType || "").toLowerCase() === "modeledmesh") records.push(value);
  if (Array.isArray(value) && typeof value[0] === "number") return records;
  for (const [key, item] of Object.entries(value)) if (!["modeling", "geometry", "topology", "material", "materials", "assetLibrary", "metadata"].includes(key)) collect(item, records, seen);
  return records;
}

/** Cache ownership is the scene runtime, never a process-global model/session singleton. */
export async function compileModeledMesh(record, options = {}) {
  const compiled = await evaluateModeledMesh(record, options);
  const built = modelingMeshToGeometry(compiled.result, options);
  return { ...built, modeling: { fingerprints: compiled.fingerprints, nodes: compiled.nodes, diagnostics: compiled.diagnostics } };
}

export async function prepareModeledMeshes(payload, options = {}) {
  const prepared = new Map();
  const resources = { take(record) { return prepared.get(recordKey(record))?.shift(); }, dispose() { for (const values of prepared.values()) for (const item of values) item.geometry.dispose(); prepared.clear(); } };
  try {
    if (!collect(payload).length) return resources;
    const evaluated = evaluateSceneDesign(compileAuthoring(payload)).payload;
    for (const record of collect(evaluated)) {
      options.signal?.throwIfAborted();
      const key = recordKey(record), built = await compileModeledMesh(record, options);
      const values = prepared.get(key) || []; values.push(built); prepared.set(key, values);
      options.signal?.throwIfAborted();
    }
    return resources;
  } catch (error) { resources.dispose(); throw error; }
}

export function createModeledMesh(record, parent) {
  const scope = resolveRuntimeContext(parent, { fallback: false });
  const built = scope?.capabilityResources.find("modeled-meshes", (resources) => resources.take(record));
  if (!built) throw modelingError("MODEL_REQUIRES_ASYNC_LOAD", "modeledMesh requires createJsonScene/loadSceneAsync so its graph can be prepared atomically.");
  let materials;
  try {
    materials = buildBufferMeshMaterials(record);
    const mesh = new Mesh(built.geometry, materials);
    const descriptors = record.materials?.length ? record.materials : [record.material || {}];
    (Array.isArray(materials) ? materials : [materials]).forEach((material, index) => applyMaterialTextureSetFromJson(material, descriptors[index] || {}, { runtimeScope: parent }));
    applyBufferMeshRecord(mesh, record); setUserDataObjJson(mesh, record);
    mesh.userData.threeJsonMeshStats = built.stats; mesh.userData.modeling = built.modeling;
    trackDisposableResource(mesh); trackDisposableResource(built.geometry);
    parent.add(mesh); registerObject(mesh, record, {}, parent); return mesh;
  } catch (error) {
    built.geometry.dispose(); for (const material of Array.isArray(materials) ? materials : materials ? [materials] : []) material.dispose(); throw error;
  }
}

export function ensureModelingCapabilityRegistered() {
  registerBuiltinModelingOperators();
  registerObjTypeDeployer("modeledmesh", createModeledMesh);
  registerSceneCapabilityPreparer("modeled-meshes", prepareModeledMeshes);
}

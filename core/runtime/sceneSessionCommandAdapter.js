import * as THREE from "three";
import { indexSceneDocument, cloneDocumentData, documentError } from "../document/sceneDocument.js";
import { getObjectByThreeJsonId } from "../handler/objectRegistry.js";
import { listMorphTargets, applyMorphInfluencesFromDescriptor } from "../handler/morphTargetRuntime.js";
import { applyObjectTransform } from "../builder/heatmap/heatmapTexture.js";

/** Read the projected authoring state, not a partially mutated visible scene. */
export function createSessionCommandAdapter(session, options = {}) {
  const runtimeOptions = () => ({ ...(session.commandOptions || {}), ...options });
  const commandContext = () => ({ ...session.runtime, runtime: session.runtime, document: session.document.root, options: runtimeOptions() });
  const query = async (command, document) => {
    const { op, args = {} } = command;
    const record = indexSceneDocument(document).get(String(args.id || ""))?.record;
    if (!record) throw documentError("OBJECT_NOT_FOUND", `Object not found: ${args.id}.`);
    const original = getObjectByThreeJsonId(args.id, session.runtime.scene);
    const originalRecord = indexSceneDocument(session.document).get(args.id)?.record;
    let object = original, geometry;
    try {
      if (record !== originalRecord) {
        const type = String(record.objType || "").toLowerCase();
        if (!["editablemesh", "buffermesh", "box", "sphere", "cylinder", "cone", "ring", "torus", "capsule", "plane", "circle"].includes(type)) {
          throw documentError("QUERY_REQUIRES_COMMIT", `Commit the changed external/Domain object before requesting ${op}.`);
        }
        const { prepareDocumentMeshGeometry } = await import("./sceneIncrementalPreparation.js");
        geometry = (await prepareDocumentMeshGeometry(record, runtimeOptions())).geometry;
        object = new THREE.Mesh(geometry, original?.material || []);
        applyObjectTransform(object, record);
        object.updateMatrixWorld(true);
        object.userData.objJson = cloneDocumentData(record);
        applyMorphInfluencesFromDescriptor(object, record);
        object.name = record.name || "";
      }
      if (!object) throw documentError("OBJECT_NOT_COMPILED", `Object is not compiled: ${args.id}.`);
      if (op === "morph.list") return { threeJsonId: args.id, meshes: listMorphTargets(object, args) };
      const mesh = await import("./meshRuntime.js");
      const methods = { "mesh.inspect": mesh.inspectRuntimeMesh, "mesh.getTopology": mesh.getRuntimeMeshTopology,
        "mesh.validate": mesh.validateRuntimeMesh, "mesh.renderViews": mesh.renderRuntimeMeshViews };
      if (!methods[op]) throw documentError("UNKNOWN_QUERY", `Unknown scene query: ${op}.`);
      return await methods[op]({ ...commandContext(), options: { ...runtimeOptions(), getObjectById: (id) => id === args.id ? object : null } }, args);
    } finally { geometry?.dispose(); }
  };
  return {
    query,
    async applyViewportCommand(command) {
      const { executeCommand } = await import("../command/executor.js");
      return executeCommand(commandContext(), command);
    },
    async prepareCommand(command, document) {
      const { op, args = {} } = command;
      const index = indexSceneDocument(document);
      if (op === "object.reconcile") {
        const entries = args.id ? [index.get(args.id)] : [...index.values()];
        const operations = [];
        for (const entry of entries) {
          const object = entry && getObjectByThreeJsonId(entry.id, session.runtime.scene);
          if (!object) throw documentError("OBJECT_NOT_FOUND", `Object not found: ${args.id}.`);
          // Explicit opt-in: this command, and only this command, captures playback transforms.
          operations.push({ op: "object.patch", id: entry.id, patch: {
            position: { x: object.position.x, y: object.position.y, z: object.position.z },
            rotation: { x: object.rotation.x, y: object.rotation.y, z: object.rotation.z },
            scale: { x: object.scale.x, y: object.scale.y, z: object.scale.z }
          } });
        }
        return { operations, data: { count: operations.length, reconciled: true } };
      }
      if (op === "morph.set") {
        if (args.target == null || !Number.isFinite(Number(args.value))) throw documentError("INVALID_MORPH_VALUE", "morph.set requires a target and finite value.");
        const entry = index.get(args.id);
        if (!entry) throw documentError("OBJECT_NOT_FOUND", `Object not found: ${args.id}.`);
        const info = await query({ op: "morph.list", args }, document);
        const matching = info.meshes.filter((mesh) => mesh.targets.some((target) => target.name === String(args.target) || target.index === Number(args.target)));
        if (!matching.length) throw documentError("MORPH_TARGET_NOT_FOUND", `Morph target not found: ${args.target}.`);
        const value = args.clamp === false ? Number(args.value) : Math.max(0, Math.min(1, Number(args.value)));
        const patch = args.mesh ? { morphBindings: [
          ...(entry.record.morphBindings || []).filter((binding) => binding.mesh !== args.mesh || String(binding.target) !== String(args.target)),
          { mesh: args.mesh, target: args.target, value }
        ] } : { morphInfluences: { [String(args.target)]: value } };
        return { operations: [{ op: "object.patch", id: entry.id, patch }], data: { threeJsonId: entry.id, changed: matching.length } };
      }
      throw documentError("UNKNOWN_COMMAND", `No preparation adapter for ${op}.`);
    }
  };
}

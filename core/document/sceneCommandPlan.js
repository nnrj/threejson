import { applyDocumentOperations, cloneDocumentData, indexSceneDocument, readDocumentPointer, escapePointer, documentError } from "./sceneDocument.js";
import { compileAuthoring, formatAuthoring } from "./authoringAdapters.js";
import { prepareBufferMeshDraft } from "./bufferMeshDraft.js";
import { pathToPointer } from "../util/jsonPointer.js";
import { parseCommandLine, parseCommandScript } from "../command/parser.js";
import { buildCommandResult, resolveCommandMode } from "../command/types.js";
import { diffSceneDocuments, diffData } from "./sceneDocumentDiff.js";
export { diffSceneDocuments };

const READ_OPERATIONS = new Set(["mesh.inspect", "mesh.getTopology", "mesh.validate", "mesh.renderViews", "morph.list"]);

function mergeFields(before, patch) {
  const next = { ...before };
  for (const [key, value] of Object.entries(patch)) {
    next[key] = value && typeof value === "object" && !Array.isArray(value) && next[key] && typeof next[key] === "object" && !Array.isArray(next[key])
      ? mergeFields(next[key], value) : value;
  }
  return next;
}

function requireObject(document, id) {
  const entry = indexSceneDocument(document).get(String(id || ""));
  if (!entry) throw documentError("OBJECT_NOT_FOUND", `Object not found: ${id}.`);
  return entry;
}

function readOptional(root, path) {
  try { return { found: true, value: readDocumentPointer(root, path) }; }
  catch (error) { if (error.code !== "MISSING_PATH") throw error; return { found: false }; }
}

/** Prepare the whole authoring command batch without changing a live runtime. */
export async function planSceneCommands(document, input, options = {}) {
  const commands = Array.isArray(input) ? input.map(parseCommandLine)
    : typeof input === "string" ? parseCommandScript(input) : [parseCommandLine(input)];
  let working = document;
  const operations = [], results = [], viewCommands = [];
  const drafts = new Map(options.bufferDrafts || []);
  const apply = (edits) => {
    const result = applyDocumentOperations(working, edits);
    working = result.document;
    for (const operation of result.operations) operations.push(operation);
  };
  const replaceRecord = (entry, record) => { const edits = []; diffData(entry.record, record, entry.path, edits); apply(edits); };
  for (const command of commands) {
    const { op, args = {} } = command;
    let data;
    try {
      options.signal?.throwIfAborted();
      if (op === "object.patch" || op === "material.patch") {
        const entry = requireObject(working, args.id);
        let patch = op === "material.patch" ? { material: args.partial ?? args.material } : args.partial;
        if (patch && typeof patch === "object" && !Array.isArray(patch)) {
          if (op === "material.patch" && (!patch.material || typeof patch.material !== "object" || Array.isArray(patch.material))) throw documentError("INVALID_OPERATION", "material.patch requires material fields.");
          const container = entry.record.materials?.length ? "materials" : entry.record.materialArr?.length ? "materialArr" : null;
          if (patch.material && container && !patch[container]) {
            const materialIndex = args.materialIndex;
            if (materialIndex != null && (!Number.isInteger(materialIndex) || materialIndex < 0 || materialIndex >= entry.record[container].length)) throw documentError("MATERIAL_SLOT_NOT_FOUND", "Material slot index is outside the object.");
            patch = { ...patch, [container]: entry.record[container].map((material, i) => materialIndex == null || materialIndex === i ? mergeFields(material, patch.material) : material) };
            delete patch.material;
          }
          apply([{ op: "object.patch", id: entry.id, patch }]);
        } else if (op === "object.patch" && typeof args.path === "string" && args.path.trim()) {
          const path = `${entry.path}${pathToPointer(args.path)}`;
          apply([{ op: readOptional(working.root, path).found ? "replace" : "add", path, value: args.value }]);
        } else throw documentError("INVALID_OPERATION", `${op} requires a partial or path.`);
        data = { threeJsonId: entry.id, strategy: "document-transaction" };
      } else if (op === "object.add") {
        if (!args.descriptor || typeof args.descriptor !== "object") throw documentError("INVALID_OPERATION", "object.add requires a descriptor.");
        const record = compileAuthoring({ objectList: [args.descriptor] }).root.objectList[0];
        const parentId = args.parent ?? args.options?.parent;
        let path = "/objectList";
        if (parentId != null) {
          const parent = requireObject(working, parentId);
          if (parent.record.objType === "domain" || parent.record.domain) throw documentError("DOMAIN_PART_CONFLICT", "Add a factory part through parameters/overrides, or explicitly bake the Domain first.");
          path = `${parent.path}/subScene`;
          if (!Array.isArray(parent.record.subScene)) apply([{ op: "add", path, value: [] }]);
        }
        apply([{ op: "add", path: `${path}/-`, value: record }]);
        data = { threeJsonId: record.threeJsonId };
      } else if (op === "object.remove") {
        const entry = requireObject(working, args.id);
        apply([{ op: "remove", path: entry.path }]); drafts.delete(entry.id);
        data = { threeJsonId: entry.id, removedDescriptor: cloneDocumentData(entry.record) };
      } else if (op === "object.get") {
        const entry = requireObject(working, args.id);
        data = { threeJsonId: entry.id, path: args.path || null,
          value: cloneDocumentData(args.path ? readDocumentPointer(entry.record, pathToPointer(args.path)) : entry.record) };
      } else if (op === "scene.list") {
        const all = [...indexSceneDocument(working).values()];
        const offset = Math.max(0, Number(args.offset) || 0);
        const limit = args.limit == null ? all.length : Math.max(1, Number(args.limit) || 1);
        const items = all.slice(offset, offset + limit).map((entry) => ({ threeJsonId: entry.id, name: entry.record.name || "", objType: entry.record.objType || "", ...(entry.parentId ? { parentThreeJsonId: entry.parentId } : {}) }));
        data = { count: all.length, items, offset, hasMore: offset + items.length < all.length };
      } else if (op === "scene.applyPatch") {
        if (args.json) apply([{ op: "replace", path: "", value: compileAuthoring(args.json).root }]);
        if (!Array.isArray(args.patch) || !args.patch.length) throw documentError("INVALID_OPERATION", "scene.applyPatch requires a non-empty patch.");
        apply(args.patch); data = { patchCount: args.patch.length };
      } else if (op === "scene.load") {
        apply([{ op: "replace", path: "", value: args.json ? compileAuthoring(args.json).root : working.root }]);
        drafts.clear(); data = { hasScene: true, objectCount: working.root.objectList.length };
      } else if (op === "scene.export") {
        data = { format: args.format || "standard", json: formatAuthoring(working, { format: args.format || "standard" }) };
      } else if (op === "scene.validate") {
        const { validateSceneJson } = await import("../handler/sceneJsonValidate.js");
        const validation = validateSceneJson(JSON.stringify(args.json || working.root));
        if (!validation.ok) throw documentError("INVALID_SCENE_DOCUMENT", validation.error);
        data = { ...validation };
      } else if (op === "mesh.edit") {
        const entry = requireObject(working, args.id);
        if (String(entry.record.objType).toLowerCase() !== "editablemesh") throw documentError("INVALID_MESH_TARGET", "mesh.edit requires editableMesh.");
        if (args.baseRevision != null && Number(args.baseRevision) !== Number(entry.record.topology?.revision || 0)) throw documentError("E_MESH_REVISION_CONFLICT", "Mesh topology changed after this edit was planned.");
        if (!Array.isArray(args.operations) || !args.operations.length) throw documentError("INVALID_MESH_OPERATION", "mesh.edit requires operations.");
        const { applyEditableMeshOperations, invertEditableTopologyDiff } = await import("../runtime/editableMeshOperations.js");
        const edited = applyEditableMeshOperations(entry.record, args.operations);
        replaceRecord(entry, edited.record);
        data = { threeJsonId: entry.id, revision: edited.topology.revision, diff: edited.diff, statistics: edited.validation.statistics, warnings: edited.validation.warnings,
          undo: { op: "mesh.edit", args: { id: entry.id, baseRevision: edited.topology.revision, operations: [{ type: "applyDiff", diff: invertEditableTopologyDiff(edited.diff) }] } } };
      } else if (op.startsWith("mesh.buffer.")) {
        const entry = requireObject(working, args.id);
        const prepared = prepareBufferMeshDraft(entry.record, drafts.get(entry.id), op.slice("mesh.buffer.".length), args);
        if (prepared.draft) drafts.set(entry.id, prepared.draft); else drafts.delete(entry.id);
        if (prepared.descriptor) replaceRecord(entry, prepared.descriptor);
        data = prepared.data;
      } else if (op === "mesh.bake") {
        const entry = requireObject(working, args.id);
        if (String(entry.record.objType).toLowerCase() !== "editablemesh") throw documentError("INVALID_MESH_TARGET", "mesh.bake requires editableMesh.");
        const { buildEditableMeshGeometry } = await import("../builder/editableMesh/editableMeshBuilder.js");
        const { describeBufferGeometry } = await import("./geometryDescriptor.js");
        const built = buildEditableMeshGeometry(entry.record, options);
        if (!built.geometry) throw documentError(built.code || "INVALID_GEOMETRY", built.error);
        let next;
        try { next = { ...entry.record, objType: "bufferMesh", geometry: describeBufferGeometry(built.geometry), meshRevision: (entry.record.topology?.revision || 0) + 1 }; }
        finally { built.geometry.dispose(); }
        delete next.topology; delete next.modifiers; replaceRecord(entry, next);
        data = { threeJsonId: entry.id, revision: next.meshRevision, ...(args.includeDescriptor === false ? {} : { descriptor: cloneDocumentData(next) }), statistics: built.stats };
      } else if (READ_OPERATIONS.has(op)) {
        if (!options.query) throw documentError("QUERY_RUNTIME_REQUIRED", `${op} requires a query adapter.`);
        const result = await options.query(command, working);
        if (result?.ok === false) throw documentError(result.data?.code || "QUERY_FAILED", result.error);
        data = result?.op ? result.data : result;
      } else if (op === "camera.fit") {
        // A viewport operation, not an implicit rewrite of the authored camera.
        if (args.id) requireObject(working, args.id);
        if (!options.applyViewportCommand) throw documentError("VIEWPORT_REQUIRED", "camera.fit requires a viewport adapter.");
        viewCommands.push(command); data = { viewportOnly: true };
      } else if (op === "morph.set" || op === "object.reconcile") {
        if (!options.prepareCommand) throw documentError("COMMAND_PREPARATION_REQUIRED", `${op} requires a runtime preparation adapter.`);
        const prepared = await options.prepareCommand(command, working);
        apply(prepared.operations); data = prepared.data;
      } else throw documentError("UNKNOWN_COMMAND", `Unknown transactional command: ${op}.`);
      results.push(buildCommandResult(op, { ok: true, mode: resolveCommandMode(op), data }));
    } catch (error) {
      results.push(buildCommandResult(op, { ok: false, mode: resolveCommandMode(op), error: error.message, data: { code: error.code } }));
      return { ok: false, sceneMutated: false, results, error, operations: [], bufferDrafts: options.bufferDrafts, viewCommands: [] };
    }
  }
  return { ok: true, results, operations, document: working, bufferDrafts: drafts, viewCommands };
}

const execution = new WeakMap();
/** Commit exactly one revision or none. Concurrent calls serialize before planning. */
export function executeSceneSessionCommands(session, input, options = {}) {
  let state = execution.get(session);
  if (!state) { state = { queue: Promise.resolve(), drafts: new Map() }; execution.set(session, state); }
  const commands = typeof input === "string" ? input : cloneDocumentData(input);
  const task = state.queue.then(async () => {
    const base = session.document;
    if (options.baseRevision != null && options.baseRevision !== base.revision) throw documentError("STALE_SCENE_REVISION", "Scene changed after commands were planned.");
    const adapters = session.runtime ? (await import("../runtime/sceneSessionCommandAdapter.js")).createSessionCommandAdapter(session, options) : {};
    const executionOptions = { ...adapters, ...options, bufferDrafts: state.drafts };
    const planned = await planSceneCommands(base, commands, executionOptions);
    if (!planned.ok) return planned;
    try {
      const event = await session.dispatch({ operations: planned.operations, baseRevision: base.revision, signal: options.signal, label: options.label,
        prepareOptions: options.prepareOptions, historyGroup: options.historyGroup, recordHistory: options.recordHistory });
      state.drafts = planned.bufferDrafts;
      const warnings = [];
      for (const command of planned.viewCommands) {
        try {
          const result = await executionOptions.applyViewportCommand(command);
          if (result?.ok === false) warnings.push(result.error);
        } catch (error) { warnings.push(error.message); }
      }
      return { ok: true, sceneMutated: event.changed, results: planned.results, revision: session.revision, warnings };
    } catch (error) {
      return { ok: false, sceneMutated: false, results: [...planned.results, buildCommandResult("transaction.commit", { ok: false, error: error.message, data: { code: error.code } })], error: error.message, revision: session.revision };
    }
  });
  state.queue = task.catch(() => {});
  return task;
}

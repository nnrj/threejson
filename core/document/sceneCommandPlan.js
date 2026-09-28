import { applyDocumentOperations, cloneDocumentData, indexSceneDocument, readDocumentPointer, escapePointer, documentError } from "./sceneDocument.js";
import { compileAuthoring, formatAuthoring } from "./authoringAdapters.js";
import { prepareBufferMeshDraft } from "./bufferMeshDraft.js";
import { pathToPointer } from "../util/jsonPointer.js";
import { parseCommandLine, parseCommandScript } from "../command/parser.js";
import { buildCommandResult, resolveCommandMode } from "../command/types.js";
import { diffSceneDocuments, diffData } from "./sceneDocumentDiff.js";
import { defaultSceneOperationRegistry } from "../command/operationRegistry.js";
import { assertCommandContract, validateCommandSchema } from "../command/contracts.js";
import { assertRetainedBindingOwnership } from "./sceneBindingOwnership.js";
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
    assertRetainedBindingOwnership(working, result.document);
    working = result.document;
    for (const operation of result.operations) operations.push(operation);
  };
  const replaceRecord = (entry, record) => { const edits = []; diffData(entry.record, record, entry.path, edits); apply(edits); };
  for (const command of commands) {
    const { op, args = {} } = command;
    const registry = options.operationRegistry || defaultSceneOperationRegistry;
    const spec = registry.getSpec(op), mode = spec?.mode || resolveCommandMode(op);
    let data;
    try {
      options.signal?.throwIfAborted();
      assertCommandContract(command, spec);
      if (spec.targets?.length && args.id) {
        const entry = requireObject(working, args.id);
        if (!spec.targets.some((type) => type.toLowerCase() === String(entry.record.objType).toLowerCase())) {
          const alternative = String(entry.record.objType).toLowerCase() === "modeledmesh" ? " Use model.inspect and model.node.patch/model.patch for its graph, or model.bake explicitly." : " Query scene.query controls and mesh.inspect before choosing an edit operation.";
          throw documentError("INVALID_COMMAND_TARGET", `${op} requires ${spec.targets.join(" or ")}; ${args.id} is ${entry.record.objType}.${alternative}`, { id: args.id });
        }
      }
      const prepare = registry.getPreparation?.(op);
      if (prepare) {
        const prepared = await prepare({ document: working, signal: options.signal }, args);
        if (prepared.operations?.length && spec.category !== "authoring") throw documentError("COMMAND_CONTRACT_VIOLATION", "A read operation returned authoring edits.");
        data = prepared.data ?? {};
        try { validateCommandSchema(data, spec.outputSchema, "result"); }
        catch (error) { throw documentError("COMMAND_OUTPUT_CONTRACT", error.message); }
        apply(prepared.operations || []);
      } else if (op === "action.discover") {
        const { listEventActionSpecs } = await import("../runtime/eventMechanism/coreActions/actionRegistry.js");
        data = { actions: listEventActionSpecs(), effects: "runtime-only" };
      } else if (op === "action.invoke") {
        if (commands.length !== 1) throw documentError("NON_TRANSACTIONAL_ACTION_BATCH", "Runtime actions must be executed separately; they cannot be rolled back with authoring edits.");
        const { listEventActionSpecs, invokeContractedEventAction } = await import("../runtime/eventMechanism/coreActions/actionRegistry.js");
        const actionSpec = listEventActionSpecs().find((item) => item.type === args.type);
        if (!actionSpec) throw documentError("ACTION_UNAVAILABLE", `No contracted action: ${args.type}.`);
        validateCommandSchema(args.params || {}, actionSpec.inputSchema);
        if (actionSpec.targets?.length && !args.id) throw documentError("INVALID_COMMAND_TARGET", `${args.type} requires a target object ID.`);
        if (args.id) {
          const entry = requireObject(working, args.id);
          if (actionSpec.targets?.length && !actionSpec.targets.some((type) => type.toLowerCase() === String(entry.record.objType).toLowerCase())) throw documentError("INVALID_COMMAND_TARGET", `${args.type} does not support ${entry.record.objType}.`);
        }
        if (options.preflight || options.dryRun) data = { wouldInvoke: args.type, effects: "runtime-only", verified: "arguments-only" };
        else {
          if (!options.runtime) throw documentError("RUNTIME_REQUIRED", "A runtime action needs an active runtime.");
          const { scopedRuntimeObjects } = await import("../query/sceneQuery.js");
          const object = args.id ? scopedRuntimeObjects(options.runtime).get(args.id) : null;
          if (args.id && !object) throw documentError("OBJECT_NOT_COMPILED", `Object is not compiled: ${args.id}.`);
          const result = await invokeContractedEventAction(args.type, args.params || {}, { runtime: options.runtime, scene: options.runtime.scene, object, signal: options.signal, threeJsonId: args.id });
          data = { effects: "runtime-only", result: result ?? null };
        }
      } else if (op === "scene.capture") {
        if (options.preflight || options.dryRun) {
          if (args.id) requireObject(working, args.id);
          results.push(buildCommandResult(op, { ok: true, mode: "runtime", status: "preflight", data: { wouldCapture: true, checks: { render: "unchecked" } } }));
          continue;
        }
        if (working.root !== document.root) throw documentError("QUERY_REQUIRES_COMMIT", "Commit pending changes before capturing the scene.");
        if (args.kind === "diagnostic") {
          if (!args.id || !options.query) throw documentError("CAPTURE_UNAVAILABLE", "Diagnostic capture requires a target ID and a host mesh-view adapter.");
          const result = await options.query({ op: "mesh.renderViews", args }, working);
          if (result?.ok === false) throw documentError("CAPTURE_FAILED", result.error);
          data = { ...(result?.data || result), kind: "diagnostic", diagnosticRelighting: true, revision: document.revision, timestamp: new Date().toISOString() };
        } else {
          const { captureSceneFrame } = await import("../runtime/sceneObservation.js");
          data = await (options.capture || captureSceneFrame)(options.runtime, { ...args, revision: document.revision, signal: options.signal });
        }
      } else if (["scene.query", "scene.observe", "scene.check", "spatial.measure", "spatial.raycast"].includes(op)) {
        const queries = await import("../query/sceneQuery.js");
        const method = { "scene.query": queries.queryScene, "scene.observe": queries.queryScene, "scene.check": queries.checkScene, "spatial.measure": queries.measureScene, "spatial.raycast": queries.raycastScene }[op];
        if (working.root !== document.root && (op === "spatial.raycast" || args.state === "runtime" || args.state === "evaluated" && working.root.design?.relations?.length)) throw documentError("QUERY_REQUIRES_COMMIT", "Commit pending changes before observing compiled runtime state.");
        if (working.root !== document.root && (args.cursor || args.sinceRevision != null)) throw documentError("QUERY_REQUIRES_COMMIT", "Cursors and revision deltas refer to committed documents; commit this batch first.");
        data = method(working, args, options);
        // Per-edit candidate revisions are not revisions published by the session.
        if (working.root !== document.root) data = { ...data, revision: null, baseRevision: document.revision,
          documentState: "candidate", observedAfterOperationCount: operations.length, nextCursor: null };
        if (op === "scene.observe") data.runtime = working.root !== document.root ? { available: false, code: "QUERY_REQUIRES_COMMIT" } : (await import("../runtime/sceneObservation.js")).observeSceneRuntime(options.runtime);
      } else if (["object.transform", "object.clone", "object.reparent", "scene.layout", "object.attach", "design.parameter.set"].includes(op)) {
        const { prepareScenePlacement } = await import("./scenePlacementOperations.js");
        const prepared = await prepareScenePlacement(working, op, args, options);
        apply(prepared.operations); data = prepared.data;
      } else if (op.startsWith("model.")) {
        const entry = op === "model.operators" ? null : requireObject(working, args.id);
        const { prepareModelingCommand } = await import("../modeling/commands.js");
        const prepared = await prepareModelingCommand(entry?.record, op, args, { ...options, resourcePayload: working.root });
        if (prepared.removeModelingBindings) apply([{ op: "replace", path: "/design/bindings", value: working.root.design.bindings.filter((binding) =>
          binding.object !== entry.id || !(binding.path === "/modeling" || binding.path.startsWith("/modeling/"))) }]);
        if (prepared.record) replaceRecord(entry, prepared.record);
        data = prepared.data;
      } else if (op === "object.patch" || op === "material.patch") {
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
        data = { ...validation, checks: { structure: "passed", geometry: "unchecked", resources: "unchecked", render: "unchecked" } };
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
        if (op === "mesh.renderViews" && (options.preflight || options.dryRun)) {
          requireObject(working, args.id);
          results.push(buildCommandResult(op, { ok: true, mode: "runtime", status: "preflight", data: { wouldCapture: true, checks: { render: "unchecked" } } }));
          continue;
        }
        const query = options.query || (await import("../runtime/sceneSessionCommandAdapter.js")).createSessionCommandAdapter({ document: working, runtime: options.runtime }, options).query;
        const result = await query(command, working);
        if (result?.ok === false) throw documentError(result.data?.code || "QUERY_FAILED", result.error);
        data = result?.op ? result.data : result;
      } else if (op === "camera.fit") {
        // A viewport operation, not an implicit rewrite of the authored camera.
        if (args.id) requireObject(working, args.id);
        if (!options.applyViewportCommand && !options.preflight && !options.dryRun) throw documentError("VIEWPORT_REQUIRED", "camera.fit requires a viewport adapter.");
        viewCommands.push(command); data = { viewportOnly: true };
      } else if (op === "morph.set" || op === "object.reconcile") {
        if (!options.prepareCommand) throw documentError("COMMAND_PREPARATION_REQUIRED", `${op} requires a runtime preparation adapter.`);
        const prepared = await options.prepareCommand(command, working);
        apply(prepared.operations); data = prepared.data;
      } else throw documentError("UNKNOWN_COMMAND", `Unknown transactional command: ${op}.`);
      results.push(buildCommandResult(op, { ok: true, mode, data }));
    } catch (error) {
      results.push(buildCommandResult(op, { ok: false, mode, error: error.message, data: { code: error.code } }));
      return { ok: false, sceneMutated: false, results, error, operations: [], bufferDrafts: options.bufferDrafts, viewCommands: [] };
    }
  }
  return { ok: true, results, operations, document: working, bufferDrafts: drafts, viewCommands };
}

const execution = new WeakMap();
/** Commit exactly one revision or none. Concurrent calls serialize before planning. */
export function commitSceneSessionCommands(session, input, options = {}) {
  // Host-injected registries/backends must be the same for validation and runtime preparation.
  // They are capabilities, never serializable document fields or per-command AI parameters.
  options = { ...session.commandOptions, ...options };
  let state = execution.get(session);
  if (!state) { state = { queue: Promise.resolve(), drafts: new Map() }; execution.set(session, state); }
  const commands = typeof input === "string" ? input : cloneDocumentData(input);
  const task = state.queue.then(async () => {
    const base = session.document;
    if (options.baseRevision != null && options.baseRevision !== base.revision) throw documentError("STALE_SCENE_REVISION", "Scene changed after commands were planned.");
    const adapters = session.runtime ? (await import("../runtime/sceneSessionCommandAdapter.js")).createSessionCommandAdapter(session, options) : {};
    const executionOptions = { ...adapters, runtime: session.runtime, runtimeScope: session.runtime?.scene, ...options, bufferDrafts: state.drafts };
    const planned = await planSceneCommands(base, commands, executionOptions);
    if (!planned.ok) return planned;
    try {
      if (options.dryRun || options.preflight) {
        const check = await session.preflight({ operations: planned.operations, baseRevision: base.revision, signal: options.signal, prepareOptions: options.prepareOptions });
        return { ok: true, sceneMutated: false, results: planned.results, revision: base.revision, status: "preflight", runtimePrepared: check.runtimePrepared };
      }
      const event = await session.dispatch({ operations: planned.operations, baseRevision: base.revision, signal: options.signal, label: options.label,
        prepareOptions: options.prepareOptions, historyGroup: options.historyGroup, recordHistory: options.recordHistory });
      state.drafts = planned.bufferDrafts;
      const warnings = [];
      for (const command of planned.viewCommands) {
        const item = planned.results.find((result) => result.op === command.op && result.data?.viewportOnly);
        try {
          const result = await executionOptions.applyViewportCommand(command);
          if (result?.ok === false) throw documentError(result.code || "VIEWPORT_OPERATION_FAILED", result.error);
          if (item) Object.assign(item, { status: "applied", data: result?.data || item.data });
        } catch (error) { warnings.push(error.message); if (item) Object.assign(item, { ok: false, error: error.message, code: error.code || "VIEWPORT_OPERATION_FAILED", status: "failed" }); }
      }
      return { ok: !warnings.length, ...(warnings.length ? { status: event.changed ? "partial" : "failed", error: warnings.join("; ") } : planned.viewCommands.length && !event.changed ? { status: "applied" } : {}), sceneMutated: event.changed, results: planned.results, revision: session.revision, warnings };
    } catch (error) {
      return { ok: false, ...(error.name === "AbortError" ? { status: "cancelled" } : {}), sceneMutated: false, results: [...planned.results, buildCommandResult("transaction.commit", { ok: false, error: error.message, data: { code: error.code } })], error: error.message, revision: session.revision };
    }
  });
  state.queue = task.catch(() => {});
  return task;
}

/** All application authoring calls pass through the same receipt and validation boundary. */
export async function executeSceneSessionCommands(session, input, options = {}) {
  const { createSceneOperationService } = await import("./sceneOperationService.js");
  return createSceneOperationService({ session }).execute(input, options);
}

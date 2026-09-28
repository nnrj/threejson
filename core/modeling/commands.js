import { applyDocumentOperations, createSceneDocument, cloneDocumentData, indexSceneDocument, escapePointer } from "../document/sceneDocument.js";
import { describeBufferGeometry } from "../document/geometryDescriptor.js";
import { evaluateSceneDesign } from "../document/sceneDesign.js";
import { evaluateModeledMesh } from "./runtimeCompiler.js";
import { validateModelingGraph } from "./graph.js";
import { defaultModelingRegistry, getModelingOperatorManifest, modelingError } from "./registry.js";
import { registerBuiltinModelingOperators } from "./builtins.js";

registerBuiltinModelingOperators();

export async function prepareModelingCommand(record, op, args = {}, options = {}) {
  const registry = options.modelingRegistry || defaultModelingRegistry;
  if (op === "model.operators") {
    const manifest = getModelingOperatorManifest(registry);
    return { data: { ...manifest, operators: manifest.operators.filter((entry) => (!args.id || entry.id === args.id) && (!args.category || entry.category === args.category)) } };
  }
  if (String(record?.objType || "").toLowerCase() !== "modeledmesh") throw modelingError("MODEL_TARGET", "This command requires a modeledMesh object.");
  const revision = record.modelRevision || 0;
  const objectBindings = (options.resourcePayload?.design?.bindings || []).filter((binding) => binding.object === record.threeJsonId);
  const bindings = objectBindings.filter((binding) => binding.path === "/modeling" || binding.path.startsWith("/modeling/"));
  const evaluatedRecord = (modeling) => {
    const target = { ...record, modeling };
    if (!objectBindings.length) return target;
    const document = createSceneDocument(options.resourcePayload), entry = indexSceneDocument(document).get(record.threeJsonId);
    const candidate = applyDocumentOperations(document, [{ op: "replace", path: entry.path, value: target }]).document;
    return indexSceneDocument(evaluateSceneDesign(candidate).payload).get(record.threeJsonId).record;
  };
  const evaluate = (modeling) => evaluateModeledMesh(evaluatedRecord(modeling), options);
  if (op === "model.node.patch" || op === "model.parameter.set") {
    if (!Number.isSafeInteger(args.baseRevision) || args.baseRevision !== revision) throw modelingError("MODEL_REVISION_CONFLICT", `Expected model baseRevision ${revision}.`);
    let patch;
    if (op === "model.node.patch") {
      const i = record.modeling.nodes.findIndex((node) => node.id === args.nodeId);
      if (i < 0) throw modelingError("MODEL_NODE_NOT_FOUND", `Unknown modeling node: ${args.nodeId}.`);
      if (args.partial.id != null && args.partial.id !== args.nodeId) throw modelingError("MODEL_NODE_ID_IMMUTABLE", "Stable node edits cannot rename a node.");
      const { diffData } = await import("../document/sceneDocumentDiff.js");
      const merge = (a, b) => Object.fromEntries(Object.entries({ ...a, ...b }).map(([key, value]) => [key, b[key] && typeof b[key] === "object" && !Array.isArray(b[key]) && a[key] && typeof a[key] === "object" && !Array.isArray(a[key]) ? merge(a[key], b[key]) : value]));
      patch = []; diffData(record.modeling.nodes[i], merge(record.modeling.nodes[i], args.partial), `/nodes/${i}`, patch);
      if (!patch.length) return { data: { id: record.threeJsonId, revision, unchanged: true } };
    } else {
      const exists = Object.hasOwn(record.modeling.parameters || {}, args.name);
      patch = [...(record.modeling.parameters ? [] : [{ op: "add", path: "/parameters", value: {} }]), { op: exists ? "replace" : "add", path: `/parameters/${escapePointer(args.name)}`, value: args.value }];
    }
    return prepareModelingCommand(record, "model.patch", { id: args.id, baseRevision: args.baseRevision, patch }, options);
  }
  if (op === "model.inspect") {
    const plan = validateModelingGraph(record.modeling, { registry });
    const resolved = evaluatedRecord(record.modeling);
    return { data: { id: record.threeJsonId, revision, graphVersion: 1, parameters: cloneDocumentData(record.modeling.parameters || {}),
      ...(bindings.length ? { bindings: cloneDocumentData(bindings), evaluatedParameters: cloneDocumentData(resolved.modeling.parameters || {}) } : {}),
      outputs: cloneDocumentData(plan.outputs), outputTypes: plan.outputTypes,
      nodes: record.modeling.nodes.filter((n) => !args.nodeId || n.id === args.nodeId).map((n) => ({
        id: n.id, operator: n.operator, version: n.version || 1,
        ...(n.part ? { part: n.part } : {}), inputs: cloneDocumentData(n.inputs || {}),
        ...(args.includeParameters === true ? { params: cloneDocumentData(n.params || {}) } : { parameterNames: Object.keys(n.params || {}) })
      })),
      position: cloneDocumentData(resolved.position || { x: 0, y: 0, z: 0 }), rotation: cloneDocumentData(resolved.rotation || { rotationX: 0, rotationY: 0, rotationZ: 0 }),
      scale: cloneDocumentData(resolved.scale || { x: 1, y: 1, z: 1 }) } };
  }
  if (op === "model.patch") {
    if (!Number.isSafeInteger(args.baseRevision) || args.baseRevision !== revision) throw modelingError("MODEL_REVISION_CONFLICT", `Expected model baseRevision ${revision}.`);
    if (!Array.isArray(args.patch) || !args.patch.length) throw modelingError("MODEL_PATCH", "model.patch requires a non-empty RFC6902 patch relative to the modeling graph.");
    for (const edit of args.patch) if (!["add", "replace", "remove", "test", "copy", "move"].includes(edit.op) || typeof edit.path !== "string" || (edit.path && !edit.path.startsWith("/"))) throw modelingError("MODEL_PATCH", "Invalid graph patch operation.");
    for (const edit of args.patch.filter((item) => item.op !== "test")) for (const path of [edit.path, ...(edit.op === "move" ? [edit.from] : [])]) {
      const target = `/modeling${path}`;
      if (bindings.some((binding) => binding.path === target || binding.path.startsWith(`${target}/`) || target.startsWith(`${binding.path}/`))) {
        throw modelingError("MODEL_PARAMETER_BOUND", "This graph field is controlled by a scene design binding. Edit the design parameter, or explicitly remove its binding before editing the graph.");
      }
    }
    const next = applyDocumentOperations(createSceneDocument(record.modeling), args.patch).document.root;
    validateModelingGraph(next, { registry });
    // Check evaluation before admitting a new authoring revision, also in document-only hosts.
    await evaluate(next);
    return { record: { ...record, modeling: cloneDocumentData(next), modelRevision: revision + 1 }, data: { id: record.threeJsonId, revision: revision + 1 } };
  }
  if (op === "model.evaluate" || op === "model.bake") {
    if (op === "model.bake" && args.baseRevision !== undefined && args.baseRevision !== revision) throw modelingError("MODEL_REVISION_CONFLICT", `Expected model baseRevision ${revision}.`);
    const result = await evaluate(record.modeling);
    if (op === "model.evaluate") return { data: { id: record.threeJsonId, revision, type: result.result.type,
      statistics: result.result.stats || null, bounds: result.result.bounds || null, diagnostics: result.diagnostics, nodes: result.nodes,
      ...(args.includeArtifact === true ? { artifact: result.result } : {}) } };
    const { modelingMeshToGeometry } = await import("./meshOperators.js");
    const { geometry } = modelingMeshToGeometry(result.result, options);
    let next;
    try { next = { ...record, objType: "bufferMesh", geometry: describeBufferGeometry(geometry), meshRevision: revision + 1 }; }
    finally { geometry.dispose(); }
    delete next.modeling; delete next.modelRevision; delete next.modelQuality;
    return { record: next, removeModelingBindings: bindings.length > 0, data: { id: record.threeJsonId, revision: revision + 1, statistics: result.result.stats, ...(args.includeDescriptor === true ? { descriptor: next } : {}) } };
  }
  throw modelingError("MODEL_COMMAND", `Unknown modeling command ${op}.`);
}

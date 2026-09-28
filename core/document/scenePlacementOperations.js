import { Matrix4, Object3D, Quaternion, Vector3, Euler } from "three";
import { indexSceneDocument, cloneDocumentData, applyDocumentOperations, documentError, escapePointer } from "./sceneDocument.js";
import { evaluateSceneDesign } from "./sceneDesign.js";
import { documentWorldMatrices, evaluatedScenePayload } from "../query/sceneQuery.js";
import { applyObjectTransform } from "../util/objectTransform.js";

const lengthUnits = { m: 1, cm: 0.01, mm: 0.001, km: 1000, in: 0.0254, ft: 0.3048 };
const overlaps = (a, b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
export function assertWritableSceneFields(document, id, paths) {
  const design = document.root.design;
  const bindings = (design?.bindings || []).filter((binding) => binding.object === id && paths.some((path) => overlaps(path, binding.path)));
  const relations = (design?.relations || []).filter((relation) => relation.object === id && paths.some((path) => ["/position", "/rotation", "/quaternion"].some((field) => overlaps(field, path))));
  if (bindings.length || relations.length) throw documentError("AUTHORING_FIELD_CONTROLLED", "This field is controlled by a design binding or relationship. Change its parameter/relationship or explicitly detach it first.", { id, bindings, relations });
}
function requireEntry(document, id) {
  const entry = indexSceneDocument(document).get(id);
  if (!entry) throw documentError("OBJECT_NOT_FOUND", `Object not found: ${id}.`);
  return entry;
}
function inverse(matrix) {
  if (matrix.determinant() === 0) throw documentError("SINGULAR_TRANSFORM", "Cannot invert a singular parent/frame transform.");
  return matrix.clone().invert();
}
function pose(matrix) {
  const p = new Vector3(), q = new Quaternion(), s = new Vector3(); matrix.decompose(p, q, s);
  const reconstructed = new Matrix4().compose(p, q, s);
  if (!matrix.elements.every((n, i) => Number.isFinite(n) && Math.abs(n - reconstructed.elements[i]) <= 1e-8 * Math.max(1, Math.abs(n)))) throw documentError("UNREPRESENTABLE_SHEAR", "The requested pose cannot be represented losslessly by position/quaternion/scale; use a different parent or explicit geometry transform.");
  return { position: { x: p.x, y: p.y, z: p.z }, quaternion: q.toArray(), scale: { x: s.x, y: s.y, z: s.z } };
}
function evaluatedMatrices(document, options, ids) {
  return documentWorldMatrices(evaluatedScenePayload(document, options.runtime, ids));
}
function transform(document, args, options) {
  const entry = requireEntry(document, args.id);
  const fields = ["position", "rotation", "scale"].filter((field) => args[field]);
  if (!fields.length) throw documentError("INVALID_TRANSFORM", "Provide position, rotation or scale.");
  assertWritableSceneFields(document, args.id, fields.map((field) => `/${field}`));
  const factor = args.unit == null ? 1 : lengthUnits[args.unit] / lengthUnits[document.root.design?.units?.length || "m"];
  if (!Number.isFinite(factor)) throw documentError("INVALID_LENGTH_UNIT", `Unsupported length unit: ${args.unit}.`);
  const object = new Object3D(); applyObjectTransform(object, entry.record); object.updateMatrix();
  if (args.frame === "parent") {
    if (args.position) args.mode === "delta" ? object.position.add(new Vector3(...args.position).multiplyScalar(factor)) : object.position.fromArray(args.position).multiplyScalar(factor);
    if (args.rotation) {
      const q = new Quaternion().setFromEuler(new Euler(...args.rotation));
      args.mode === "delta" ? object.quaternion.premultiply(q) : object.quaternion.copy(q);
    }
    if (args.scale) args.mode === "delta" ? object.scale.multiply(new Vector3(...args.scale)) : object.scale.fromArray(args.scale);
    object.updateMatrix();
    const next = pose(object.matrix);
    return [{ op: "object.patch", id: args.id, patch: Object.fromEntries(fields.map((field) => field === "rotation" ? ["quaternion", next.quaternion] : [field, next[field]])) }];
  }
  const matrices = evaluatedMatrices(document, options, [args.id]), parent = entry.parentId ? matrices.get(entry.parentId) : new Matrix4(), current = matrices.get(args.id);
  let frame = new Matrix4();
  if (args.frame === "object") {
    if (args.mode !== "delta") throw documentError("INVALID_TRANSFORM_FRAME", "Object-frame transforms require mode:delta.");
    frame = current;
  } else if (args.frame === "camera") {
    if (!options.runtime?.camera) throw documentError("CAMERA_REQUIRED", "A camera-frame transform requires a runtime camera.");
    options.runtime.camera.updateWorldMatrix(true, false); frame = options.runtime.camera.matrixWorld;
  }
  let next = current.clone();
  if (args.mode === "delta") {
    const delta = new Matrix4().compose(new Vector3(...(args.position || [0, 0, 0])).multiplyScalar(factor), new Quaternion().setFromEuler(new Euler(...(args.rotation || [0, 0, 0]))), new Vector3(...(args.scale || [1, 1, 1])));
    // Object deltas are local. Other frame rotations/scales operate about the object's origin.
    if (args.frame === "object") next.multiply(delta);
    else {
      const local = inverse(frame).multiply(current); const p = new Vector3(), q = new Quaternion(), s = new Vector3(); local.decompose(p, q, s);
      if (args.position) p.add(new Vector3(...args.position).multiplyScalar(factor));
      if (args.rotation) q.premultiply(new Quaternion().setFromEuler(new Euler(...args.rotation)));
      if (args.scale) s.multiply(new Vector3(...args.scale));
      pose(local); next = frame.clone().multiply(new Matrix4().compose(p, q, s));
    }
  } else {
    const local = inverse(frame).multiply(current); pose(local);
    const p = new Vector3(), q = new Quaternion(), s = new Vector3(); local.decompose(p, q, s);
    if (args.position) p.fromArray(args.position).multiplyScalar(factor);
    if (args.rotation) q.setFromEuler(new Euler(...args.rotation));
    if (args.scale) s.fromArray(args.scale);
    next = frame.clone().multiply(new Matrix4().compose(p, q, s));
  }
  const localPose = pose(inverse(parent).multiply(next));
  return [{ op: "object.patch", id: args.id, patch: args.position && !args.rotation && !args.scale ? { position: localPose.position } : localPose }];
}
function insertUnder(document, record, parentId) {
  if (!parentId) return [{ op: "add", path: "/objectList/-", value: record }];
  const parent = requireEntry(document, parentId);
  if (parent.record.domain || parent.record.objType === "domain") throw documentError("DOMAIN_PART_CONFLICT", "Use Domain parameters/overrides or bake it before adding authored children.");
  return [...(parent.record.subScene ? [] : [{ op: "add", path: `${parent.path}/subScene`, value: [] }]), { op: "add", path: `${parent.path}/subScene/-`, value: record }];
}
export async function prepareScenePlacement(document, op, args, options = {}) {
  if (op === "object.transform") return { operations: transform(document, args, options), data: { id: args.id, frame: args.frame } };
  if (op === "design.parameter.set") {
    const path = `/design/parameters/${escapePointer(args.name)}`;
    if (!Object.hasOwn(document.root.design?.parameters || {}, args.name)) throw documentError("DESIGN_PARAMETER_MISSING", `Unknown parameter: ${args.name}.`);
    const prior = document.root.design.parameters[args.name];
    if (prior && typeof prior === "object" && (prior.expr || prior.op || prior.param)) throw documentError("DESIGN_PARAMETER_DERIVED", "Edit the inputs of this derived parameter, or explicitly replace its expression in the document.");
    const value = prior && typeof prior === "object" && Object.hasOwn(prior, "value") ? { ...prior, value: args.value } : args.value;
    const operations = [{ op: "replace", path, value }];
    evaluateSceneDesign(applyDocumentOperations(document, operations).document);
    return { operations, data: { parameter: args.name } };
  }
  if (op === "object.attach") {
    requireEntry(document, args.id); requireEntry(document, args.target);
    if (args.id === args.target) throw documentError("DESIGN_DEPENDENCY_CYCLE", "An object cannot attach to itself.");
    const design = document.root.design || { version: 1 };
    const relation = { type: "attach", object: args.id, target: args.target, anchor: args.anchor || "origin", targetAnchor: args.targetAnchor || "origin",
      ...(args.targetPart ? { targetPart: args.targetPart } : {}), ...(args.offset ? { offset: args.offset } : {}), offsetSpace: args.offsetSpace || "target", ...(args.orientation === "target" ? { orientation: "target" } : {}) };
    const next = { ...design, relations: [...(design.relations || []).filter((item) => item.object !== args.id), relation] };
    return { operations: [{ op: document.root.design ? "replace" : "add", path: "/design", value: next }], data: { id: args.id, persistent: true } };
  }
  if (op === "object.reparent") {
    const entry = requireEntry(document, args.id);
    if (args.parent) {
      const parent = requireEntry(document, args.parent);
      if (parent.path === entry.path || parent.path.startsWith(`${entry.path}/`)) throw documentError("HIERARCHY_CYCLE", "Cannot reparent into the object's own subtree.");
    }
    if ((args.parent || null) === entry.parentId) return { operations: [], data: { id: args.id } };
    assertWritableSceneFields(document, args.id, ["/position", "/rotation", "/quaternion", "/scale"]);
    let record = cloneDocumentData(entry.record);
    if (args.keepWorld !== false) {
      const matrices = evaluatedMatrices(document, options, [args.id, ...(args.parent ? [args.parent] : [])]), parent = args.parent ? matrices.get(args.parent) : new Matrix4();
      record = { ...record, ...pose(inverse(parent).multiply(matrices.get(args.id))) };
    }
    const removal = [{ op: "remove", path: entry.path }], after = applyDocumentOperations(document, removal).document;
    return { operations: [...removal, ...insertUnder(after, record, args.parent)], data: { id: args.id, parent: args.parent || null, keepWorld: args.keepWorld !== false } };
  }
  if (op === "object.clone") {
    const entry = requireEntry(document, args.id), ids = new Map(), all = indexSceneDocument(document);
    for (const item of all.values()) if (item.path === entry.path || item.path.startsWith(`${entry.path}/`)) ids.set(item.id, item.id === args.id ? args.newId : `${args.newId}/${item.id}`);
    for (const id of ids.values()) if (all.has(id)) throw documentError("DUPLICATE_OBJECT_ID", `Clone ID already exists: ${id}.`);
    const externalReferences = new Set(), referenceKeys = new Set(["threeJsonId", "object", "target", "parent", "parentThreeJsonId", "objectId", "targetId"]);
    const remap = (value, key = "") => {
      if (["metadata", "userData", "semantic"].includes(key)) return cloneDocumentData(value);
      if (typeof value === "string" && referenceKeys.has(key)) {
        if (ids.has(value)) return ids.get(value);
        if (all.has(value)) externalReferences.add(value);
      }
      if (Array.isArray(value)) return value.map((item) => remap(item));
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, remap(item, name)]));
      return value;
    };
    const record = remap(entry.record);
    if (args.position) record.position = { x: args.position[0], y: args.position[1], z: args.position[2] };
    const operations = insertUnder(document, record, args.parent || entry.parentId);
    for (const key of ["bindings", "relations"]) {
      const values = document.root.design?.[key]?.filter((item) => ids.has(item.object));
      if (values?.length) operations.push({ op: "replace", path: `/design/${key}`, value: [...document.root.design[key], ...values.map((item) => remap(item))] });
    }
    return { operations, data: { id: args.newId, idMap: Object.fromEntries(ids), externalReferences: [...externalReferences], referencePolicy: "known-scene-reference-fields; custom metadata preserved" } };
  }
  if (op === "scene.layout") {
    if (!args.ids.length || new Set(args.ids).size !== args.ids.length) throw documentError("INVALID_LAYOUT", "Layout requires distinct object IDs.");
    const origin = args.origin || [0, 0, 0], step = args.step || [1, 0, 1], operations = [], placements = [];
    let seed = args.seed ?? 1;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const points = args.points, segments = points?.slice(1).map((point, i) => new Vector3(...point).distanceTo(new Vector3(...points[i]))), length = segments?.reduce((a, b) => a + b, 0);
    for (let i = 0; i < args.ids.length; i++) {
      let offset;
      if (args.layout === "row") offset = step.map((n) => n * i);
      if (args.layout === "grid") { const columns = args.columns || Math.ceil(Math.sqrt(args.ids.length)); offset = [i % columns * step[0], 0, Math.floor(i / columns) * step[2]]; }
      if (args.layout === "circle") { const angle = 2 * Math.PI * i / args.ids.length, radius = args.radius ?? 1; offset = [Math.cos(angle) * radius, 0, Math.sin(angle) * radius]; }
      if (args.layout === "scatter") {
        if (!args.bounds || args.bounds.min.some((n, axis) => n > args.bounds.max[axis])) throw documentError("INVALID_LAYOUT", "Scatter requires ordered min/max bounds.");
        offset = args.bounds.min.map((n, axis) => n + random() * (args.bounds.max[axis] - n));
      }
      if (args.layout === "curve") {
        if (!length) throw documentError("INVALID_LAYOUT", "Curve layout requires a nonzero polyline.");
        let distance = length * i / Math.max(1, args.ids.length - 1), j = 0;
        while (j < segments.length - 1 && distance > segments[j]) { distance -= segments[j]; j++; }
        offset = new Vector3(...points[j]).lerp(new Vector3(...points[j + 1]), segments[j] ? distance / segments[j] : 0).toArray();
      }
      placements.push({ id: args.ids[i], position: offset.map((n, axis) => n + origin[axis]) });
    }
    // Move selected ancestors first. A child's target world pose then uses its
    // parent's new frame, regardless of the caller's list order.
    const index = indexSceneDocument(document), depth = (id) => index.get(id)?.path.split("/").length || 0;
    placements.sort((a, b) => depth(a.id) - depth(b.id));
    let working = document;
    for (const placement of placements) {
      const edits = transform(working, { ...placement, frame: "world" }, options);
      working = applyDocumentOperations(working, edits).document; operations.push(...edits);
    }
    return { operations, data: { ids: args.ids, layout: args.layout, persistent: false, ...(args.layout === "scatter" ? { seed: args.seed ?? 1 } : {}) } };
  }
  throw documentError("UNKNOWN_COMMAND", `Unknown placement operation: ${op}.`);
}

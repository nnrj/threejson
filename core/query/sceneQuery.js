import { Matrix4, Object3D, Vector3, Box3, Raycaster } from "three";
import { indexSceneDocument, cloneDocumentData, documentError } from "../document/sceneDocument.js";
import { evaluateSceneDesign } from "../document/sceneDesign.js";
import { applyObjectTransform } from "../util/objectTransform.js";
import { buildObjectSpatialCard, buildCompactReferenceDescriptor } from "./spatialDescriptors.js";

export function documentWorldMatrices(document) {
  const index = indexSceneDocument(document), matrices = new Map();
  const get = (id) => {
    if (matrices.has(id)) return matrices.get(id);
    const entry = index.get(id);
    if (!entry) throw documentError("OBJECT_NOT_FOUND", `Object not found: ${id}.`);
    const object = new Object3D(); applyObjectTransform(object, entry.record); object.updateMatrix();
    const matrix = (entry.parentId ? get(entry.parentId).clone() : new Matrix4()).multiply(object.matrix);
    matrices.set(id, matrix); return matrix;
  };
  for (const id of index.keys()) get(id);
  return matrices;
}
export function scopedRuntimeObjects(runtime) {
  const objects = new Map();
  runtime?.scene?.traverse((object) => {
    const id = object.userData?.objJson?.threeJsonId;
    if (id && !objects.has(id)) objects.set(id, object);
  });
  return objects;
}
const boxFrom = (bounds) => new Box3(new Vector3(...bounds.min), new Vector3(...bounds.max));
const footprintBounds = (fp) => fp ? { min: [fp.minX, fp.minY, fp.minZ], max: [fp.maxX, fp.maxY, fp.maxZ] } : null;
export function evaluatedScenePayload(document, runtime, requiredIds) {
  const evaluated = evaluateSceneDesign(document);
  if (!evaluated.relations.length) return evaluated.payload;
  const index = indexSceneDocument(evaluated.payload), relevant = new Set(requiredIds || index.keys());
  for (const id of relevant) { const parent = index.get(id)?.parentId; if (parent) relevant.add(parent); }
  const needed = evaluated.relations.filter((relation) => relevant.has(relation.object));
  if (!needed.length) return evaluated.payload;
  const solved = runtime?.designState?.relations;
  if (!solved || needed.some((relation) => !solved.some((pose) => pose.object === relation.object))) throw documentError("EVALUATED_RUNTIME_REQUIRED", "These anchor relationships need compiled geometry and solved poses; use authored state or compile the scene first.");
  const payload = cloneDocumentData(evaluated.payload), target = indexSceneDocument(payload);
  for (const relation of solved) {
    const record = target.get(relation.object)?.record;
    if (record) { record.position = { x: relation.position[0], y: relation.position[1], z: relation.position[2] }; record.quaternion = relation.quaternion; }
  }
  return payload;
}
const canonical = (value) => JSON.stringify(value, (_, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v);

/** Authoring IDs are scoped to this document/runtime, never a process-global registry. */
export function queryScene(document, args = {}, options = {}) {
  if (args.cursor && args.cursor.revision !== document.revision) throw documentError("STALE_QUERY_CURSOR", "Scene changed; restart this query with the new revision.");
  const state = args.state || "authored";
  if (!["authored", "evaluated", "runtime"].includes(state)) throw documentError("INVALID_QUERY_STATE", `Unknown observation state: ${state}.`);
  const queryKey = canonical({ selector: args.selector || {}, state, projection: args.projection || null, sinceRevision: args.sinceRevision ?? null });
  if (args.cursor?.queryKey !== undefined && args.cursor.queryKey !== queryKey) throw documentError("QUERY_CURSOR_MISMATCH", "The cursor belongs to a different query.");
  const delta = args.sinceRevision == null ? null : options.readDelta?.(args.sinceRevision);
  if (args.sinceRevision != null && !delta) throw documentError("DELTA_UNAVAILABLE", "Revision deltas require the scene operation service that observed these revisions.");
  if (state === "runtime" && !options.runtime?.scene) throw documentError("RUNTIME_REQUIRED", "Live observation requires a scene runtime.");
  const payload = state === "evaluated" ? evaluatedScenePayload(document, options.runtime, args.selector?.ids) : document.root;
  const index = indexSceneDocument(payload), matrices = documentWorldMatrices(payload);
  const objects = scopedRuntimeObjects(options.runtime);
  const selector = args.selector || {};
  const projection = args.projection || ["identity", "transform", "bounds", "summary", "controls"];
  const allowed = new Set(["identity", "transform", "bounds", "summary", "controls", "semantic", "materials", "descriptor"]);
  if (projection.some((field) => !allowed.has(field))) throw documentError("INVALID_QUERY_PROJECTION", "Unknown projection; geometry is available through explicit descriptor projection.");
  const observe = (entry) => {
    const object = objects.get(entry.id), live = state === "runtime";
    if (live && !object) throw documentError("OBJECT_NOT_COMPILED", `Object not compiled: ${entry.id}.`);
    if (live) object.updateWorldMatrix(true, true);
    const matrix = live ? object.matrixWorld : matrices.get(entry.id);
    const card = selector.bounds || projection.includes("bounds") ? buildObjectSpatialCard(entry.record, { parentThreeJsonId: entry.parentId, worldMatrix: matrix, ...(live ? { object3D: object } : {}) }) : null;
    const local = new Object3D(); applyObjectTransform(local, entry.record);
    return { object, matrix, card, local, bounds: footprintBounds(card?.footprint) };
  };
  const isDescendant = (entry, parent) => {
    while (entry?.parentId) { if (entry.parentId === parent) return true; entry = index.get(entry.parentId); }
    return false;
  };
  const selected = [];
  for (const entry of index.values()) {
    if (delta && !delta.changedIds.includes(entry.id)) continue;
    const record = entry.record, semantic = record.metadata?.semantic || record.semantic || {};
    if (selector.ids && !selector.ids.includes(entry.id)) continue;
    if (selector.types && !selector.types.some((type) => type.toLowerCase() === String(record.objType).toLowerCase())) continue;
    if (selector.name && record.name !== selector.name && !semantic.aliases?.includes(selector.name)) continue;
    if (selector.parentId && entry.parentId !== selector.parentId) continue;
    if (selector.descendantsOf && !isDescendant(entry, selector.descendantsOf)) continue;
    const tags = [record.customBucket, ...[].concat(record.systemBucket || []), ...[].concat(semantic.tags || [])];
    if (selector.tags && !selector.tags.every((tag) => tags.includes(tag))) continue;
    if (selector.category && semantic.category !== selector.category) continue;
    if (selector.part && !record.topology?.faces?.some((face) => face.part === selector.part) && !record.modeling?.nodes?.some((node) => node.part === selector.part) && record.domainPartId !== selector.part) continue;
    const observation = selector.bounds ? observe(entry) : null;
    if (selector.bounds && (!observation.bounds || !boxFrom(observation.bounds).intersectsBox(boxFrom(selector.bounds)))) continue;
    selected.push({ entry, semantic, observation });
  }
  selected.sort((a, b) => a.entry.id.localeCompare(b.entry.id));
  const offset = args.cursor?.offset ?? args.offset ?? 0, limit = args.limit ?? selected.length;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 0) throw documentError("INVALID_QUERY_PAGE", "Invalid query page.");
  const items = selected.slice(offset, offset + limit).map(({ entry, semantic, observation }) => {
    const { object, matrix, card, bounds, local } = observation || observe(entry);
    const record = entry.record, result = { id: entry.id };
    for (const field of projection) {
      if (field === "identity") Object.assign(result, { name: record.name || "", objType: record.objType, parentId: entry.parentId });
      if (field === "transform") { const pose = state === "runtime" ? object : local; result.transform = { local: { position: pose.position.toArray(), rotation: pose.rotation.toArray(), scale: pose.scale.toArray(), quaternion: pose.quaternion.toArray() }, worldMatrix: matrix.toArray(), worldPosition: new Vector3().setFromMatrixPosition(matrix).toArray() }; }
      if (field === "bounds") result.bounds = bounds ? { ...bounds, frame: "world", algorithm: "aabb", source: card.boundsSource || "descriptor-estimate", collisionTest: false } : null;
      if (field === "summary") result.summary = buildCompactReferenceDescriptor(record);
      if (field === "semantic") result.semantic = { ...semantic, provenance: semantic.provenance || "authored" };
      if (field === "controls") result.controls = { bindings: (document.root.design?.bindings || []).filter((binding) => binding.object === entry.id), relations: (document.root.design?.relations || []).filter((relation) => relation.object === entry.id) };
      if (field === "materials") result.materials = record.materials || record.materialArr || (record.material ? [record.material] : []);
      if (field === "descriptor") result.descriptor = record;
    }
    return cloneDocumentData(result);
  });
  return { revision: document.revision, state, timestamp: new Date().toISOString(), units: { length: document.root.design?.units?.length || "m", angle: "rad" },
    ...(delta ? { sinceRevision: args.sinceRevision, removedIds: delta.removedIds, deltaScope: "document-identities; removals are unfiltered" } : {}),
    total: selected.length, offset, items, nextCursor: offset + items.length < selected.length ? { revision: document.revision, queryKey, offset: offset + items.length } : null };
}

export function measureScene(document, args, options = {}) {
  const result = queryScene(document, { selector: { ids: [args.from, args.to] }, state: args.state || "authored", projection: ["transform", "bounds"] }, options);
  const a = result.items.find((item) => item.id === args.from), b = result.items.find((item) => item.id === args.to);
  if (!a || !b) throw documentError("OBJECT_NOT_FOUND", "Both measurement targets must exist.");
  const delta = new Vector3(...b.transform.worldPosition).sub(new Vector3(...a.transform.worldPosition));
  const gap = a.bounds && b.bounds ? [0, 1, 2].map((i) => Math.max(0, a.bounds.min[i] - b.bounds.max[i], b.bounds.min[i] - a.bounds.max[i])) : null;
  return { revision: document.revision, state: result.state, frame: "world", units: result.units, from: args.from, to: args.to, delta: delta.toArray(), originDistance: delta.length(),
    aabbGap: gap, aabbDistance: gap && Math.hypot(...gap), aabbOverlap: gap && gap.every((n) => n === 0), algorithm: "origins-and-aabb", exactSolidCollision: false };
}

export function raycastScene(document, args, options = {}) {
  const runtime = options.runtime;
  if (!runtime?.scene) throw documentError("RUNTIME_REQUIRED", "Raycasting requires compiled geometry.");
  const direction = new Vector3(...args.direction);
  if (!direction.lengthSq()) throw documentError("INVALID_RAY", "Ray direction must be nonzero.");
  const selected = queryScene(document, { selector: args.selector, projection: ["identity"] }).items.map((entry) => entry.id);
  const objects = scopedRuntimeObjects(runtime), selectedSet = new Set(selected);
  const roots = selected.map((id) => objects.get(id)).filter(Boolean).filter((object) => {
    let parent = object.parent;
    while (parent) { if (selectedSet.has(parent.userData?.objJson?.threeJsonId)) return false; parent = parent.parent; }
    return true;
  });
  runtime.scene.updateMatrixWorld(true);
  const ray = new Raycaster(new Vector3(...args.origin), direction.normalize(), args.near ?? 0, args.far ?? Infinity);
  return { revision: document.revision, state: "runtime", timestamp: new Date().toISOString(), frame: "world", algorithm: "three-raycaster", hits: ray.intersectObjects(roots, true).map((hit) => {
    let owner = hit.object;
    while (owner && !owner.userData?.objJson?.threeJsonId) owner = owner.parent;
    return { id: owner?.userData.objJson.threeJsonId || null, distance: hit.distance, point: hit.point.toArray(), faceIndex: hit.faceIndex ?? null, instanceId: hit.instanceId ?? null };
  }) };
}

export function checkScene(document, args, options = {}) {
  const observations = queryScene(document, { state: args.state || "authored", projection: ["identity", "transform", "bounds", "materials"] }, options);
  const index = new Map(observations.items.map((item) => [item.id, item]));
  const checks = args.assertions.map((assertion) => {
    const object = index.get(assertion.id), tolerance = assertion.tolerance ?? 1e-6;
    if (!Number.isFinite(tolerance) || tolerance < 0) throw documentError("INVALID_ASSERTION", "Tolerance must be finite and nonnegative.");
    let actual, passed;
    switch (assertion.type) {
      case "exists": actual = Boolean(object); passed = actual === (assertion.value ?? true); break;
      case "count": actual = observations.items.filter((item) => !assertion.objType || item.objType === assertion.objType).length; passed = actual === assertion.value; break;
      case "position": actual = object?.transform.worldPosition; passed = Array.isArray(assertion.value) && actual?.every((v, i) => Math.abs(v - assertion.value[i]) <= tolerance); break;
      case "size": actual = object?.bounds && object.bounds.max.map((v, i) => v - object.bounds.min[i]); passed = Array.isArray(assertion.value) && actual?.every((v, i) => Math.abs(v - assertion.value[i]) <= tolerance); break;
      case "material": actual = object?.materials?.[assertion.slot || 0]?.[assertion.field || "color"]; passed = actual !== undefined && JSON.stringify(actual) === JSON.stringify(assertion.value); break;
      case "gap": actual = measureScene(document, { from: assertion.id, to: assertion.target, state: args.state }, options).aabbDistance; passed = actual != null && Math.abs(actual - assertion.value) <= tolerance; break;
      default: return { assertion, status: "unchecked", code: "UNSUPPORTED_POSTCONDITION" };
    }
    return { assertion, actual: actual ?? null, status: passed ? "passed" : "failed" };
  });
  return { revision: document.revision, state: observations.state, checks, satisfied: checks.every((check) => check.status === "passed") };
}

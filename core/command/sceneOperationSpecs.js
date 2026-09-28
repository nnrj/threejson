const str = { type: "string", minLength: 1 }, obj = { type: "object" }, num = { type: "number" };
const vec = { type: "array", items: num, minItems: 3, maxItems: 3 };
const integer = { type: "integer", minimum: 0 }, flag = { type: "boolean" };
const strings = { type: "array", items: str };
const schema = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const selector = schema({ ids: strings, types: strings, name: str, parentId: str, descendantsOf: str,
  tags: strings, category: str, part: str, bounds: schema({ min: vec, max: vec }, ["min", "max"]) });
const state = { enum: ["authored", "evaluated", "runtime"] };
const query = { selector, state, projection: strings, offset: integer, limit: { type: "integer", minimum: 1 }, cursor: obj, sinceRevision: integer };
function spec(op, category, summary, properties, required, extra = {}) {
  return { op, mode: category === "runtime" || extra.requirements?.some((key) => ["runtime", "capture-adapter"].includes(key)) ? "runtime" : "document", category, summary, args: Object.fromEntries(Object.keys(properties).map((key) => [key, properties[key].description || key])), inputSchema: schema(properties, required), ...extra };
}
export const SCENE_OPERATION_SPECS = [
  spec("action.discover", "read", "List only registered, schema-described runtime actions; actions do not edit the source document.", {}),
  spec("action.invoke", "runtime", "Invoke one transient runtime action, separately from authoring transactions; no undo or rollback is implied.", { type: str, id: str, params: obj }, ["type"], { requirements: ["runtime", "action-contract"] }),
  spec("scene.capture", "read", "Capture actual scene/compositor lighting, or explicitly request a separately tagged relit diagnostic view.", { kind: { enum: ["scene", "diagnostic"] }, id: str, views: strings, size: { type: "integer", minimum: 1 }, mimeType: { enum: ["image/png", "image/jpeg"] } }, [], { requirements: ["capture-adapter"] }),
  spec("scene.query", "read", "Select objects using structured predicates and explicit projections; dense geometry is opt-in.", query),
  spec("scene.observe", "read", "Observe authored, evaluated or runtime state with revision, timestamp, controls and resource diagnostics.", query),
  spec("spatial.measure", "read", "Measure world-space origins and AABB gap/overlap (not exact solid collision).", { from: str, to: str, state }, ["from", "to"]),
  spec("spatial.raycast", "read", "Raycast the selected runtime scene in world coordinates; not full visibility analysis.", { origin: vec, direction: vec, selector, near: num, far: num }, ["origin", "direction"], { requirements: ["runtime"] }),
  spec("scene.check", "read", "Check deterministic postconditions, reporting unavailable checks separately.", { assertions: { type: "array", minItems: 1, items: obj }, state }, ["assertions"]),
  spec("object.transform", "authoring", "Set or offset an explicit coordinate-frame transform; reject binding conflicts or unrepresentable shear.", { id: str, frame: { enum: ["parent", "world", "object", "camera"] }, mode: { enum: ["set", "delta"] }, position: vec, rotation: vec, scale: vec, unit: str }, ["id", "frame"]),
  spec("object.clone", "authoring", "Clone an authoring subtree with regenerated IDs and remapped internal references.", { id: str, newId: str, parent: str, position: vec }, ["id", "newId"]),
  spec("object.reparent", "authoring", "Move a subtree; keepWorld preserves its pose or fails if exact TRS is impossible.", { id: str, parent: str, keepWorld: flag }, ["id"]),
  spec("scene.layout", "authoring", "Place existing objects using deterministic row/grid/circle/curve/seeded scatter layouts.", { ids: strings, layout: { enum: ["row", "grid", "circle", "curve", "scatter"] }, origin: vec, step: vec, columns: { type: "integer", minimum: 1 }, radius: num, points: { type: "array", items: vec, minItems: 2 }, bounds: schema({ min: vec, max: vec }, ["min", "max"]), seed: integer }, ["ids", "layout"]),
  spec("object.attach", "authoring", "Create a persistent design relationship using local anchors and an explicit offset frame.", { id: str, target: str, anchor: {}, targetAnchor: {}, targetPart: str, offset: vec, offsetSpace: { enum: ["world", "target"] }, orientation: { enum: ["target", "preserve"] } }, ["id", "target"]),
  spec("design.parameter.set", "authoring", "Set a scene design parameter rather than silently overwriting its bound fields.", { name: str, value: {} }, ["name", "value"]),
  spec("model.node.patch", "authoring", "Patch a modeling node by stable node ID, guarded by model revision.", { id: str, nodeId: str, baseRevision: integer, partial: obj }, ["id", "nodeId", "baseRevision", "partial"], { targets: ["modeledMesh"] }),
  spec("model.parameter.set", "authoring", "Set a modeling graph parameter, guarded by model revision.", { id: str, name: str, value: {}, baseRevision: integer }, ["id", "name", "value", "baseRevision"], { targets: ["modeledMesh"] })
];

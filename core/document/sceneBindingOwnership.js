import { indexSceneDocument, readDocumentPointer, documentError } from "./sceneDocument.js";

const valueAt = (record, path) => {
  try { return JSON.stringify(readDocumentPointer(record, path)); }
  catch (error) { if (error.code === "MISSING_PATH") return undefined; throw error; }
};
/** Generic patches have the same ownership rules as specialized modeling commands. */
export function assertRetainedBindingOwnership(before, after) {
  const design = before.root.design;
  if (!design?.bindings?.length && !design?.relations?.length) return;
  const a = indexSceneDocument(before), b = indexSceneDocument(after);
  const check = (id, path) => {
    const left = a.get(id)?.record, right = b.get(id)?.record;
    if (left && right && valueAt(left, path) !== valueAt(right, path)) throw documentError("AUTHORING_FIELD_CONTROLLED", `Field ${id}${path} is controlled by a retained design binding/relationship. Edit its parameter, or remove the binding explicitly before changing the field.`, { id, path });
  };
  for (const binding of design.bindings || []) {
    if (after.root.design?.bindings?.some((item) => item.object === binding.object && item.path === binding.path)) {
      check(binding.object, binding.path);
      if (/^\/rotation(?:\/|$)/.test(binding.path)) check(binding.object, "/quaternion");
      if (/^\/quaternion(?:\/|$)/.test(binding.path)) check(binding.object, "/rotation");
    }
  }
  for (const relation of design.relations || []) {
    if (after.root.design?.relations?.some((item) => item.object === relation.object)) for (const path of ["/position", "/rotation", "/quaternion"]) check(relation.object, path);
  }
}

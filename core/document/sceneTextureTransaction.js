import { indexSceneDocument, readDocumentPointer, cloneDocumentData, documentError } from "./sceneDocument.js";
import { diffSceneDocuments } from "./sceneCommandPlan.js";
import { createTextureAssignmentMaterial } from "../texture/textureAssignmentData.js";
import { MATERIAL_TEXTURE_SLOTS } from "../texture/textureSlots.js";

export async function applySceneSessionTextureAssignment(session, assignment, options = {}) {
  options.signal?.throwIfAborted();
  if (options.isCurrent?.(options.sceneRevision ?? assignment.revision) === false) throw documentError("STALE_TEXTURE_ASSIGNMENT", "Texture assignment is stale.");
  const entry = indexSceneDocument(session.document).get(assignment.threeJsonId);
  if (!entry) throw documentError("OBJECT_NOT_FOUND", `Texture object is no longer present: ${assignment.threeJsonId}.`);
  const relative = assignment.relativeMaterialPointer || "/material";
  const path = entry.path + relative;
  const current = readDocumentPointer(session.document.root, path);
  const expected = Object.values(assignment.slotRecords || {}).find((slot) => slot.material)?.material;
  if (expected && diffSceneDocuments({ root: expected }, { root: current }).length) throw documentError("STALE_TEXTURE_ASSIGNMENT", "Material changed after texture planning.");
  const material = createTextureAssignmentMaterial(current, assignment);
  const prepareOptions = {
    requiredTextureBindings: [{ id: entry.id, relativeMaterialPointer: relative, fields: Object.keys(assignment.maps).map((slot) => MATERIAL_TEXTURE_SLOTS[slot]?.runtimeField).filter(Boolean) }]
  };
  if (options.resolveRuntimeUrl) prepareOptions.resolveRuntimeUrl = async (url) => {
    const slot = Object.entries(assignment.maps).find(([, source]) => source === url)?.[0];
    if (!slot) return url;
    const resolved = await options.resolveRuntimeUrl(url, assignment, slot);
    return typeof resolved === "string" && resolved.startsWith("blob:") && !url.startsWith("blob:")
      ? { url: resolved, release: () => URL.revokeObjectURL(resolved) } : resolved;
  };
  await session.dispatch({ operations: [{ op: "test", path, value: cloneDocumentData(current) }, { op: "replace", path, value: material }],
    baseRevision: session.revision, signal: options.signal, label: options.label || "Apply texture assignment", historyGroup: options.historyGroup, prepareOptions });
  const warnings = [];
  try { await options.commitSceneAssignment?.(assignment); }
  catch (error) {
    // Storage/UI observers run after the atomic material commit. A failed observer
    // must not claim the texture transaction failed or trigger a duplicate retry.
    warnings.push({ code: "TEXTURE_COMMIT_OBSERVER_FAILED", message: error.message });
    try { options.onWarning?.(warnings[0]); } catch { /* observational */ }
  }
  return { ok: true, assignment, materialDescriptor: material, warnings };
}

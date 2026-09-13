import { applyTextureMaterialSemantics, MATERIAL_TEXTURE_SLOTS } from "./textureSlots.js";
const cloneJson = (value) => JSON.parse(JSON.stringify(value));

function setMaterialProperties(material, assignment) {
  applyTextureMaterialSemantics(material, assignment.maps);
  const candidate = assignment.candidate;
  if (candidate) {
    const resources = { ...(material.textureResources || {}) };
    for (const [slot, source] of Object.entries(assignment.maps || {})) {
      // Persist source/provenance and durable archive replicas, never proxy URLs with keys.
      const replica = candidate.archived ? candidate.runtimeMaps?.[slot] : null;
      resources[slot] = {
        source,
        ...(candidate.license ? { license: cloneJson(candidate.license) } : {}),
        ...(candidate.attribution ? { attribution: candidate.attribution } : {}),
        ...(replica && /^https?:\/\//i.test(replica) && !/[?&](?:key|token)=/i.test(replica) ? { replicas: [replica] } : {})
      };
    }
    material.textureResources = resources;
  }
}


/** Durable authoring fields only; runtime/proxy URLs never replace their sources. */
export function createTextureAssignmentMaterial(current, assignment) {
  const material = cloneJson(current);
  setMaterialProperties(material, assignment);
  for (const [slot, source] of Object.entries(assignment.maps || {})) {
    const field = assignment.slotRecords?.[slot]?.descriptorField || MATERIAL_TEXTURE_SLOTS[slot]?.descriptorField;
    if (field && typeof source === "string" && source.trim()) material[field] = source.trim();
  }
  return material;
}

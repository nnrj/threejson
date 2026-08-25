/**
 * Pure descriptor-side texture slot discovery.
 *
 * This module deliberately contains no network, AI, archive, or host imports. It describes
 * what the ThreeJSON runtime can consume; acquisition is supplied by the host.
 */

export const MATERIAL_TEXTURE_SLOTS = Object.freeze({
  baseColor: Object.freeze({
    descriptorField: "textureUrl",
    descriptorFields: Object.freeze(["textureUrl", "map"]),
    runtimeField: "map",
    color: true
  }),
  normal: Object.freeze({ descriptorField: "normalMap", runtimeField: "normalMap" }),
  roughness: Object.freeze({ descriptorField: "roughnessMap", runtimeField: "roughnessMap", pbr: true }),
  metalness: Object.freeze({ descriptorField: "metalnessMap", runtimeField: "metalnessMap", pbr: true }),
  ao: Object.freeze({ descriptorField: "aoMap", runtimeField: "aoMap" }),
  emissive: Object.freeze({ descriptorField: "emissiveMap", runtimeField: "emissiveMap", color: true }),
  opacity: Object.freeze({ descriptorField: "alphaMap", runtimeField: "alphaMap" }),
  bump: Object.freeze({ descriptorField: "bumpMap", runtimeField: "bumpMap" }),
  displacement: Object.freeze({ descriptorField: "displacementMap", runtimeField: "displacementMap" }),
  clearcoat: Object.freeze({ descriptorField: "clearcoatMap", runtimeField: "clearcoatMap", pbr: true }),
  clearcoatRoughness: Object.freeze({ descriptorField: "clearcoatRoughnessMap", runtimeField: "clearcoatRoughnessMap", pbr: true }),
  clearcoatNormal: Object.freeze({ descriptorField: "clearcoatNormalMap", runtimeField: "clearcoatNormalMap", pbr: true }),
  transmission: Object.freeze({ descriptorField: "transmissionMap", runtimeField: "transmissionMap", pbr: true }),
  thickness: Object.freeze({ descriptorField: "thicknessMap", runtimeField: "thicknessMap", pbr: true }),
  sheenColor: Object.freeze({ descriptorField: "sheenColorMap", runtimeField: "sheenColorMap", pbr: true, color: true }),
  sheenRoughness: Object.freeze({ descriptorField: "sheenRoughnessMap", runtimeField: "sheenRoughnessMap", pbr: true }),
  specularColor: Object.freeze({ descriptorField: "specularColorMap", runtimeField: "specularColorMap", pbr: true, color: true }),
  specularIntensity: Object.freeze({ descriptorField: "specularIntensityMap", runtimeField: "specularIntensityMap", pbr: true }),
  anisotropy: Object.freeze({ descriptorField: "anisotropyMap", runtimeField: "anisotropyMap", pbr: true }),
  iridescence: Object.freeze({ descriptorField: "iridescenceMap", runtimeField: "iridescenceMap", pbr: true }),
  iridescenceThickness: Object.freeze({ descriptorField: "iridescenceThicknessMap", runtimeField: "iridescenceThicknessMap", pbr: true })
});

export const MATERIAL_TEXTURE_SLOT_NAMES = Object.freeze(Object.keys(MATERIAL_TEXTURE_SLOTS));

const MATERIAL_CONTAINER_KEYS = new Set(["material", "materials", "materialArr"]);
// Boolean operands are build-time geometry inputs. The CSG evaluator deliberately replaces an
// operand's material with the root mesh material, then discards the operand mesh. Exposing those
// nested descriptors as independently assignable slots would therefore produce targets that do
// not exist in the live runtime. The material on the CSG root itself remains fully supported.
const NON_RENDERED_CSG_OPERAND_KEYS = new Set(["joins", "inters", "holes"]);
const SKIPPED_TREE_KEYS = new Set([
  "assetLibrary",
  "assets",
  "metadata",
  "userData",
  "textureProps",
  "textureSampling"
]);

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function escapePointerToken(value) {
  return String(value).replace(/~/g, "~0").replace(/\//g, "~1");
}

function joinPointer(parent, key) {
  return `${parent}/${escapePointerToken(key)}`;
}

function normalizeUrl(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function resolveDescriptorField(material, definition) {
  const fields = definition.descriptorFields || [definition.descriptorField];
  return fields.find((field) => normalizeUrl(material?.[field])) || definition.descriptorField;
}

function resolveDescriptorId(node, inherited) {
  // Runtime lookup is keyed exclusively by ThreeJSON identity. Generic `id`/`uuid` values may
  // describe an asset or a Three.js payload and must never be mistaken for registry identity.
  const candidates = [node?.threeJsonId];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return inherited || null;
}

function resolveDescriptorLabel(node, inherited) {
  const candidates = [node?.name, node?.label, node?.title, node?.objType];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return inherited || "material";
}

function addMaterialSlots(material, materialPointer, context, out) {
  if (!isRecord(material)) return;
  const relativeMaterialPointer = context.descriptorPointer && materialPointer.startsWith(context.descriptorPointer)
    ? materialPointer.slice(context.descriptorPointer.length) || "/material"
    : materialPointer;

  for (const slot of MATERIAL_TEXTURE_SLOT_NAMES) {
    const definition = MATERIAL_TEXTURE_SLOTS[slot];
    const descriptorField = resolveDescriptorField(material, definition);
    const valuePointer = joinPointer(materialPointer, descriptorField);
    out.push({
      id: `${materialPointer}#${slot}`,
      slot,
      descriptorField,
      runtimeField: definition.runtimeField,
      materialPointer,
      relativeMaterialPointer,
      valuePointer,
      objectPointer: context.descriptorPointer || context.nodePointer,
      threeJsonId: context.threeJsonId,
      objectName: context.label,
      currentUrl: normalizeUrl(material[descriptorField]),
      materialType: typeof material.type === "string" ? material.type : null,
      pbr: definition.pbr === true,
      colorTexture: definition.color === true,
      material
    });
  }
}

function visitNode(node, pointer, inheritedContext, out, seen) {
  if (!node || typeof node !== "object" || seen.has(node)) return;
  seen.add(node);

  if (Array.isArray(node)) {
    node.forEach((entry, index) => visitNode(entry, joinPointer(pointer, index), inheritedContext, out, seen));
    return;
  }

  const localId = resolveDescriptorId(node, null);
  const context = localId
    ? {
        threeJsonId: localId,
        descriptorPointer: pointer,
        nodePointer: pointer,
        label: resolveDescriptorLabel(node, inheritedContext?.label)
      }
    : {
        threeJsonId: inheritedContext?.threeJsonId || null,
        descriptorPointer: inheritedContext?.descriptorPointer || pointer,
        nodePointer: pointer,
        label: resolveDescriptorLabel(node, inheritedContext?.label)
      };

  if (isRecord(node.material)) {
    addMaterialSlots(node.material, joinPointer(pointer, "material"), context, out);
  }
  for (const key of ["materials", "materialArr"]) {
    const materials = node[key];
    if (!Array.isArray(materials)) continue;
    materials.forEach((material, index) => {
      addMaterialSlots(material, joinPointer(joinPointer(pointer, key), index), context, out);
    });
  }

  for (const [key, value] of Object.entries(node)) {
    if (MATERIAL_CONTAINER_KEYS.has(key)
      || NON_RENDERED_CSG_OPERAND_KEYS.has(key)
      || SKIPPED_TREE_KEYS.has(key)) continue;
    if (value && typeof value === "object") {
      visitNode(value, joinPointer(pointer, key), context, out, seen);
    }
  }
}

/**
 * Scan standard and friendly ThreeJSON descriptors, including material/materials/materialArr,
 * CSG result roots and nested sub-scenes. Non-rendered CSG operands are intentionally omitted.
 * Each material exposes every runtime-supported PBR slot.
 *
 * @param {object} scene
 * @param {{ onlyEmpty?: boolean, slots?: string[], changedObjectIds?: string[]|Set<string> }} [options]
 * @returns {Array<object>}
 */
export function listMaterialTextureSlots(scene, options = {}) {
  if (!scene || typeof scene !== "object") return [];
  const all = [];
  visitNode(scene, "", null, all, new WeakSet());
  const allowedSlots = Array.isArray(options.slots) && options.slots.length
    ? new Set(options.slots)
    : null;
  const changedIds = options.changedObjectIds
    ? new Set(Array.from(options.changedObjectIds, (value) => String(value)))
    : null;
  return all.filter((entry) => {
    if (options.onlyEmpty === true && entry.currentUrl) return false;
    if (allowedSlots && !allowedSlots.has(entry.slot)) return false;
    if (changedIds && (!entry.threeJsonId || !changedIds.has(entry.threeJsonId))) return false;
    return true;
  });
}

/** Group the flat slot list into the compact material records sent to a planner. */
export function groupMaterialTextureSlots(slots) {
  const grouped = new Map();
  for (const slot of Array.isArray(slots) ? slots : []) {
    let record = grouped.get(slot.materialPointer);
    if (!record) {
      record = {
        materialPointer: slot.materialPointer,
        relativeMaterialPointer: slot.relativeMaterialPointer,
        objectPointer: slot.objectPointer,
        threeJsonId: slot.threeJsonId,
        objectName: slot.objectName,
        materialType: slot.materialType,
        availableSlots: [],
        populatedSlots: {}
      };
      grouped.set(slot.materialPointer, record);
    }
    record.availableSlots.push(slot.slot);
    if (slot.currentUrl) record.populatedSlots[slot.slot] = slot.currentUrl;
  }
  return Array.from(grouped.values());
}

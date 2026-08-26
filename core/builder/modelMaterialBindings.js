import {
  applyMaterialDescriptorProperties,
  createMaterialFromDescriptor,
  inferMaterialType,
  normalizeMaterialType
} from "./material/materialFactory.js";
import { disposeMaterialResource } from "../handler/disposeObjectTree.js";

const MODEL_MATERIAL_SELECTOR_FIELDS = new Set([
  "all", "caseSensitive",
  "nodeName", "nodeNames", "nodePath", "nodePaths", "nodeType", "nodeTypes",
  "materialName", "materialNames", "meshIndex", "meshIndices",
  "materialIndex", "materialIndices"
]);

function list(value) {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wildcardRegExp(pattern, caseSensitive) {
  const source = escapeRegExp(pattern).replace(/\\\*/g, ".*").replace(/\\\?/g, ".");
  return new RegExp(`^${source}$`, caseSensitive ? "" : "i");
}

function matchesText(actual, expected, caseSensitive = false) {
  const candidates = list(expected).map((value) => String(value ?? "").trim()).filter(Boolean);
  if (candidates.length === 0) return true;
  const text = String(actual ?? "");
  return candidates.some((pattern) => {
    if (pattern.includes("*") || pattern.includes("?")) {
      return wildcardRegExp(pattern, caseSensitive).test(text);
    }
    return caseSensitive ? text === pattern : text.toLowerCase() === pattern.toLowerCase();
  });
}

function matchesNumber(actual, expected) {
  const candidates = list(expected).map(Number).filter(Number.isInteger);
  return candidates.length === 0 || candidates.includes(Number(actual));
}

function objectPathSegment(object) {
  const name = String(object?.name || "").trim();
  if (name) return name;
  const index = object?.parent?.children?.indexOf?.(object);
  return `${String(object?.type || "Object3D")}[${Number.isInteger(index) && index >= 0 ? index : 0}]`;
}

function objectPath(object, root) {
  const segments = [];
  let cursor = object;
  while (cursor) {
    segments.push(objectPathSegment(cursor));
    if (cursor === root) break;
    cursor = cursor.parent;
  }
  return `/${segments.reverse().join("/")}`;
}

function collectMaterialTargets(root) {
  const targets = [];
  let meshIndex = -1;
  root?.traverse?.((object) => {
    if (object?.isMesh !== true) return;
    meshIndex += 1;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material, materialIndex) => {
      if (!material?.isMaterial) return;
      targets.push({
        mesh: object,
        meshIndex,
        nodeName: String(object.name || ""),
        nodePath: objectPath(object, root),
        nodeType: String(object.type || ""),
        materialIndex,
        originalMaterial: material,
        currentMaterial: material
      });
    });
  });
  return targets;
}

function selectorMatches(target, selector = {}) {
  const caseSensitive = selector.caseSensitive === true;
  if (!matchesText(target.nodeName, selector.nodeName ?? selector.nodeNames, caseSensitive)) return false;
  if (!matchesText(target.nodePath, selector.nodePath ?? selector.nodePaths, caseSensitive)) return false;
  if (!matchesText(target.nodeType, selector.nodeType ?? selector.nodeTypes, caseSensitive)) return false;
  if (!matchesText(
    target.originalMaterial?.name,
    selector.materialName ?? selector.materialNames,
    caseSensitive
  )) return false;
  if (!matchesNumber(target.meshIndex, selector.meshIndex ?? selector.meshIndices)) return false;
  if (!matchesNumber(
    target.materialIndex,
    selector.materialIndex ?? selector.materialIndices
  )) return false;
  return true;
}

function assertSelector(selector, bindingIndex) {
  const unknownFields = Object.keys(selector).filter((key) => !MODEL_MATERIAL_SELECTOR_FIELDS.has(key));
  if (unknownFields.length > 0) {
    const error = new Error(
      `External-model material binding ${bindingIndex} has unknown selector fields: ${unknownFields.join(", ")}`
    );
    error.code = "E_MODEL_MATERIAL_SELECTOR_INVALID";
    error.bindingIndex = bindingIndex;
    error.unknownFields = unknownFields;
    throw error;
  }
}

function normalizeBindings(record) {
  if (Array.isArray(record?.materialBindings)) return record.materialBindings;
  if (record?.materialBinding && typeof record.materialBinding === "object") {
    return [record.materialBinding];
  }
  return [];
}

function materialDescriptorForBinding(binding) {
  const descriptor = binding?.material ?? binding?.descriptor;
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
    const error = new Error("External-model material binding requires a material descriptor");
    error.code = "E_MODEL_MATERIAL_BINDING_INVALID";
    throw error;
  }
  return descriptor;
}

function createBoundMaterial(binding, target, root, record) {
  const descriptor = materialDescriptorForBinding(binding);
  const material = createMaterialFromDescriptor(descriptor, {
    fallbackType: "standard",
    modelRoot: root,
    modelDescriptor: record,
    mesh: target.mesh,
    meshIndex: target.meshIndex,
    materialIndex: target.materialIndex,
    originalMaterial: target.originalMaterial,
    binding
  });
  if (!descriptor.name && target.originalMaterial?.name) material.name = target.originalMaterial.name;
  material.userData = {
    ...(material.userData || {}),
    threeJsonModelMaterialBinding: {
      nodePath: target.nodePath,
      materialIndex: target.materialIndex
    }
  };
  return material;
}

function createPatchedMaterial(binding, target) {
  const descriptor = materialDescriptorForBinding(binding);
  const requestedType = normalizeMaterialType(descriptor.type);
  const currentType = inferMaterialType(
    { type: target.currentMaterial?.userData?.threeJsonMaterialType || target.currentMaterial?.type },
    "standard"
  );
  if (requestedType && requestedType !== currentType) {
    const error = new Error("A material binding with mode=patch cannot change material type; use mode=replace");
    error.code = "E_MODEL_MATERIAL_PATCH_TYPE_CHANGE";
    throw error;
  }
  const material = target.currentMaterial.clone();
  applyMaterialDescriptorProperties(material, descriptor);
  material.userData = {
    ...(material.userData || {}),
    threeJsonModelMaterialBinding: {
      nodePath: target.nodePath,
      materialIndex: target.materialIndex,
      mode: "patch"
    }
  };
  return material;
}

function assignTargets(targets) {
  const byMesh = new Map();
  for (const target of targets) {
    if (!byMesh.has(target.mesh)) byMesh.set(target.mesh, []);
    byMesh.get(target.mesh).push(target);
  }
  for (const [mesh, meshTargets] of byMesh) {
    if (Array.isArray(mesh.material)) {
      const next = mesh.material.slice();
      for (const target of meshTargets) next[target.materialIndex] = target.currentMaterial;
      mesh.material = next;
    } else if (meshTargets[0]) {
      mesh.material = meshTargets[0].currentMaterial;
    }
  }
}

function collectMaterialTextures(material, out) {
  if (!material || typeof material !== "object") return;
  for (const value of Object.values(material)) {
    if (value?.isTexture === true) out.add(value);
  }
  for (const uniform of Object.values(material.uniforms || {})) {
    const values = Array.isArray(uniform?.value) ? uniform.value : [uniform?.value];
    for (const value of values) {
      if (value?.isTexture === true) out.add(value);
    }
  }
}

function disposeDetachedMaterials(targets, createdMaterials, retainedMaterials, enabled) {
  if (!enabled) return 0;
  const retainedTextures = new Set();
  for (const material of retainedMaterials) collectMaterialTextures(material, retainedTextures);
  const detached = new Set([
    ...targets.map((target) => target.originalMaterial),
    ...createdMaterials
  ]);
  const state = { materials: new Set(), textures: retainedTextures };
  let disposed = 0;
  for (const material of detached) {
    if (!material?.isMaterial || retainedMaterials.has(material)) continue;
    disposeMaterialResource(material, state);
    disposed += 1;
  }
  return disposed;
}

/**
 * Apply declarative material bindings after an external model has loaded. The mechanism is
 * renderer-neutral: WebGPU/TSL participates through the ordinary material factory registry.
 */
export function applyModelMaterialBindings(root, record = {}) {
  const bindings = normalizeBindings(record);
  const targets = collectMaterialTargets(root);
  const summary = {
    bindingCount: bindings.length,
    targetCount: targets.length,
    matchedSlots: 0,
    replacedSlots: 0,
    patchedSlots: 0,
    disposedMaterials: 0,
    unmatchedBindings: []
  };
  if (bindings.length === 0 || targets.length === 0) return summary;

  const plans = bindings.map((binding, bindingIndex) => {
    const selector = binding?.selector && typeof binding.selector === "object"
      ? binding.selector
        : binding?.match && typeof binding.match === "object"
          ? binding.match
          : {};
    assertSelector(selector, bindingIndex);
    materialDescriptorForBinding(binding);
    const mode = String(binding?.mode || "replace").trim().toLowerCase();
    if (mode !== "replace" && mode !== "patch") {
      const error = new Error(`Unsupported external-model material binding mode: ${mode}`);
      error.code = "E_MODEL_MATERIAL_BINDING_MODE_UNAVAILABLE";
      error.bindingIndex = bindingIndex;
      throw error;
    }
    const matches = targets.filter((target) => selectorMatches(target, selector));
    if (matches.length === 0) {
      summary.unmatchedBindings.push(bindingIndex);
      if (binding?.required === true || record.materialBindingsStrict === true) {
        const error = new Error(`External-model material binding ${bindingIndex} matched no material slots`);
        error.code = "E_MODEL_MATERIAL_BINDING_UNMATCHED";
        error.bindingIndex = bindingIndex;
        error.selector = selector;
        throw error;
      }
    }
    return { binding, bindingIndex, matches, mode };
  });

  const createdMaterials = new Set();
  for (const { binding, matches, mode } of plans) {
    if (matches.length === 0) continue;
    const shareMaterial = binding?.shareMaterial !== false && mode === "replace";
    let sharedMaterial = null;
    for (const target of matches) {
      const material = shareMaterial
        ? sharedMaterial || (sharedMaterial = createBoundMaterial(binding, target, root, record))
        : mode === "patch"
          ? createPatchedMaterial(binding, target)
          : createBoundMaterial(binding, target, root, record);
      createdMaterials.add(material);
      target.currentMaterial = material;
      summary.matchedSlots += 1;
      if (mode === "patch") summary.patchedSlots += 1;
      else summary.replacedSlots += 1;
    }
  }

  assignTargets(targets);
  const retainedMaterials = new Set(targets.map((target) => target.currentMaterial));
  summary.disposedMaterials = disposeDetachedMaterials(
    targets,
    createdMaterials,
    retainedMaterials,
    record.disposeReplacedMaterials !== false
  );
  root.userData = { ...(root.userData || {}), threeJsonMaterialBindings: summary };
  return summary;
}

export function listModelMaterialSlots(root) {
  return collectMaterialTargets(root).map((target) => ({
    mesh: target.mesh,
    meshIndex: target.meshIndex,
    nodeName: target.nodeName,
    nodePath: target.nodePath,
    nodeType: target.nodeType,
    materialIndex: target.materialIndex,
    materialName: String(target.originalMaterial?.name || ""),
    material: target.originalMaterial
  }));
}

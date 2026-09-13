import { indexSceneDocument, cloneDocumentData, documentError } from "../document/sceneDocument.js";
import { getObjectByThreeJsonId, refreshRegisteredObject } from "../handler/objectRegistry.js";
import { createGeometryFromDescriptor } from "../builder/geometry/geometryFactory.js";
import { createMaterialFromDescriptor, applyMaterialDescriptorProperties, inferMaterialType } from "../builder/material/materialFactory.js";
import { applyMaterialTextureSetFromJson, applyTextureRepeatToMap, whenTextureReady } from "../util/loadTextureFromMaterialJson.js";
import { cloneTextureResource, isManagedTexture, getMaterialTextureRequest, getTextureLoadState } from "../resource/textureRequest.js";
import { MATERIAL_TEXTURE_SLOTS } from "../texture/textureSlots.js";
import { applyObjectTransform } from "../util/objectTransform.js";

const POSE = new Set(["position", "rotation", "quaternion", "scale", "visible", "name", "castShadow", "receiveShadow", "renderOrder", "frustumCulled"]);
const DATA = new Set(["label", "metadata", "businessInfo", "jsonOrigin"]);
const MATERIAL = new Set(["material", "materials", "materialArr"]);
const GEOMETRY = new Set(["geometry", "topology", "modifiers", "meshRevision", "positions", "indices", "normals", "uvs", "objType"]);
const primitiveTypes = new Set(["box", "sphere", "cylinder", "cone", "ring", "torus", "capsule", "plane", "circle"]);
const materialList = (value) => Array.isArray(value) ? value : value ? [value] : [];
const textureValues = (value) => Object.values(value || {}).filter((item) => item?.isTexture);
const equal = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);

function isPlainMeshRecord(record) {
  const type = String(record?.objType || "").toLowerCase();
  return (primitiveTypes.has(type) || type === "editablemesh" || type === "buffermesh")
    && !record.merge && !record.geometryArr && !record.combineArr?.length
    && !record.holes?.length && !record.joins?.length && !record.modelPath;
}

function materialDescriptors(record, length) {
  if (record.materials?.length) return record.materials;
  if (record.materialArr?.length) return record.materialArr;
  return Array.from({ length: Math.max(1, length) }, () => record.material || {});
}

/** Dispose only detached engine resources; another object may share old geometry/materials. */
function releaseDetached(scene, geometries, materials) {
  const used = new Set();
  scene?.traverse?.((object) => {
    used.add(object.geometry);
    for (const material of materialList(object.material)) {
      used.add(material); for (const texture of textureValues(material)) used.add(texture);
    }
  });
  const textures = new Set();
  for (const material of materials) {
    if (used.has(material)) continue;
    for (const texture of textureValues(material)) if (isManagedTexture(texture) && !used.has(texture)) textures.add(texture);
    material.dispose();
  }
  for (const texture of textures) texture.dispose();
  for (const geometry of geometries) if (!used.has(geometry)) geometry.dispose();
}

async function prepareMaterials(object, before, after, options) {
  const previous = materialList(object.material);
  const oldDescriptors = materialDescriptors(before, previous.length);
  const descriptors = materialDescriptors(after, previous.length);
  const prepared = [], owned = new Set();
  try {
    for (let i = 0; i < descriptors.length; i++) {
      const descriptor = descriptors[i], original = previous[i] || previous[0];
      const oldDescriptor = oldDescriptors[i] || oldDescriptors[0] || {};
      const type = inferMaterialType(descriptor, original?.type || "standard");
      const removedProperty = Object.keys(oldDescriptor).some((key) => !(key in descriptor));
      const sameType = original && type === inferMaterialType({ type: original.type });
      const material = sameType && !removedProperty ? original.clone()
        : createMaterialFromDescriptor(descriptor, { fallbackType: original?.type || "standard", defaultColor: "#cccccc" });
      prepared.push(material);
      applyMaterialDescriptorProperties(material, descriptor);
      if (descriptor.opacity < 1 && descriptor.transparent == null) material.transparent = true;
      const toLoad = { ...descriptor };
      for (const [slot, definition] of Object.entries(MATERIAL_TEXTURE_SLOTS)) {
        const field = definition.runtimeField;
        const source = slot === "baseColor" ? descriptor.textureUrl ?? descriptor.map : descriptor[definition.descriptorField];
        const oldSource = slot === "baseColor" ? oldDescriptor.textureUrl ?? oldDescriptor.map : oldDescriptor[definition.descriptorField];
        // Independent views retain the shared image lease; repeat/sampling edits never mutate siblings.
        const existing = getMaterialTextureRequest(original, field);
        if (existing && equal(source, oldSource) && !["error", "cancelled"].includes(getTextureLoadState(existing))) {
          const texture = cloneTextureResource(existing); owned.add(texture);
          await whenTextureReady(texture);
          material[field] = texture;
          applyTextureRepeatToMap(material[field], descriptor);
          delete toLoad[definition.descriptorField];
          if (slot === "baseColor") { delete toLoad.map; delete toLoad.textureUrl; }
        } else if (equal(source, oldSource)) {
          // An unrelated color edit must not retry an already failed historical URL.
          material[field] = null; delete toLoad[definition.descriptorField];
          if (slot === "baseColor") { delete toLoad.map; delete toLoad.textureUrl; }
        } else if (!source) material[field] = null;
        else material[field] = null;
      }
      const textures = applyMaterialTextureSetFromJson(material, toLoad, options);
      for (const texture of Object.values(textures)) owned.add(texture);
      await Promise.all(Object.values(textures).map(whenTextureReady));
      options.signal?.throwIfAborted();
    }
    return { value: Array.isArray(object.material) || descriptors.length > 1 ? prepared : prepared[0], materials: prepared, owned };
  } catch (error) {
    for (const material of prepared) material.dispose();
    for (const texture of owned) texture.dispose();
    throw error;
  }
}

export async function prepareDocumentMeshGeometry(record, options = {}) {
  const type = String(record.objType).toLowerCase();
  let built;
  if (type === "editablemesh") {
    const { buildEditableMeshGeometry } = await import("../builder/editableMesh/editableMeshBuilder.js");
    built = buildEditableMeshGeometry(record, options);
  } else if (type === "buffermesh") {
    const { buildBufferMeshGeometry } = await import("../builder/bufferMeshBuilder.js");
    built = buildBufferMeshGeometry(record, options);
  } else built = { geometry: createGeometryFromDescriptor(record) };
  if (!built.geometry) throw documentError(built.code || "INVALID_GEOMETRY", built.error || "Geometry preparation failed.");
  return built;
}

function geometryRanges(before, after) {
  if (!equal(before.groups, after.groups) || !equal(before.drawRange, after.drawRange)
      || Object.keys(before.morphAttributes).length || Object.keys(after.morphAttributes).length) return null;
  const names = Object.keys(before.attributes);
  if (!equal(names.sort(), Object.keys(after.attributes).sort()) || !!before.index !== !!after.index) return null;
  const pairs = names.map((key) => [before.attributes[key], after.attributes[key]]);
  if (before.index) pairs.push([before.index, after.index]);
  const ranges = [];
  for (const [old, next] of pairs) {
    if (old.isInterleavedBufferAttribute || next.isInterleavedBufferAttribute || old.itemSize !== next.itemSize
        || old.normalized !== next.normalized || old.array.constructor !== next.array.constructor || old.array.length !== next.array.length) return null;
    let start = 0;
    while (start < old.array.length) {
      while (start < old.array.length && old.array[start] === next.array[start]) start++;
      if (start === old.array.length) break;
      let end = start + 1;
      while (end < old.array.length && old.array[end] !== next.array[end]) end++;
      ranges.push({ attribute: old, start, before: old.array.slice(start, end), after: next.array.slice(start, end) });
      start = end;
    }
  }
  return ranges;
}

function pose(object) {
  return { position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone(), visible: object.visible, name: object.name,
    castShadow: object.castShadow, receiveShadow: object.receiveShadow, renderOrder: object.renderOrder, frustumCulled: object.frustumCulled };
}
function setPose(object, state) {
  object.position.copy(state.position); object.quaternion.copy(state.quaternion); object.scale.copy(state.scale);
  object.visible = state.visible; object.name = state.name; object.updateMatrix(); object.updateMatrixWorld(true);
  for (const key of ["castShadow", "receiveShadow", "renderOrder", "frustumCulled"]) object[key] = state[key];
}

/** Prepare all supported object edits without publishing any intermediate mutation. */
export async function prepareIncrementalSceneChanges(runtime, document, context, options = {}) {
  if (!runtime?.scene || !context.previousDocument || !context.operations?.length) return null;
  const oldIndex = indexSceneDocument(context.previousDocument), index = indexSceneDocument(document);
  const byPath = [...index.values()].sort((a, b) => b.path.length - a.path.length), changes = new Map();
  for (const operation of context.operations) {
    if (!["add", "replace", "remove", "array.splice"].includes(operation.op)) return null;
    const entry = byPath.find((item) => operation.path.startsWith(`${item.path}/`));
    const field = entry && operation.path.slice(entry.path.length + 1).split("/")[0];
    if (!field || (!POSE.has(field) && !DATA.has(field) && !MATERIAL.has(field) && !GEOMETRY.has(field))) return null;
    const before = oldIndex.get(entry.id)?.record, object = getObjectByThreeJsonId(entry.id, runtime.scene);
    if (!before || !object) return null;
    if (!POSE.has(field) && !DATA.has(field) && (!object.isMesh || runtime.renderer?.isWebGPURenderer)) return null;
    if (GEOMETRY.has(field) && (!isPlainMeshRecord(before) || !isPlainMeshRecord(entry.record) || object.isSkinnedMesh || object.isInstancedMesh)) return null;
    if (MATERIAL.has(field) && materialList(object.material).some((material) => material.isShaderMaterial || material.isNodeMaterial)) return null;
    let change = changes.get(entry.id);
    if (!change) changes.set(entry.id, change = { entry, before, object, fields: new Set() });
    change.fields.add(field);
  }
  const staged = [];
  const disposePrepared = () => {
    for (const item of staged) {
      item.geometry?.geometry.dispose();
      for (const material of item.material?.materials || []) material.dispose();
      for (const texture of item.material?.owned || []) texture.dispose();
    }
  };
  try {
    for (const change of changes.values()) {
      const { object, entry, before, fields } = change;
      const item = { ...change, oldPose: pose(object), oldDescriptor: object.userData.objJson,
        oldGeometry: object.geometry, oldMaterial: object.material, oldStats: object.userData.threeJsonMeshStats,
        oldMorphInfluences: object.morphTargetInfluences, oldMorphDictionary: object.morphTargetDictionary };
      staged.push(item);
      item.descriptor = cloneDocumentData(entry.record);
      if ([...fields].some((field) => POSE.has(field))) {
        const probe = { position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone(), rotation: object.rotation.clone() };
        probe.rotation._onChange(() => probe.quaternion.setFromEuler(probe.rotation));
        applyObjectTransform(probe, entry.record);
        item.newPose = { ...item.oldPose };
        for (const field of ["position", "scale"]) if (fields.has(field)) item.newPose[field] = probe[field].clone();
        if (fields.has("rotation") || fields.has("quaternion")) item.newPose.quaternion = probe.quaternion.clone();
        if (fields.has("visible")) item.newPose.visible = entry.record.visible !== false;
        if (fields.has("name")) item.newPose.name = entry.record.name || "";
        for (const key of ["castShadow", "receiveShadow"]) if (fields.has(key)) item.newPose[key] = entry.record[key] === true;
        if (fields.has("frustumCulled")) item.newPose.frustumCulled = entry.record.frustumCulled !== false;
        if (fields.has("renderOrder")) item.newPose.renderOrder = entry.record.renderOrder ?? 0;
        if ([...item.newPose.position.toArray(), ...item.newPose.quaternion.toArray(), ...item.newPose.scale.toArray()].some((value) => !Number.isFinite(value))) throw documentError("INVALID_TRANSFORM", `Non-finite transform for ${entry.id}.`);
      }
      if ([...fields].some((field) => MATERIAL.has(field))) item.material = await prepareMaterials(object, before, entry.record, { ...options, runtimeScope: runtime.scene, signal: context.signal });
      if ([...fields].some((field) => GEOMETRY.has(field))) {
        item.geometry = await prepareDocumentMeshGeometry(entry.record, options);
        item.ranges = geometryRanges(object.geometry, item.geometry.geometry);
      }
      context.signal?.throwIfAborted();
    }
  } catch (error) { disposePrepared(); throw error; }
  let committed = false, cleaned = false;
  return {
    strategy: "incremental-objects",
    commit() {
      committed = true;
      for (const item of staged) {
        const { object } = item;
        if (item.newPose) setPose(object, item.newPose);
        if (item.material) object.material = item.material.value;
        if (item.geometry) {
          if (item.ranges) {
            for (const range of item.ranges) { range.attribute.array.set(range.after, range.start); range.attribute.addUpdateRange(range.start, range.after.length); range.attribute.needsUpdate = true; }
            object.geometry.computeBoundingBox(); object.geometry.computeBoundingSphere();
          } else { object.geometry = item.geometry.geometry; object.updateMorphTargets?.(); }
          object.userData.threeJsonMeshStats = item.geometry.stats;
          for (const material of materialList(object.material)) material.needsUpdate = true;
        }
        object.userData.objJson = item.descriptor;
        refreshRegisteredObject(object, item.descriptor, { recursive: false }, runtime.scene);
      }
      runtime.invalidate?.();
    },
    rollback() {
      if (!committed) return;
      for (const item of staged) {
        setPose(item.object, item.oldPose); item.object.geometry = item.oldGeometry; item.object.material = item.oldMaterial;
        if (item.ranges) for (const range of item.ranges) { range.attribute.array.set(range.before, range.start); range.attribute.addUpdateRange(range.start, range.before.length); range.attribute.needsUpdate = true; }
        if (item.geometry) { item.oldGeometry.computeBoundingBox(); item.oldGeometry.computeBoundingSphere(); }
        item.object.userData.objJson = item.oldDescriptor; item.object.userData.threeJsonMeshStats = item.oldStats;
        item.object.morphTargetInfluences = item.oldMorphInfluences; item.object.morphTargetDictionary = item.oldMorphDictionary;
        refreshRegisteredObject(item.object, item.oldDescriptor, { recursive: false }, runtime.scene);
      }
      committed = false; runtime.invalidate?.();
    },
    dispose() { if (!cleaned && !committed) { cleaned = true; disposePrepared(); } },
    finalize() {
      if (cleaned || !committed) return; cleaned = true;
      const geometries = new Set(), materials = new Set();
      for (const item of staged) {
        if (item.geometry) { if (item.ranges) item.geometry.geometry.dispose(); else geometries.add(item.oldGeometry); }
        if (item.material) for (const material of materialList(item.oldMaterial)) materials.add(material);
      }
      releaseDetached(runtime.scene, geometries, materials);
    }
  };
}

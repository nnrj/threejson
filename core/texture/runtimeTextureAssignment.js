import * as THREE from "three";
import { getObjectByThreeJsonId } from "../handler/objectRegistry.js";
import { trackDisposableResource } from "../handler/trackedResourceRegistry.js";
import { getByPointer } from "../util/jsonPointer.js";
import { resolvePublicAssetUrlCandidates } from "../util/assetsBase.js";
import { resolveLibTokenToUrl } from "../cache/assetRegistry.js";
import { applyTextureRepeatToMap } from "../util/loadTextureFromMaterialJson.js";
import { applyTexturePropsFromRecord } from "../util/textureSampling.js";
import { MATERIAL_TEXTURE_SLOTS } from "./textureSlots.js";

function abortError(signal) {
  return signal?.reason || new DOMException("Texture assignment aborted.", "AbortError");
}

function checkCurrent(assignment, options) {
  if (options.signal?.aborted) throw abortError(options.signal);
  const currentRevision = options.sceneRevision ?? assignment.revision;
  if (typeof options.isCurrent === "function" && !options.isCurrent(currentRevision)) {
    const error = new Error("Texture assignment belongs to an expired scene revision.");
    error.code = "STALE_TEXTURE_ASSIGNMENT";
    throw error;
  }
}

function resolveRuntimeTextureSource(url, runtimeScope) {
  const source = String(url || "").trim();
  if (!source.toLowerCase().startsWith("lib://")) return source;
  const token = source.slice("lib://".length).trim();
  const resolved = resolveLibTokenToUrl(token, runtimeScope);
  if (!resolved) throw new Error(`Texture asset reference could not be resolved: ${source}`);
  return resolved;
}

function textureLoaderPromise(url, options = {}) {
  const loader = options.loader || new THREE.TextureLoader();
  let source;
  try {
    source = resolveRuntimeTextureSource(url, options.runtimeScope);
  } catch (error) {
    return Promise.reject(error);
  }
  const candidates = resolvePublicAssetUrlCandidates(source);
  return new Promise((resolve, reject) => {
    const loadAt = (index, previousError) => {
      if (options.signal?.aborted) {
        reject(abortError(options.signal));
        return;
      }
      const candidate = candidates[index];
      if (!candidate) {
        reject(previousError || new Error(`Unable to load texture: ${source}`));
        return;
      }
      loader.load(candidate, (texture) => {
        if (options.signal?.aborted) {
          texture.dispose?.();
          reject(abortError(options.signal));
          return;
        }
        texture.userData = texture.userData || {};
        texture.userData.threeJsonResolvedUrl = candidate;
        if (candidate.startsWith("blob:") && typeof URL?.revokeObjectURL === "function") {
          const dispose = texture.dispose.bind(texture);
          let revoked = false;
          texture.dispose = () => {
            dispose();
            if (!revoked) {
              revoked = true;
              URL.revokeObjectURL(candidate);
            }
          };
        }
        trackDisposableResource(texture);
        resolve(texture);
      }, undefined, (error) => loadAt(index + 1, error));
    };
    loadAt(0);
  });
}

function materialIndexFromPointer(pointer) {
  const match = String(pointer || "").match(/\/(?:materials|materialArr)\/(\d+)(?:\/|$)/);
  return match ? Number(match[1]) : null;
}

function collectMaterialTargets(root, relativePointer) {
  const requestedIndex = materialIndexFromPointer(relativePointer);
  const targets = [];
  root.traverse?.((object) => {
    if (!object?.isMesh || !object.material) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (requestedIndex !== null) {
      // Builders are allowed to collapse a descriptor's six identical face materials into one
      // runtime material.  In that case an assignment aimed at /materials/<face> still targets
      // the one material that actually renders every face.
      const runtimeIndex = Array.isArray(object.material) ? requestedIndex : 0;
      if (materials[runtimeIndex]) targets.push({ object, index: runtimeIndex, material: materials[runtimeIndex] });
      return;
    }
    materials.forEach((material, index) => {
      if (material) targets.push({ object, index, material });
    });
  });
  return targets;
}

function promoteToStandard(target) {
  const old = target.material;
  const material = new THREE.MeshStandardMaterial({
    color: old.color?.clone?.() || new THREE.Color(0xffffff),
    opacity: old.opacity,
    transparent: old.transparent,
    side: old.side,
    depthTest: old.depthTest,
    depthWrite: old.depthWrite,
    visible: old.visible,
    vertexColors: old.vertexColors,
    map: old.map || null,
    alphaMap: old.alphaMap || null,
    aoMap: old.aoMap || null,
    bumpMap: old.bumpMap || null,
    displacementMap: old.displacementMap || null,
    emissive: old.emissive?.clone?.() || new THREE.Color(0x000000),
    emissiveMap: old.emissiveMap || null,
    emissiveIntensity: old.emissiveIntensity ?? 1,
    normalMap: old.normalMap || null,
    roughness: old.roughness ?? 1,
    metalness: old.metalness ?? 0
  });
  material.name = old.name;
  material.userData = { ...(old.userData || {}) };
  trackDisposableResource(material);
  if (Array.isArray(target.object.material)) {
    const next = target.object.material.slice();
    next[target.index] = material;
    target.object.material = next;
  } else {
    target.object.material = material;
  }
  target.material = material;
  return material;
}

function promoteToPhysical(target) {
  const old = target.material;
  const material = new THREE.MeshPhysicalMaterial({
    color: old.color?.clone?.() || new THREE.Color(0xffffff),
    opacity: old.opacity,
    transparent: old.transparent,
    side: old.side,
    depthTest: old.depthTest,
    depthWrite: old.depthWrite,
    visible: old.visible,
    vertexColors: old.vertexColors,
    map: old.map || null,
    alphaMap: old.alphaMap || null,
    aoMap: old.aoMap || null,
    bumpMap: old.bumpMap || null,
    displacementMap: old.displacementMap || null,
    emissive: old.emissive?.clone?.() || new THREE.Color(0x000000),
    emissiveMap: old.emissiveMap || null,
    emissiveIntensity: old.emissiveIntensity ?? 1,
    normalMap: old.normalMap || null,
    roughnessMap: old.roughnessMap || null,
    metalnessMap: old.metalnessMap || null,
    roughness: old.roughness ?? 1,
    metalness: old.metalness ?? 0
  });
  material.name = old.name;
  material.userData = { ...(old.userData || {}) };
  trackDisposableResource(material);
  replaceTargetMaterial(target, material);
  return material;
}

function replaceTargetMaterial(target, material) {
  if (Array.isArray(target.object.material)) {
    const next = target.object.material.slice();
    next[target.index] = material;
    target.object.material = next;
  } else {
    target.object.material = material;
  }
  target.material = material;
}

const STANDARD_MATERIAL_SLOTS = new Set([
  "normal",
  "roughness",
  "metalness",
  "ao",
  "emissive",
  "bump",
  "displacement"
]);

const PHYSICAL_MATERIAL_SLOTS = new Set([
  "clearcoat",
  "clearcoatRoughness",
  "clearcoatNormal",
  "transmission",
  "thickness",
  "sheenColor",
  "sheenRoughness",
  "specularColor",
  "specularIntensity",
  "anisotropy",
  "iridescence",
  "iridescenceThickness"
]);

function needsStandardMaterial(maps, material) {
  if (material?.isMeshStandardMaterial || material?.isMeshPhysicalMaterial) return false;
  return Object.keys(maps || {}).some((slot) => STANDARD_MATERIAL_SLOTS.has(slot));
}

function needsPhysicalMaterial(maps, material) {
  if (material?.isMeshPhysicalMaterial) return false;
  return Object.keys(maps || {}).some((slot) => PHYSICAL_MATERIAL_SLOTS.has(slot));
}

/**
 * Preload every map in an assignment, then commit the descriptor and live materials together.
 * A failed preload leaves both the descriptor and visible runtime untouched.
 */
export async function applyTextureAssignmentAsync(runtime, assignment, options = {}) {
  if (!runtime || !assignment || typeof assignment !== "object") {
    throw new TypeError("applyTextureAssignmentAsync requires runtime and assignment.");
  }
  checkCurrent(assignment, options);
  const runtimeScope = runtime.runtimeContext || runtime.scene || runtime;
  const object3D = getObjectByThreeJsonId(assignment.threeJsonId, runtimeScope);
  if (!object3D) throw new Error(`Texture target not found: ${assignment.threeJsonId || assignment.objectPointer || "unknown"}.`);
  const descriptor = object3D.userData?.objJson;
  if (!descriptor || typeof descriptor !== "object") throw new Error("Texture target has no bound ThreeJSON descriptor.");
  const materialDescriptor = getByPointer(descriptor, assignment.relativeMaterialPointer || "/material");
  if (!materialDescriptor || typeof materialDescriptor !== "object") {
    throw new Error(`Material descriptor not found at ${assignment.relativeMaterialPointer || "/material"}.`);
  }
  const targets = collectMaterialTargets(object3D, assignment.relativeMaterialPointer);
  if (!targets.length) throw new Error("Texture target has no runtime mesh material.");

  const loaded = {};
  try {
    await Promise.all(Object.entries(assignment.maps || {}).map(async ([slot, authoritativeUrl]) => {
      const definition = MATERIAL_TEXTURE_SLOTS[slot];
      if (!definition || typeof authoritativeUrl !== "string" || !authoritativeUrl.trim()) return;
      const runtimeUrl = typeof options.resolveRuntimeUrl === "function"
        ? await options.resolveRuntimeUrl(authoritativeUrl, assignment, slot)
        : authoritativeUrl;
      const texture = typeof options.loadTexture === "function"
        ? await options.loadTexture(runtimeUrl, { signal: options.signal, assignment, slot })
        : await textureLoaderPromise(runtimeUrl, {
          signal: options.signal,
          runtimeScope,
          loader: options.loader
        });
      if (!texture?.isTexture) throw new Error(`Texture loader returned no THREE.Texture for ${slot}.`);
      applyTextureRepeatToMap(texture, materialDescriptor);
      applyTexturePropsFromRecord(texture, "imageMap", materialDescriptor);
      if ("colorSpace" in texture) {
        texture.colorSpace = definition.color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      }
      loaded[slot] = texture;
    }));
    checkCurrent(assignment, options);
  } catch (error) {
    Object.values(loaded).forEach((texture) => texture?.dispose?.());
    throw error;
  }

  const descriptorBefore = {};
  const descriptorTypeBefore = materialDescriptor.type;
  const descriptorTransparentBefore = materialDescriptor.transparent;
  const descriptorRevision = options.sceneRevision;
  const targetBefore = [];
  for (const slot of Object.keys(loaded)) {
    const field = assignment.slotRecords?.[slot]?.descriptorField
      || MATERIAL_TEXTURE_SLOTS[slot].descriptorField;
    descriptorBefore[field] = materialDescriptor[field];
  }
  try {
    for (const target of targets) {
      const originalMaterial = target.material;
      const promoted = needsPhysicalMaterial(loaded, target.material)
        ? promoteToPhysical(target)
        : needsStandardMaterial(loaded, target.material)
          ? promoteToStandard(target)
          : null;
      const mapsBefore = {};
      const transparentBefore = target.material.transparent;
      for (const [slot, texture] of Object.entries(loaded)) {
        const runtimeField = MATERIAL_TEXTURE_SLOTS[slot].runtimeField;
        mapsBefore[runtimeField] = target.material[runtimeField];
        target.material[runtimeField] = texture.clone();
        trackDisposableResource(target.material[runtimeField]);
      }
      if (loaded.opacity) target.material.transparent = true;
      target.material.needsUpdate = true;
      targetBefore.push({ target, mapsBefore, transparentBefore, originalMaterial, promoted });
    }
    // The runtime descriptor is a deploy-time clone. Keep the authoritative scene document and
    // the visible runtime descriptor in lockstep, but only after every texture has preloaded.
    checkCurrent(assignment, options);
    for (const [slot, authoritativeUrl] of Object.entries(assignment.maps || {})) {
      const definition = MATERIAL_TEXTURE_SLOTS[slot];
      const field = assignment.slotRecords?.[slot]?.descriptorField || definition?.descriptorField;
      if (field && loaded[slot]) materialDescriptor[field] = authoritativeUrl;
    }
    if (Object.keys(loaded).some((slot) => PHYSICAL_MATERIAL_SLOTS.has(slot))) {
      materialDescriptor.type = "physical";
    } else if (Object.keys(loaded).some((slot) => STANDARD_MATERIAL_SLOTS.has(slot))
      && materialDescriptor.type !== "standard" && materialDescriptor.type !== "physical") {
      materialDescriptor.type = "standard";
    }
    if (loaded.opacity) materialDescriptor.transparent = true;
    if (typeof options.commitSceneAssignment === "function") {
      await options.commitSceneAssignment(assignment, { sceneRevision: descriptorRevision });
    }
    return { ok: true, assignment, materialDescriptor, object3D };
  } catch (error) {
    for (const [field, value] of Object.entries(descriptorBefore)) {
      if (value === undefined) delete materialDescriptor[field];
      else materialDescriptor[field] = value;
    }
    if (descriptorTypeBefore === undefined) delete materialDescriptor.type;
    else materialDescriptor.type = descriptorTypeBefore;
    if (descriptorTransparentBefore === undefined) delete materialDescriptor.transparent;
    else materialDescriptor.transparent = descriptorTransparentBefore;
    for (const { target, mapsBefore, transparentBefore, originalMaterial, promoted } of targetBefore) {
      for (const [field, value] of Object.entries(mapsBefore)) {
        if (target.material[field] && target.material[field] !== value) target.material[field].dispose?.();
        target.material[field] = value;
      }
      target.material.transparent = transparentBefore;
      if (promoted) {
        replaceTargetMaterial(target, originalMaterial);
        promoted.dispose?.();
        continue;
      }
      target.material.needsUpdate = true;
    }
    Object.values(loaded).forEach((texture) => texture?.dispose?.());
    throw error;
  } finally {
    Object.values(loaded).forEach((texture) => texture?.dispose?.());
  }
}

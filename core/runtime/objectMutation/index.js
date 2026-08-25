import { applyObjectTransform } from "../../builder/heatmap/heatmapTexture.js";
import { getObjectByThreeJsonId } from "../../handler/objectRegistry.js";
import { markDescriptorBindingJsonDirty, redeployObject } from "../../handler/sceneDescriptorBinding.js";
import { applyVisibilityFromDescriptor } from "../../util/util.js";
import { applyTextureRepeatToMap, loadTextureFromMaterialJson } from "../../util/loadTextureFromMaterialJson.js";
import { resolveTextureSource } from "../../util/resolveTextureSource.js";
import { getDeployTextureContext, syncTexturePropsToMap } from "../../util/textureSampling.js";
import { getByPath, setByPath } from "../../util/jsonPointer.js";
import { classifyPath, getTopLevelKey, isRedeployTopLevelKey } from "./descriptorPaths.js";
import { applyMaterialDescriptorProperties } from "../../builder/material/materialFactory.js";

function isObjectRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function ensureDescriptor(object3D) {
  const userData = isObjectRecord(object3D?.userData) ? object3D.userData : {};
  object3D.userData = userData;
  const descriptor = isObjectRecord(userData.objJson) ? userData.objJson : {};
  userData.objJson = descriptor;
  return descriptor;
}

function resolveById(threeJsonId, runtimeScope = null) {
  const id = String(threeJsonId ?? "").trim();
  if (!id) {
    return { ok: false, error: "threeJsonId is required." };
  }
  // Multi-canvas hosts (ThreeBox keeps one live RuntimeContext per turn card, plus temporary
  // offscreen runtimes) routinely contain the same stable threeJsonId in several scenes. Always
  // honor the command/event caller's scene scope; falling back to the most recently attached
  // RuntimeContext can report success while mutating a different card.
  const object3D = getObjectByThreeJsonId(id, runtimeScope);
  if (!object3D) {
    return { ok: false, error: `Object not found for threeJsonId "${id}".` };
  }
  return { ok: true, object3D, descriptor: ensureDescriptor(object3D), id };
}

const SAMPLING_MATERIAL_PATCH_KEYS = new Set([
  "textureQuality",
  "textureSampling",
  "generateMipmaps",
  "minFilter",
  "magFilter",
  "anisotropy",
  "colorSpace",
  "textureAnisotropy"
]);

function materialPatchHasSamplingFields(materialPatch) {
  return Object.keys(materialPatch).some((key) => SAMPLING_MATERIAL_PATCH_KEYS.has(key));
}

function applySamplingPatchToMaterials(mats, materialPatch) {
  const ctx = getDeployTextureContext();
  for (let i = 0; i < mats.length; i += 1) {
    const mat = mats[i];
    if (mat?.map) {
      syncTexturePropsToMap(mat.map, materialPatch, "imageMap", ctx);
      mat.needsUpdate = true;
    }
  }
}

function getLoadedMapResolvedUrl(map) {
  if (!map) {
    return null;
  }
  const meta = map.userData?.threeJsonResolvedUrl;
  if (typeof meta === "string" && meta.trim()) {
    return meta.trim();
  }
  return null;
}

function materialsHaveLoadedUrl(mats, resolvedUrl) {
  if (!resolvedUrl || mats.length === 0) {
    return false;
  }
  return mats.every((mat) => {
    if (!mat?.map) {
      return false;
    }
    return getLoadedMapResolvedUrl(mat.map) === resolvedUrl;
  });
}

function assignLoadedTextureToMaterials(mats, texture) {
  for (let i = 0; i < mats.length; i += 1) {
    const mat = mats[i];
    if (!mat) {
      continue;
    }
    const oldMap = mat.map;
    mat.map = texture;
    mat.needsUpdate = true;
    if (oldMap && oldMap !== texture) {
      oldMap.dispose?.();
    }
  }
}

function createTextureReloadPending(mats, materialPatch, options) {
  const pending = Promise.resolve(loadTextureFromMaterialJson(materialPatch)).then((texture) => {
    if (!texture) {
      return null;
    }
    assignLoadedTextureToMaterials(mats, texture);
    return texture;
  });
  if (options.awaitTextures !== true) {
    pending.catch(() => {});
    return null;
  }
  return pending;
}

function applyMaterialPatch(mesh, materialPatch, options = {}) {
  if (!mesh || !mesh.isMesh || !mesh.material) {
    return { pending: null };
  }
  if (!isObjectRecord(materialPatch)) {
    return { pending: null };
  }
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (let i = 0; i < mats.length; i += 1) {
    const mat = mats[i];
    if (!mat) {
      continue;
    }
    applyMaterialDescriptorProperties(mat, materialPatch);
    if (Number.isFinite(materialPatch.opacity) && "opacity" in mat) {
      mat.opacity = materialPatch.opacity;
      if ("transparent" in mat) {
        mat.transparent =
          materialPatch.opacity < 1 || materialPatch.transparent === true;
      }
    }
    mat.needsUpdate = true;
  }
  if ("textureRepeat" in materialPatch) {
    for (let i = 0; i < mats.length; i += 1) {
      const mat = mats[i];
      if (mat?.map) {
        applyTextureRepeatToMap(mat.map, materialPatch);
        mat.needsUpdate = true;
      }
    }
  }
  if (materialPatchHasSamplingFields(materialPatch)) {
    applySamplingPatchToMaterials(mats, materialPatch);
  }
  let pending = null;
  if ("textureUrl" in materialPatch) {
    const textureUrl = typeof materialPatch.textureUrl === "string" ? materialPatch.textureUrl.trim() : "";
    if (!textureUrl) {
      for (let i = 0; i < mats.length; i += 1) {
        const mat = mats[i];
        if (!mat?.map) {
          continue;
        }
        mat.map.dispose?.();
        mat.map = null;
        mat.needsUpdate = true;
      }
    } else {
      const resolvedUrl = resolveTextureSource(materialPatch);
      const allHaveMap = mats.length > 0 && mats.every((mat) => Boolean(mat?.map));
      const canReuseMaps = allHaveMap && materialsHaveLoadedUrl(mats, resolvedUrl);
      if (canReuseMaps) {
        for (let i = 0; i < mats.length; i += 1) {
          const mat = mats[i];
          if (mat?.map) {
            applyTextureRepeatToMap(mat.map, materialPatch);
            applySamplingPatchToMaterials([mat], materialPatch);
            mat.needsUpdate = true;
          }
        }
      } else {
        pending = createTextureReloadPending(mats, materialPatch, options);
      }
    }
  }
  return { pending };
}

function partialNeedsRedeploy(partial) {
  if (!isObjectRecord(partial)) return false;
  if (Object.keys(partial).some((key) => isRedeployTopLevelKey(key))) return true;
  return isObjectRecord(partial.material) && Object.prototype.hasOwnProperty.call(partial.material, "type");
}

function pathNeedsRedeploy(path) {
  const normalized = String(path ?? "").trim().replace(/^\//, "").replaceAll("/", ".");
  return normalized === "material.type";
}

function syncObjectFromDescriptor(object3D, descriptor, options = {}) {
  applyObjectTransform(object3D, descriptor);
  if (typeof descriptor.name === "string") {
    object3D.name = descriptor.name;
  }
  applyVisibilityFromDescriptor(object3D, descriptor);
  if (typeof descriptor.castShadow === "boolean") {
    object3D.castShadow = descriptor.castShadow;
  }
  if (typeof descriptor.receiveShadow === "boolean") {
    object3D.receiveShadow = descriptor.receiveShadow;
  }
  const materialsArr = Array.isArray(descriptor.materials) ? descriptor.materials : null;
  if (materialsArr?.length === 6) {
    return { pending: null, skipMaterialPatch: true };
  }
  const materialPatch = isObjectRecord(descriptor.material) ? descriptor.material : null;
  return applyMaterialPatch(object3D, materialPatch, options);
}

function mutationResult(base, extra = {}) {
  return {
    ok: base.ok,
    error: base.error || null,
    threeJsonId: base.id || "",
    object3D: base.object3D || null,
    descriptor: base.descriptor || null,
    needsRedeploy: false,
    ...extra
  };
}

function maybeMarkDirty(descriptor, options = {}) {
  if (options.markBindingDirty === false) return;
  markDescriptorBindingJsonDirty(descriptor);
}

function maybeAutoRedeploy(base, needsRedeploy, options = {}) {
  if (!needsRedeploy || !options.scene || options.autoRedeploy !== true) {
    return null;
  }
  return redeployObject(options.scene, base.descriptor);
}

function mergeDescriptorPartial(target, partial) {
  const keys = Object.keys(partial);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const value = partial[key];
    if (isObjectRecord(value) && isObjectRecord(target[key])) {
      mergeDescriptorPartial(target[key], value);
    } else {
      target[key] = value;
    }
  }
}

function applyObjectPartial(threeJsonId, partial, options = {}) {
  const base = resolveById(threeJsonId, options.runtimeScope || options.scene);
  if (!base.ok) {
    return mutationResult(base);
  }
  if (!isObjectRecord(partial)) {
    return mutationResult(base, { ok: false, error: "partial must be an object." });
  }
  const descriptor = base.descriptor;
  const keys = Object.keys(partial);
  mergeDescriptorPartial(descriptor, partial);
  maybeMarkDirty(descriptor, options);
  const needsRedeploy = keys.some((k) => isRedeployTopLevelKey(k)) || partialNeedsRedeploy(partial);
  const { pending } = syncObjectFromDescriptor(base.object3D, descriptor, {
    awaitTextures: false
  });
  if (pending) {
    pending.catch(() => {});
  }
  const redeployed = maybeAutoRedeploy(base, needsRedeploy, options);
  return mutationResult(base, { needsRedeploy, object3D: redeployed || base.object3D });
}

async function applyObjectPartialAsync(threeJsonId, partial, options = {}) {
  const base = resolveById(threeJsonId, options.runtimeScope || options.scene);
  if (!base.ok) {
    return mutationResult(base);
  }
  if (!isObjectRecord(partial)) {
    return mutationResult(base, { ok: false, error: "partial must be an object." });
  }
  const descriptor = base.descriptor;
  const keys = Object.keys(partial);
  mergeDescriptorPartial(descriptor, partial);
  maybeMarkDirty(descriptor, options);
  const needsRedeploy = keys.some((k) => isRedeployTopLevelKey(k)) || partialNeedsRedeploy(partial);
  const { pending } = syncObjectFromDescriptor(base.object3D, descriptor, {
    awaitTextures: true
  });
  if (pending) {
    await pending;
  }
  const redeployed = maybeAutoRedeploy(base, needsRedeploy, options);
  return mutationResult(base, { needsRedeploy, object3D: redeployed || base.object3D });
}

function applyObjectChange(threeJsonId, path, value, options = {}) {
  const base = resolveById(threeJsonId, options.runtimeScope || options.scene);
  if (!base.ok) {
    return mutationResult(base);
  }
  const normalizedPath = String(path ?? "").trim();
  if (!normalizedPath) {
    return mutationResult(base, { ok: false, error: "path is required." });
  }
  try {
    setByPath(base.descriptor, normalizedPath, value, {
      createMissing: options.createMissing === true
    });
  } catch (err) {
    return mutationResult(base, { ok: false, error: String(err?.message || err) });
  }
  maybeMarkDirty(base.descriptor, options);
  const kind = classifyPath(normalizedPath);
  const topLevelKey = getTopLevelKey(normalizedPath);
  const needsRedeploy = kind === "structural" || isRedeployTopLevelKey(topLevelKey) || pathNeedsRedeploy(normalizedPath);
  const { pending } = syncObjectFromDescriptor(base.object3D, base.descriptor, {
    awaitTextures: false
  });
  if (pending) {
    pending.catch(() => {});
  }
  const redeployed = maybeAutoRedeploy(base, needsRedeploy, options);
  return mutationResult(base, {
    needsRedeploy,
    object3D: redeployed || base.object3D,
    path: normalizedPath,
    kind
  });
}

async function applyObjectChangeAsync(threeJsonId, path, value, options = {}) {
  const base = resolveById(threeJsonId, options.runtimeScope || options.scene);
  if (!base.ok) {
    return mutationResult(base);
  }
  const normalizedPath = String(path ?? "").trim();
  if (!normalizedPath) {
    return mutationResult(base, { ok: false, error: "path is required." });
  }
  try {
    setByPath(base.descriptor, normalizedPath, value, {
      createMissing: options.createMissing === true
    });
  } catch (err) {
    return mutationResult(base, { ok: false, error: String(err?.message || err) });
  }
  maybeMarkDirty(base.descriptor, options);
  const kind = classifyPath(normalizedPath);
  const topLevelKey = getTopLevelKey(normalizedPath);
  const needsRedeploy = kind === "structural" || isRedeployTopLevelKey(topLevelKey) || pathNeedsRedeploy(normalizedPath);
  const { pending } = syncObjectFromDescriptor(base.object3D, base.descriptor, {
    awaitTextures: true
  });
  if (pending) {
    await pending;
  }
  const redeployed = maybeAutoRedeploy(base, needsRedeploy, options);
  return mutationResult(base, {
    needsRedeploy,
    object3D: redeployed || base.object3D,
    path: normalizedPath,
    kind
  });
}

function captureObjectSnapshot(threeJsonId, options = {}) {
  const base = resolveById(threeJsonId, options.runtimeScope || options.scene);
  if (!base.ok) {
    return null;
  }
  return cloneJson(base.descriptor);
}

function applyObjectSnapshot(threeJsonId, snapshot, options = {}) {
  const base = resolveById(threeJsonId, options.runtimeScope || options.scene);
  if (!base.ok) {
    return mutationResult(base);
  }
  if (!isObjectRecord(snapshot)) {
    return mutationResult(base, { ok: false, error: "snapshot must be an object." });
  }
  base.object3D.userData.objJson = cloneJson(snapshot);
  base.descriptor = ensureDescriptor(base.object3D);
  maybeMarkDirty(base.descriptor, options);
  const needsRedeploy =
    Object.keys(snapshot).some((k) => isRedeployTopLevelKey(k)) ||
    (Array.isArray(snapshot.materials) && snapshot.materials.length === 6);
  const { pending } = syncObjectFromDescriptor(base.object3D, base.descriptor, {
    awaitTextures: false
  });
  if (pending) {
    pending.catch(() => {});
  }
  const redeployed = maybeAutoRedeploy(base, needsRedeploy, options);
  return mutationResult(base, { needsRedeploy, object3D: redeployed || base.object3D });
}

async function applyObjectSnapshotAsync(threeJsonId, snapshot, options = {}) {
  const base = resolveById(threeJsonId, options.runtimeScope || options.scene);
  if (!base.ok) {
    return mutationResult(base);
  }
  if (!isObjectRecord(snapshot)) {
    return mutationResult(base, { ok: false, error: "snapshot must be an object." });
  }
  base.object3D.userData.objJson = cloneJson(snapshot);
  base.descriptor = ensureDescriptor(base.object3D);
  maybeMarkDirty(base.descriptor, options);
  const needsRedeploy =
    Object.keys(snapshot).some((k) => isRedeployTopLevelKey(k)) ||
    (Array.isArray(snapshot.materials) && snapshot.materials.length === 6);
  const { pending } = syncObjectFromDescriptor(base.object3D, base.descriptor, {
    awaitTextures: true
  });
  if (pending) {
    await pending;
  }
  const redeployed = maybeAutoRedeploy(base, needsRedeploy, options);
  return mutationResult(base, { needsRedeploy, object3D: redeployed || base.object3D });
}

function getObjectField(threeJsonId, path, options = {}) {
  const base = resolveById(threeJsonId, options.runtimeScope || options.scene);
  if (!base.ok) {
    return undefined;
  }
  return getByPath(base.descriptor, path);
}

export {
  syncObjectFromDescriptor,
  applyObjectChange,
  applyObjectChangeAsync,
  applyObjectPartial,
  applyObjectPartialAsync,
  captureObjectSnapshot,
  applyObjectSnapshot,
  applyObjectSnapshotAsync,
  getObjectField
};

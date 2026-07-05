import * as THREE from "three";
import { applyTextureRepeatToMap, loadTextureFromMaterialJson } from "../../../../core/util/loadTextureFromMaterialJson.js";
import { getDeployTextureContext, syncTexturePropsToMap, configureTextureDefaultsForDeploy } from "../../../../core/util/textureSampling.js";
import { resolveTextureSource } from "../../../../core/util/resolveTextureSource.js";
import { resolveBoxDefaultTextureUrl } from "../../../../core/util/boxTextureUrl.js";
import {
  boxUsesIntentionalMaterialsArray,
  clamp01,
  toHexColorString,
  readMaterialFieldFromObjJson
} from "./sceneTreeMaterialHelpers.js";

function readTextureUrlFromObjJson(data) {
  if (!data || typeof data !== "object") {
    return "";
  }
  if (boxUsesIntentionalMaterialsArray(data)) {
    return resolveBoxDefaultTextureUrl(data) || "";
  }
  const fromMaterial = resolveTextureSource(data.material);
  if (fromMaterial) {
    return fromMaterial;
  }
  const arr = data.materials;
  if (Array.isArray(arr)) {
    for (let i = 0; i < arr.length; i += 1) {
      const u = resolveTextureSource(arr[i]);
      if (u) {
        return u;
      }
    }
  }
  return "";
}

function resolveMaterialJsonForMeshFace(descriptor, faceIndex, allFaces) {
  if (!descriptor || typeof descriptor !== "object") {
    return {};
  }
  if (allFaces && Array.isArray(descriptor.materials) && descriptor.materials[faceIndex]) {
    return descriptor.materials[faceIndex];
  }
  if (descriptor.material && typeof descriptor.material === "object") {
    return descriptor.material;
  }
  if (Array.isArray(descriptor.materials) && descriptor.materials[0]) {
    return descriptor.materials[0];
  }
  return descriptor;
}

function applyTextureRepeatToMeshMaterials(mesh, descriptor, options = {}) {
  if (!(mesh instanceof THREE.Mesh) || !mesh.material) {
    return false;
  }
  const data = descriptor && typeof descriptor === "object" ? descriptor : {};
  const allFaces = options.allFaces === true || boxUsesIntentionalMaterialsArray(data);
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const targets = allFaces ? mats : [mats[0]].filter(Boolean);
  let applied = false;
  for (let i = 0; i < targets.length; i += 1) {
    const mat = targets[i];
    if (!mat?.map) {
      continue;
    }
    const faceIndex = allFaces ? i : 0;
    const materialJson = resolveMaterialJsonForMeshFace(data, faceIndex, allFaces);
    applyTextureRepeatToMap(mat.map, materialJson);
    mat.needsUpdate = true;
    applied = true;
  }
  return applied;
}

function applyMaterialPropsToMeshMaterials(mesh, props = {}, options = {}) {
  if (!(mesh instanceof THREE.Mesh) || !mesh.material) {
    return false;
  }
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const targets = options.allFaces === true ? mats : [mats[0]].filter(Boolean);
  for (let mi = 0; mi < targets.length; mi += 1) {
    const mat = targets[mi];
    if (!mat) {
      continue;
    }
    if (props.color && mat.color?.set) {
      mat.color.set(props.color);
    }
    if (props.emissive && mat.emissive?.set) {
      mat.emissive.set(props.emissive);
    }
    if (Number.isFinite(props.emissiveIntensity) && "emissiveIntensity" in mat) {
      mat.emissiveIntensity = props.emissiveIntensity;
    }
    if (Number.isFinite(props.opacity) && "opacity" in mat) {
      mat.opacity = props.opacity;
      if ("transparent" in mat) {
        mat.transparent = props.opacity < 1 || props.transparent === true;
      }
    }
    if (Number.isFinite(props.metalness) && "metalness" in mat) {
      mat.metalness = props.metalness;
    }
    if (Number.isFinite(props.roughness) && "roughness" in mat) {
      mat.roughness = props.roughness;
    }
    if (typeof props.wireframe === "boolean" && "wireframe" in mat) {
      mat.wireframe = props.wireframe;
    }
    if (typeof props.doubleSide === "boolean" && "side" in mat) {
      mat.side = props.doubleSide ? THREE.DoubleSide : THREE.FrontSide;
    }
    mat.needsUpdate = true;
  }
  return targets.length > 0;
}

function applySamplingToMeshMaterials(mesh, descriptor, options = {}) {
  if (!(mesh instanceof THREE.Mesh) || !mesh.material) {
    return false;
  }
  const data = descriptor && typeof descriptor === "object" ? descriptor : {};
  const allFaces = options.allFaces === true || boxUsesIntentionalMaterialsArray(data);
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const targets = allFaces ? mats : [mats[0]].filter(Boolean);
  const ctx = getDeployTextureContext();
  let applied = false;
  for (let i = 0; i < targets.length; i += 1) {
    const mat = targets[i];
    if (!mat?.map) {
      continue;
    }
    const faceIndex = allFaces ? i : 0;
    const materialJson = resolveMaterialJsonForMeshFace(data, faceIndex, allFaces);
    syncTexturePropsToMap(mat.map, materialJson, "imageMap", ctx);
    mat.needsUpdate = true;
    applied = true;
  }
  return applied;
}

function applyTextureUrlToMeshMaterials(mesh, urlRaw, options = {}) {
  if (!(mesh instanceof THREE.Mesh) || !mesh.material) {
    return false;
  }
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const applyAllFaces = options.allFaces === true;
  const targets = applyAllFaces ? mats : [mats[0]].filter(Boolean);
  const trimmed = String(urlRaw ?? "").trim();
  if (!trimmed) {
    for (let i = 0; i < targets.length; i += 1) {
      const mat = targets[i];
      if (mat?.map) {
        mat.map.dispose?.();
        mat.map = null;
      }
      if (mat) {
        mat.needsUpdate = true;
      }
    }
    return true;
  }
  const descriptor = options.descriptor || mesh?.userData?.objJson || {};
  const indices = applyAllFaces
    ? targets.map((_, idx) => idx)
    : [0];
  for (let i = 0; i < indices.length; i += 1) {
    const faceIndex = indices[i];
    const materialJson = {
      ...resolveMaterialJsonForMeshFace(descriptor, faceIndex, applyAllFaces),
      textureUrl: trimmed
    };
    const tex = loadTextureFromMaterialJson(materialJson);
    const liveMats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const mNow = liveMats[faceIndex];
    if (!mNow) {
      tex?.dispose?.();
      continue;
    }
    const oldMap = mNow.map;
    mNow.map = tex;
    mNow.needsUpdate = true;
    if (oldMap && oldMap !== tex) {
      oldMap.dispose?.();
    }
  }
  return true;
}

/** 属性 undo/redo 后同步 Mesh 视觉（不重建时）。 */
export function syncEditorMeshVisualFromObjJson(object3D, descriptor) {
  if (!object3D || !descriptor || typeof descriptor !== "object") {
    return;
  }
  if (typeof descriptor.castShadow === "boolean") {
    object3D.castShadow = descriptor.castShadow;
  }
  if (typeof descriptor.receiveShadow === "boolean") {
    object3D.receiveShadow = descriptor.receiveShadow;
  }
  if (!(object3D instanceof THREE.Mesh)) {
    return;
  }
  const allFaces = boxUsesIntentionalMaterialsArray(descriptor);
  applyTextureUrlToMeshMaterials(object3D, readTextureUrlFromObjJson(descriptor), {
    allFaces,
    descriptor
  });
  applyMaterialPropsToMeshMaterials(
    object3D,
    {
      color: toHexColorString(readMaterialFieldFromObjJson(descriptor, "color", "#ffffff"), "#ffffff"),
      emissive: toHexColorString(readMaterialFieldFromObjJson(descriptor, "emissive", "#000000"), "#000000"),
      emissiveIntensity: Number(readMaterialFieldFromObjJson(descriptor, "emissiveIntensity", 0)) || 0,
      opacity: clamp01(readMaterialFieldFromObjJson(descriptor, "opacity", 1), 1),
      metalness: clamp01(readMaterialFieldFromObjJson(descriptor, "metalness", 0), 0),
      roughness: clamp01(readMaterialFieldFromObjJson(descriptor, "roughness", 1), 1),
      wireframe: Boolean(readMaterialFieldFromObjJson(descriptor, "wireframe", false)),
      doubleSide: readMaterialFieldFromObjJson(descriptor, "side", "front") === "double"
    },
    { allFaces }
  );
  applyTextureRepeatToMeshMaterials(object3D, descriptor, { allFaces });
  applySamplingToMeshMaterials(object3D, descriptor, { allFaces });
}

/** 场景级 textureQuality / textureDefaults 变更后刷新 deploy 缓存与已加载贴图采样。 */
export function refreshDeployTextureContextFromPayload(scene, payload) {
  configureTextureDefaultsForDeploy(payload);
  if (!scene?.traverse) {
    return;
  }
  scene.traverse((obj) => {
    if (!obj.isMesh || !obj.material || !obj.userData?.objJson) {
      return;
    }
    const descriptor = obj.userData.objJson;
    applySamplingToMeshMaterials(obj, descriptor, {
      allFaces: boxUsesIntentionalMaterialsArray(descriptor)
    });
  });
}

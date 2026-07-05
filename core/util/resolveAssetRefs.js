/**
 * Expand geometryRef / materialRef (lib://) on a record into inline geometry/material blocks.
 * Defaults to clone; sharePolicy.shared takes effect at deploy via shared instance cache.
 */
import {
  resolveLibTokenToGeometryPreset,
  resolveLibTokenToMaterialPreset
} from "../cache/assetRegistry.js";
import { LIB_PREFIX } from "./resolveTextureSource.js";

/**
 * @param {string} ref
 * @returns {string|null}
 */
function parseLibRef(ref) {
  if (typeof ref !== "string") {
    return null;
  }
  const trimmed = ref.trim();
  if (!trimmed.toLowerCase().startsWith(LIB_PREFIX)) {
    return null;
  }
  const token = trimmed.slice(LIB_PREFIX.length).trim();
  return token || null;
}

/**
 * @param {object} base
 * @param {object|null|undefined} overrides
 * @returns {object}
 */
function mergePresetBlock(base, overrides) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    return { ...base };
  }
  const out = { ...base };
  for (const key of Object.keys(overrides)) {
    const value = overrides[key];
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      out[key] &&
      typeof out[key] === "object" &&
      !Array.isArray(out[key])
    ) {
      out[key] = { ...out[key], ...value };
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * @param {object|null|undefined} record
 * @returns {{ geometry: "clone"|"shared", material: "clone"|"shared" }}
 */
function resolveSharePolicy(record) {
  const policy = record?.sharePolicy;
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    return { geometry: "clone", material: "clone" };
  }
  return {
    geometry: policy.geometry === "shared" ? "shared" : "clone",
    material: policy.material === "shared" ? "shared" : "clone"
  };
}

/**
 * @param {object|null|undefined} record
 * @returns {object|null}
 */
export function resolveAssetRefsForRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return record ?? null;
  }

  const next = { ...record };
  const sharePolicy = resolveSharePolicy(record);

  const geometryToken = parseLibRef(record.geometryRef);
  if (geometryToken) {
    const preset = resolveLibTokenToGeometryPreset(geometryToken);
    if (preset?.geometry) {
      next.geometry = mergePresetBlock(preset.geometry, record.geometryOverrides);
      next.__resolvedGeometryRef = geometryToken;
      next.__sharePolicyGeometry = sharePolicy.geometry;
    }
  }

  const materialToken = parseLibRef(record.materialRef);
  if (materialToken) {
    const preset = resolveLibTokenToMaterialPreset(materialToken);
    if (preset?.material) {
      next.material = mergePresetBlock(preset.material, record.materialOverrides);
      next.__resolvedMaterialRef = materialToken;
      next.__sharePolicyMaterial = sharePolicy.material;
    }
  }

  if (Array.isArray(record.children)) {
    next.children = record.children.map((child) => resolveAssetRefsForRecord(child) ?? child);
  }

  return next;
}

export { parseLibRef, mergePresetBlock, resolveSharePolicy };

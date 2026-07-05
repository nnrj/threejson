/**
 * Scene deploy-time asset registry (texture + geometryPreset + materialPreset + shaderSource).
 * Cleared on resetScene deploy (plan B).
 */
import { LIB_PREFIX } from "../util/resolveTextureSource.js";
import { log } from "../util/logger.js";
import { clearTextureUrlCache } from "./textureUrlCache.js";

/** @type {Map<string, { url: string, assetKind: string, name?: string }>} */
const textureByThreeJsonId = new Map();

/** @type {Map<string, string>} texture name → threeJsonId */
const textureNameToId = new Map();

/** @type {Map<string, { geometry?: object, url?: string, assetKind: string, name?: string }>} */
const geometryPresetByThreeJsonId = new Map();

/** @type {Map<string, string>} geometry preset name → threeJsonId */
const geometryPresetNameToId = new Map();

/** @type {Map<string, { material?: object, assetKind: string, name?: string }>} */
const materialPresetByThreeJsonId = new Map();

/** @type {Map<string, string>} material preset name → threeJsonId */
const materialPresetNameToId = new Map();

/** @type {Map<string, import("three").BufferGeometry>} */
const sharedGeometryInstances = new Map();

/** @type {Map<string, import("three").Material>} */
const sharedMaterialInstances = new Map();

/** @type {Map<string, { source?: string, url?: string, assetKind: string, name?: string }>} */
const shaderSourceByThreeJsonId = new Map();

/** @type {Map<string, string>} shader source name → threeJsonId */
const shaderSourceNameToId = new Map();

/** @type {Map<string, { source?: string, url?: string, assetKind: string, name?: string }>} */
const eventScriptByThreeJsonId = new Map();

/** @type {Map<string, string>} event script name → threeJsonId */
const eventScriptNameToId = new Map();

function normalizeAssetKind(entry, fallback) {
  const kind = String(entry?.assetKind ?? entry?.resourceKind ?? fallback).trim().toLowerCase();
  return kind.replace(/_/g, "");
}

/**
 * @param {object|null|undefined} entry
 * @returns {boolean}
 */
function isTextureAssetEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return false;
  }
  const kind = normalizeAssetKind(entry, "texture");
  if (kind && kind !== "texture") {
    return false;
  }
  const url = entry.url ?? entry.textureUrl ?? entry.src;
  return typeof url === "string" && url.trim().length > 0;
}

/**
 * @param {object|null|undefined} entry
 * @returns {boolean}
 */
function isGeometryPresetEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return false;
  }
  const kind = normalizeAssetKind(entry, "");
  if (kind !== "geometrypreset") {
    return false;
  }
  if (entry.geometry && typeof entry.geometry === "object" && !Array.isArray(entry.geometry)) {
    return true;
  }
  const url = entry.url ?? entry.geometryUrl;
  return typeof url === "string" && url.trim().length > 0;
}

/**
 * @param {object|null|undefined} entry
 * @returns {boolean}
 */
function isMaterialPresetEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return false;
  }
  const kind = normalizeAssetKind(entry, "");
  if (kind !== "materialpreset") {
    return false;
  }
  return entry.material && typeof entry.material === "object" && !Array.isArray(entry.material);
}

/**
 * @param {object|null|undefined} entry
 * @returns {boolean}
 */
function isShaderSourceEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return false;
  }
  const kind = normalizeAssetKind(entry, "");
  if (kind !== "shadersource") {
    return false;
  }
  const source = entry.source ?? entry.code ?? entry.text ?? entry.value;
  if (typeof source === "string" && source.trim().length > 0) {
    return true;
  }
  const url = entry.url ?? entry.shaderUrl;
  return typeof url === "string" && url.trim().length > 0;
}

/**
 * @param {object|null|undefined} entry
 * @returns {boolean}
 */
function isEventScriptEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return false;
  }
  const kind = normalizeAssetKind(entry, "");
  if (kind !== "eventscript") {
    return false;
  }
  const source = entry.source ?? entry.code ?? entry.text ?? entry.value;
  if (typeof source === "string" && source.trim().length > 0) {
    return true;
  }
  const url = entry.url ?? entry.scriptUrl;
  return typeof url === "string" && url.trim().length > 0;
}

function registerNameAlias(nameToIdMap, name, id) {
  const alias = typeof name === "string" ? name.trim() : "";
  if (alias && !nameToIdMap.has(alias)) {
    nameToIdMap.set(alias, id);
  }
}

/**
 * @param {object[]|null|undefined} assetLibrary
 */
function registerAssetLibrary(assetLibrary) {
  if (!Array.isArray(assetLibrary)) {
    return;
  }
  for (let i = 0; i < assetLibrary.length; i += 1) {
    const entry = assetLibrary[i];
    const id = String(entry?.threeJsonId ?? entry?.id ?? "").trim();
    if (!id) {
      continue;
    }

    if (isTextureAssetEntry(entry)) {
      const url = String(entry.url ?? entry.textureUrl ?? entry.src).trim();
      textureByThreeJsonId.set(id, {
        url,
        assetKind: "texture",
        name: typeof entry.name === "string" ? entry.name.trim() : undefined
      });
      registerNameAlias(textureNameToId, entry.name, id);
      continue;
    }

    if (isGeometryPresetEntry(entry)) {
      const url = entry.url ?? entry.geometryUrl;
      geometryPresetByThreeJsonId.set(id, {
        geometry:
          entry.geometry && typeof entry.geometry === "object" && !Array.isArray(entry.geometry)
            ? { ...entry.geometry }
            : undefined,
        url: typeof url === "string" ? url.trim() : undefined,
        assetKind: "geometryPreset",
        name: typeof entry.name === "string" ? entry.name.trim() : undefined
      });
      registerNameAlias(geometryPresetNameToId, entry.name, id);
      continue;
    }

    if (isMaterialPresetEntry(entry)) {
      materialPresetByThreeJsonId.set(id, {
        material: { ...entry.material },
        assetKind: "materialPreset",
        name: typeof entry.name === "string" ? entry.name.trim() : undefined
      });
      registerNameAlias(materialPresetNameToId, entry.name, id);
      continue;
    }

    if (isShaderSourceEntry(entry)) {
      const source = entry.source ?? entry.code ?? entry.text ?? entry.value;
      const url = entry.url ?? entry.shaderUrl;
      shaderSourceByThreeJsonId.set(id, {
        source: typeof source === "string" ? source : undefined,
        url: typeof url === "string" ? url.trim() : undefined,
        assetKind: "shaderSource",
        name: typeof entry.name === "string" ? entry.name.trim() : undefined
      });
      registerNameAlias(shaderSourceNameToId, entry.name, id);
      continue;
    }

    if (isEventScriptEntry(entry)) {
      const source = entry.source ?? entry.code ?? entry.text ?? entry.value;
      const url = entry.url ?? entry.scriptUrl;
      eventScriptByThreeJsonId.set(id, {
        source: typeof source === "string" ? source : undefined,
        url: typeof url === "string" ? url.trim() : undefined,
        assetKind: "eventScript",
        name: typeof entry.name === "string" ? entry.name.trim() : undefined
      });
      registerNameAlias(eventScriptNameToId, entry.name, id);
    }
  }
}

/**
 * @param {string} token
 * @param {Map<string, object>} byId
 * @param {Map<string, string>} nameToId
 * @param {string} label
 * @returns {object|null}
 */
function resolveLibToken(byId, nameToId, token, label) {
  const t = String(token ?? "").trim();
  if (!t) {
    return null;
  }
  const byIdHit = byId.get(t);
  if (byIdHit) {
    return byIdHit;
  }
  const idFromName = nameToId.get(t);
  if (idFromName) {
    const hit = byId.get(idFromName);
    if (hit) {
      return hit;
    }
  }
  log.warn(`[assetRegistry] lib://${label} reference not found: "${t}"`);
  return null;
}

/**
 * @param {string} token Token after lib:// (threeJsonId or name)
 * @returns {string|null}
 */
function resolveLibTokenToUrl(token) {
  const hit = resolveLibToken(textureByThreeJsonId, textureNameToId, token, "texture");
  return hit?.url ?? null;
}

/**
 * @param {string} token
 * @returns {{ geometry?: object, url?: string, assetKind: string, name?: string }|null}
 */
function resolveLibTokenToGeometryPreset(token) {
  return resolveLibToken(geometryPresetByThreeJsonId, geometryPresetNameToId, token, "geometryPreset");
}

/**
 * @param {string} token
 * @returns {{ material?: object, assetKind: string, name?: string }|null}
 */
function resolveLibTokenToMaterialPreset(token) {
  return resolveLibToken(materialPresetByThreeJsonId, materialPresetNameToId, token, "materialPreset");
}

/**
 * @param {string} token
 * @returns {{ source?: string, url?: string, assetKind: string, name?: string }|null}
 */
function resolveLibTokenToShaderSource(token) {
  return resolveLibToken(shaderSourceByThreeJsonId, shaderSourceNameToId, token, "shaderSource");
}

/**
 * @param {string} token
 * @returns {{ source?: string, url?: string, assetKind: string, name?: string }|null}
 */
function resolveLibTokenToEventScript(token) {
  return resolveLibToken(eventScriptByThreeJsonId, eventScriptNameToId, token, "eventScript");
}

/**
 * @param {string} threeJsonId
 * @returns {string|null}
 */
function getAssetUrlById(threeJsonId) {
  const hit = textureByThreeJsonId.get(String(threeJsonId ?? "").trim());
  return hit?.url ?? null;
}

/**
 * @param {string} key
 * @param {import("three").BufferGeometry} geometry
 */
function cacheSharedGeometryInstance(key, geometry) {
  const id = String(key ?? "").trim();
  if (id && geometry) {
    sharedGeometryInstances.set(id, geometry);
  }
}

/**
 * @param {string} key
 * @returns {import("three").BufferGeometry|null}
 */
function getSharedGeometryInstance(key) {
  return sharedGeometryInstances.get(String(key ?? "").trim()) ?? null;
}

/**
 * @param {string} key
 * @param {import("three").Material} material
 */
function cacheSharedMaterialInstance(key, material) {
  const id = String(key ?? "").trim();
  if (id && material) {
    sharedMaterialInstances.set(id, material);
  }
}

/**
 * @param {string} key
 * @returns {import("three").Material|null}
 */
function getSharedMaterialInstance(key) {
  return sharedMaterialInstances.get(String(key ?? "").trim()) ?? null;
}

function clearAssetRegistry() {
  textureByThreeJsonId.clear();
  textureNameToId.clear();
  geometryPresetByThreeJsonId.clear();
  geometryPresetNameToId.clear();
  materialPresetByThreeJsonId.clear();
  materialPresetNameToId.clear();
  shaderSourceByThreeJsonId.clear();
  shaderSourceNameToId.clear();
  eventScriptByThreeJsonId.clear();
  eventScriptNameToId.clear();
  sharedGeometryInstances.clear();
  sharedMaterialInstances.clear();
  clearTextureUrlCache();
}

export {
  registerAssetLibrary,
  resolveLibTokenToUrl,
  resolveLibTokenToGeometryPreset,
  resolveLibTokenToMaterialPreset,
  resolveLibTokenToShaderSource,
  resolveLibTokenToEventScript,
  clearAssetRegistry,
  getAssetUrlById,
  cacheSharedGeometryInstance,
  getSharedGeometryInstance,
  cacheSharedMaterialInstance,
  getSharedMaterialInstance,
  LIB_PREFIX
};

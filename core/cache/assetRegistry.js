/**
 * Scene deploy-time asset registry (texture + geometryPreset + materialPreset + shaderSource).
 * Cleared on resetScene deploy (plan B).
 *
 * State lives inside `createAssetRegistryStore()` instances, one per RuntimeContext
 * (see core/runtime/runtimeContext.js), so a second concurrently-mounted scene's
 * `lib://` asset library doesn't wipe out the first scene's. Named exports are thin
 * wrappers taking an optional trailing `runtimeScope`; omitting it preserves today's
 * shared-global behavior.
 */
import { LIB_PREFIX } from "../util/resolveTextureSource.js";
import { log } from "../util/logger.js";
import { resolveRuntimeContext } from "../runtime/runtimeContext.js";

function normalizeAssetKind(entry, fallback) {
  const kind = String(entry?.assetKind ?? entry?.resourceKind ?? fallback).trim().toLowerCase();
  return kind.replace(/_/g, "");
}

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

export function createAssetRegistryStore() {
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

  function resolveLibTokenToUrl(token) {
    const hit = resolveLibToken(textureByThreeJsonId, textureNameToId, token, "texture");
    return hit?.url ?? null;
  }

  function resolveLibTokenToGeometryPreset(token) {
    return resolveLibToken(geometryPresetByThreeJsonId, geometryPresetNameToId, token, "geometryPreset");
  }

  function resolveLibTokenToMaterialPreset(token) {
    return resolveLibToken(materialPresetByThreeJsonId, materialPresetNameToId, token, "materialPreset");
  }

  function resolveLibTokenToShaderSource(token) {
    return resolveLibToken(shaderSourceByThreeJsonId, shaderSourceNameToId, token, "shaderSource");
  }

  function resolveLibTokenToEventScript(token) {
    return resolveLibToken(eventScriptByThreeJsonId, eventScriptNameToId, token, "eventScript");
  }

  function getAssetUrlById(threeJsonId) {
    const hit = textureByThreeJsonId.get(String(threeJsonId ?? "").trim());
    return hit?.url ?? null;
  }

  function cacheSharedGeometryInstance(key, geometry) {
    const id = String(key ?? "").trim();
    if (id && geometry) {
      sharedGeometryInstances.set(id, geometry);
    }
  }

  function getSharedGeometryInstance(key) {
    return sharedGeometryInstances.get(String(key ?? "").trim()) ?? null;
  }

  function cacheSharedMaterialInstance(key, material) {
    const id = String(key ?? "").trim();
    if (id && material) {
      sharedMaterialInstances.set(id, material);
    }
  }

  function getSharedMaterialInstance(key) {
    return sharedMaterialInstances.get(String(key ?? "").trim()) ?? null;
  }

  function clear() {
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
  }

  return {
    registerAssetLibrary,
    resolveLibTokenToUrl,
    resolveLibTokenToGeometryPreset,
    resolveLibTokenToMaterialPreset,
    resolveLibTokenToShaderSource,
    resolveLibTokenToEventScript,
    getAssetUrlById,
    cacheSharedGeometryInstance,
    getSharedGeometryInstance,
    cacheSharedMaterialInstance,
    getSharedMaterialInstance,
    clear,
    dispose: clear
  };
}

function resolveStore(runtimeScope) {
  return resolveRuntimeContext(runtimeScope).assetRegistry;
}

export function registerAssetLibrary(assetLibrary, runtimeScope) {
  return resolveStore(runtimeScope).registerAssetLibrary(assetLibrary);
}

export function resolveLibTokenToUrl(token, runtimeScope) {
  return resolveStore(runtimeScope).resolveLibTokenToUrl(token);
}

export function resolveLibTokenToGeometryPreset(token, runtimeScope) {
  return resolveStore(runtimeScope).resolveLibTokenToGeometryPreset(token);
}

export function resolveLibTokenToMaterialPreset(token, runtimeScope) {
  return resolveStore(runtimeScope).resolveLibTokenToMaterialPreset(token);
}

export function resolveLibTokenToShaderSource(token, runtimeScope) {
  return resolveStore(runtimeScope).resolveLibTokenToShaderSource(token);
}

export function resolveLibTokenToEventScript(token, runtimeScope) {
  return resolveStore(runtimeScope).resolveLibTokenToEventScript(token);
}

/**
 * Also clears the paired textureUrlCache store for the same scope (see textureUrlCache.js).
 * @param {*} [runtimeScope]
 */
export function clearAssetRegistry(runtimeScope) {
  const ctx = resolveRuntimeContext(runtimeScope);
  ctx.assetRegistry.clear();
  ctx.textureUrlCache.clear();
}

export function getAssetUrlById(threeJsonId, runtimeScope) {
  return resolveStore(runtimeScope).getAssetUrlById(threeJsonId);
}

export function cacheSharedGeometryInstance(key, geometry, runtimeScope) {
  return resolveStore(runtimeScope).cacheSharedGeometryInstance(key, geometry);
}

export function getSharedGeometryInstance(key, runtimeScope) {
  return resolveStore(runtimeScope).getSharedGeometryInstance(key);
}

export function cacheSharedMaterialInstance(key, material, runtimeScope) {
  return resolveStore(runtimeScope).cacheSharedMaterialInstance(key, material);
}

export function getSharedMaterialInstance(key, runtimeScope) {
  return resolveStore(runtimeScope).getSharedMaterialInstance(key);
}

export { LIB_PREFIX };

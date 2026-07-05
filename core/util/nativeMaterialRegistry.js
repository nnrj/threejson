import { log } from "./logger.js";
/**
 * jsm addon material class registry (Three r184 has no ObjectLoader.registerMaterial; for direct-build paths).
 */

/** @type {Record<string, () => Promise<object>>} */
const NATIVE_MATERIAL_MODULES = {
  LineMaterial: () => import("three/examples/jsm/lines/LineMaterial.js")
};

/** @type {Set<string>} */
const loadedMaterialTypes = new Set();

/** @type {Map<string, import("three").Material.constructor>} */
const materialClassByType = new Map();

/**
 * @param {string} type
 * @returns {boolean}
 */
export function isJsmMaterialType(type) {
  const key = typeof type === "string" ? type.trim() : "";
  return Boolean(key && NATIVE_MATERIAL_MODULES[key]);
}

/**
 * @param {string} type
 * @returns {import("three").Material.constructor|null}
 */
export function getRegisteredMaterialClass(type) {
  const key = typeof type === "string" ? type.trim() : "";
  return materialClassByType.get(key) ?? null;
}

/**
 * @param {string[]} names
 * @returns {Promise<{ loaded: string[], failed: string[] }>}
 */
export async function ensureNativeMaterialsLoaded(names = []) {
  const loaded = [];
  const failed = [];
  const unique = [...new Set(
    (Array.isArray(names) ? names : [])
      .map((n) => (typeof n === "string" ? n.trim() : ""))
      .filter(Boolean)
  )];

  for (let i = 0; i < unique.length; i += 1) {
    const name = unique[i];
    if (loadedMaterialTypes.has(name)) {
      loaded.push(name);
      continue;
    }
    const importer = NATIVE_MATERIAL_MODULES[name];
    if (!importer) {
      log.warn(`[nativeMaterialRegistry] Unknown jsm material type, skipped: "${name}"`);
      failed.push(name);
      continue;
    }
    try {
      const mod = await importer();
      const Cls = mod[name] ?? mod.default;
      if (!Cls) {
        throw new Error(`Module does not export ${name}`);
      }
      materialClassByType.set(name, Cls);
      loadedMaterialTypes.add(name);
      loaded.push(name);
    } catch (error) {
      log.warn(`[nativeMaterialRegistry] Load failed, skipped: "${name}"`, error);
      failed.push(name);
    }
  }

  return { loaded, failed };
}

/**
 * @param {object|null|undefined} record
 * @returns {string[]}
 */
function collectMaterialTypesFromRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return [];
  }
  const types = [];
  const matType =
    typeof record.material?.type === "string" ? record.material.type.trim() : "";
  if (matType && isJsmMaterialType(matType)) {
    types.push(matType);
  }
  const threeType = typeof record.threeType === "string" ? record.threeType.trim() : "";
  if (threeType === "Line2" || threeType === "LineSegments2") {
    types.push("LineMaterial");
  }
  const children = Array.isArray(record.children) ? record.children : [];
  for (let i = 0; i < children.length; i += 1) {
    types.push(...collectMaterialTypesFromRecord(children[i]));
  }
  return types;
}

/**
 * @param {object|null|undefined} normalized
 * @returns {string[]}
 */
export function collectRequiredNativeMaterials(normalized = {}) {
  const required = new Set();
  const extensions = normalized?.sceneConfig?.extensions ?? normalized?.extensions ?? {};
  const configured = Array.isArray(extensions.nativeMaterials) ? extensions.nativeMaterials : [];
  for (let i = 0; i < configured.length; i += 1) {
    const name = typeof configured[i] === "string" ? configured[i].trim() : "";
    if (name) {
      required.add(name);
    }
  }

  const lib =
    normalized?.assetLibrary ??
    normalized?.worldInfo?.assetLibrary ??
    normalized?.payload?.assetLibrary ??
    normalized?.sourcePayload?.assetLibrary;
  if (Array.isArray(lib)) {
    for (let i = 0; i < lib.length; i += 1) {
      const entry = lib[i];
      const kind = String(entry?.assetKind ?? entry?.resourceKind ?? "").trim().toLowerCase();
      if (kind === "materialpreset" || kind === "material_preset") {
        const matType =
          typeof entry?.material?.type === "string" ? entry.material.type.trim() : "";
        if (matType && isJsmMaterialType(matType)) {
          required.add(matType);
        }
      }
    }
  }

  const objectList = Array.isArray(normalized?.objectList) ? normalized.objectList : [];
  for (let i = 0; i < objectList.length; i += 1) {
    for (const type of collectMaterialTypesFromRecord(objectList[i])) {
      required.add(type);
    }
  }

  return [...required];
}

export function clearNativeMaterialRegistry() {
  loadedMaterialTypes.clear();
  materialClassByType.clear();
}

export { NATIVE_MATERIAL_MODULES };

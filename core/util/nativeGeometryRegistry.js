/**
 * On-demand jsm/addon geometry registration with ObjectLoader; failures are isolated and do not block the scene.
 */
import { ObjectLoader } from "three";
import { log } from "./logger.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { applyLegacyGeometryObjTypeAlias } from "../handler/legacyGeometryAlias.js";

/** @type {Record<string, () => Promise<object>>} */
const NATIVE_GEOMETRY_MODULES = {
  RoundedBoxGeometry: async () => ({ RoundedBoxGeometry }),
  LineGeometry: () => import("three/examples/jsm/lines/LineGeometry.js"),
  TextGeometry: () => import("three/examples/jsm/geometries/TextGeometry.js")
};

/** @type {Set<string>} */
const registeredGeometryTypes = new Set(["RoundedBoxGeometry"]);

/** @type {Map<string, import("three").BufferGeometry.constructor>} */
const geometryClassByType = new Map([["RoundedBoxGeometry", RoundedBoxGeometry]]);

ObjectLoader.registerGeometry("RoundedBoxGeometry", RoundedBoxGeometry);

/**
 * @param {string} type
 * @returns {boolean}
 */
export function isJsmGeometryType(type) {
  const key = typeof type === "string" ? type.trim() : "";
  return Boolean(key && NATIVE_GEOMETRY_MODULES[key]);
}

/**
 * @param {string} type
 * @returns {import("three").BufferGeometry.constructor|null}
 */
export function getRegisteredGeometryClass(type) {
  const key = typeof type === "string" ? type.trim() : "";
  return geometryClassByType.get(key) ?? null;
}

/**
 * @param {string[]} names
 * @returns {Promise<{ registered: string[], failed: string[] }>}
 */
export async function ensureNativeGeometriesRegistered(names = []) {
  const registered = [];
  const failed = [];
  const unique = [...new Set(
    (Array.isArray(names) ? names : [])
      .map((n) => (typeof n === "string" ? n.trim() : ""))
      .filter(Boolean)
  )];

  for (let i = 0; i < unique.length; i += 1) {
    const name = unique[i];
    if (registeredGeometryTypes.has(name)) {
      registered.push(name);
      continue;
    }
    const importer = NATIVE_GEOMETRY_MODULES[name];
    if (!importer) {
      log.warn(`[nativeGeometryRegistry] Unknown jsm geometry type, skipped register: "${name}"`);
      failed.push(name);
      continue;
    }
    try {
      const mod = await importer();
      const Cls = mod[name] ?? mod.default;
      if (!Cls) {
        throw new Error(`Module does not export ${name}`);
      }
      ObjectLoader.registerGeometry(name, Cls);
      geometryClassByType.set(name, Cls);
      registeredGeometryTypes.add(name);
      registered.push(name);
    } catch (error) {
      log.warn(`[nativeGeometryRegistry] Register failed, skipped: "${name}"`, error);
      failed.push(name);
    }
  }

  return { registered, failed };
}

/**
 * @param {object|null|undefined} record
 * @returns {string[]}
 */
function collectGeometryTypesFromRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return [];
  }
  const normalized = applyLegacyGeometryObjTypeAlias(record) ?? record;
  const types = [];
  const geoType =
    typeof normalized.geometry?.type === "string" ? normalized.geometry.type.trim() : "";
  if (geoType && isJsmGeometryType(geoType)) {
    types.push(geoType);
  }
  if (typeof normalized.fallback === "string" && normalized.fallback.trim()) {
    const fb = normalized.fallback.trim();
    if (isJsmGeometryType(fb)) {
      types.push(fb);
    }
  }
  const children = Array.isArray(normalized.children) ? normalized.children : [];
  for (let i = 0; i < children.length; i += 1) {
    types.push(...collectGeometryTypesFromRecord(children[i]));
  }
  return types;
}

/**
 * @param {object|null|undefined} normalized
 * @returns {string[]}
 */
export function collectRequiredNativeGeometries(normalized = {}) {
  const required = new Set();
  const extensions = normalized?.sceneConfig?.extensions ?? normalized?.extensions ?? {};
  const configured = Array.isArray(extensions.nativeGeometries) ? extensions.nativeGeometries : [];
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
      if (kind === "geometrypreset" || kind === "geometry_preset") {
        const geoType =
          typeof entry?.geometry?.type === "string" ? entry.geometry.type.trim() : "";
        if (geoType && isJsmGeometryType(geoType)) {
          required.add(geoType);
        }
      }
    }
  }

  const objectList = Array.isArray(normalized?.objectList) ? normalized.objectList : [];
  for (let i = 0; i < objectList.length; i += 1) {
    for (const type of collectGeometryTypesFromRecord(objectList[i])) {
      required.add(type);
    }
  }

  return [...required];
}

export function clearNativeGeometryRegistry() {
  registeredGeometryTypes.clear();
  geometryClassByType.clear();
  ObjectLoader.registerGeometry("RoundedBoxGeometry", RoundedBoxGeometry);
  registeredGeometryTypes.add("RoundedBoxGeometry");
  geometryClassByType.set("RoundedBoxGeometry", RoundedBoxGeometry);
}

export { NATIVE_GEOMETRY_MODULES };

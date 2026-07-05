import { createMesh } from "../../core/builder/modelBuilder.js";
import { log } from "../../core/util/logger.js";

/** @type {Record<string, { color: string, opacity: number, transparent: boolean, metalness?: number, roughness?: number }>} */
const GLASS_KIND_PRESETS = {
  clear: {
    color: "#98c8ff",
    opacity: 0.35,
    transparent: true,
    metalness: 0.05,
    roughness: 0.12
  },
  tinted: {
    color: "#5a9fd4",
    opacity: 0.45,
    transparent: true,
    metalness: 0.06,
    roughness: 0.18
  },
  frosted: {
    color: "#e8eef5",
    opacity: 0.55,
    transparent: true,
    metalness: 0.02,
    roughness: 0.82
  }
};

function normalizeGlassObjType(record) {
  const raw = typeof record?.objType === "string" ? record.objType.trim().toLowerCase() : "";
  return raw === "glass";
}

function applyGlassKindMaterial(baseMaterial, record) {
  const material = { ...baseMaterial };
  const kind = typeof record?.glassKind === "string" ? record.glassKind.trim() : "";
  if (kind && GLASS_KIND_PRESETS[kind]) {
    Object.assign(material, GLASS_KIND_PRESETS[kind]);
  } else if (kind) {
    log.warn("[glass] unknown glassKind, using defaults:", kind);
  }
  material.type = "standard";
  return material;
}

function defaultGlassDescriptor() {
  return {
    name: "room-glass",
    label: `new-glass-${Date.now()}`,
    objType: "box",
    boxType: "box",
    businessInfo: {},
    geometry: { width: 200, height: 120, depth: 10 },
    material: {
      type: "standard",
      color: "#98c8ff",
      opacity: 0.35,
      transparent: true,
      metalness: 0.05,
      roughness: 0.12
    },
    position: { x: 0, y: 100, z: 0 },
    rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
    scale: { scaleX: 1, scaleY: 1, scaleZ: 1 }
  };
}

/**
 * @param {object} overrides
 * @returns {object}
 */
function createGlassJson(overrides) {
  const base = defaultGlassDescriptor();
  if (overrides == null || overrides === "") {
    return base;
  }
  let merged = base;
  if (typeof overrides === "string") {
    try {
      const parsed = JSON.parse(overrides);
      if (parsed && typeof parsed === "object") {
        merged = { ...base, ...parsed };
      }
    } catch {
      log.warn("[glass] createGlassJson: JSON parse failed, using default descriptor");
    }
  } else {
    merged = { ...base, ...overrides };
  }
  merged.objType = "box";
  merged.boxType = merged.boxType || "box";
  merged.businessInfo = {
    ...(merged.businessInfo && typeof merged.businessInfo === "object" ? merged.businessInfo : {})
  };
  merged.material = applyGlassKindMaterial(
    { ...base.material, ...(merged.material && typeof merged.material === "object" ? merged.material : {}) },
    merged
  );
  return merged;
}

/**
 * @param {string|object|undefined|null} [overrides]
 * @returns {import("three").Mesh|import("three").InstancedMesh|undefined}
 */
function createGlass(overrides) {
  return createMesh(createGlassJson(overrides));
}

function deployGlass(overrides, scene) {
  if (!scene) {
    return;
  }
  const mesh = createGlass(overrides);
  if (mesh) {
    scene.add(mesh);
  }
}

function mergeRecordIntoGlass(record, scene) {
  if (record.payload != null && typeof record.payload === "object") {
    deployGlass(record.payload, scene);
    return;
  }
  if (Array.isArray(record.items) && record.items[0]) {
    deployGlass(record.items[0], scene);
    return;
  }
  const skip = new Set(["domain", "handler", "items", "options", "payload"]);
  const rest = {};
  for (const k of Object.keys(record)) {
    if (!skip.has(k)) {
      rest[k] = record[k];
    }
  }
  deployGlass({ ...rest, glassKind: record.glassKind }, scene);
}

function resolveGlassDomainModel(record, scene) {
  const handler = record.handler ?? "addToScene";
  if (handler === "addToScene") {
    mergeRecordIntoGlass(record, scene);
    return;
  }
  log.warn("[glass] domainModel handler not implemented:", handler);
}

function addToScene(scene, overrides = {}) {
  deployGlass(overrides, scene);
}

/**
 * @param {object} boxModel
 * @returns {import("three").Object3D|null}
 */
function composeBoxModel(boxModel) {
  if (!normalizeGlassObjType(boxModel)) {
    return null;
  }
  return createGlass(boxModel) ?? null;
}

const glassDomain = {
  id: "glass",
  defaultHandler: "addToScene",
  legacyBoxObjTypes: {
    glass: "addToScene"
  },
  composeBoxModel,
  resolveDomainModel: resolveGlassDomainModel,
  api: {
    createGlassJson,
    createGlass,
    deployGlass,
    addToScene
  }
};

export default glassDomain;

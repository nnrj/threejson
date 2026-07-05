import { createMesh } from "../../core/builder/modelBuilder.js";
import { log } from "../../core/util/logger.js";

function normalizeFloorObjType(record) {
  const raw = typeof record?.objType === "string" ? record.objType.trim().toLowerCase() : "";
  return raw === "floor";
}

function defaultFloorDescriptor() {
  return {
    name: "room-floor",
    label: `new-floor-${Date.now()}`,
    objType: "box",
    boxType: "box",
    businessInfo: {},
    geometry: { width: 10, height: 0.2, depth: 10 },
    material: {
      type: "standard",
      color: "#cccccc",
      opacity: 1,
      transparent: false,
      metalness: 0.05,
      roughness: 0.85
    },
    position: { x: 0, y: 0, z: 0 },
    rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
    scale: { scaleX: 1, scaleY: 1, scaleZ: 1 }
  };
}

/**
 * @param {object} overrides
 * @returns {object}
 */
function createFloorJson(overrides) {
  const base = defaultFloorDescriptor();
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
      log.warn("[floor] createFloorJson: JSON parse failed, using default descriptor");
    }
  } else {
    merged = { ...base, ...overrides };
  }
  merged.objType = "box";
  merged.boxType = merged.boxType || "box";
  merged.businessInfo = {
    ...(merged.businessInfo && typeof merged.businessInfo === "object" ? merged.businessInfo : {})
  };
  if (merged.material && typeof merged.material === "object") {
    merged.material = { ...merged.material, type: "standard" };
  } else {
    merged.material = { ...base.material };
  }
  return merged;
}

/**
 * @param {string|object|undefined|null} [overrides]
 * @returns {import("three").Mesh|import("three").InstancedMesh|undefined}
 */
function createFloor(overrides) {
  return createMesh(createFloorJson(overrides));
}

function deployFloor(overrides, scene) {
  if (!scene) {
    return;
  }
  const mesh = createFloor(overrides);
  if (mesh) {
    scene.add(mesh);
  }
}

function mergeRecordIntoFloor(record, scene) {
  const base = defaultFloorDescriptor();
  if (record.payload != null && typeof record.payload === "object") {
    deployFloor({ ...record.payload, name: record.payload.name || base.name }, scene);
    return;
  }
  if (Array.isArray(record.items) && record.items[0]) {
    deployFloor({ ...record.items[0], name: record.items[0].name || base.name }, scene);
    return;
  }
  const skip = new Set(["domain", "handler", "items", "options", "payload"]);
  const rest = {};
  for (const k of Object.keys(record)) {
    if (!skip.has(k)) {
      rest[k] = record[k];
    }
  }
  deployFloor(Object.keys(rest).length ? { ...base, ...rest } : base, scene);
}

function resolveFloorDomainModel(record, scene) {
  const handler = record.handler ?? "addToScene";
  if (handler === "addToScene") {
    mergeRecordIntoFloor(record, scene);
    return;
  }
  log.warn("[floor] domainModel handler not implemented:", handler);
}

function addToScene(scene, overrides = {}) {
  deployFloor(overrides, scene);
}

/**
 * @param {object} boxModel
 * @returns {import("three").Object3D|null}
 */
function composeBoxModel(boxModel) {
  if (!normalizeFloorObjType(boxModel)) {
    return null;
  }
  return createFloor(boxModel) ?? null;
}

const floorDomain = {
  id: "floor",
  defaultHandler: "addToScene",
  legacyBoxObjTypes: {
    floor: "addToScene"
  },
  composeBoxModel,
  resolveDomainModel: resolveFloorDomainModel,
  api: {
    createFloorJson,
    createFloor,
    deployFloor,
    addToScene
  }
};

export default floorDomain;

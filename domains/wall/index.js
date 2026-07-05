import { createMesh } from "../../core/builder/modelBuilder.js";
import { log } from "../../core/util/logger.js";

function normalizeWallObjType(record) {
  const raw = typeof record?.objType === "string" ? record.objType.trim().toLowerCase() : "";
  return raw === "wall";
}

function defaultWallDescriptor() {
  return {
    name: "room-wall",
    label: `new-wall-${Date.now()}`,
    objType: "box",
    boxType: "box",
    businessInfo: {},
    geometry: { width: 260, height: 180, depth: 20 },
    material: {
      type: "standard",
      color: "#a6acaf",
      opacity: 1,
      transparent: false,
      metalness: 0,
      roughness: 0.88
    },
    position: { x: 0, y: 90, z: 0 },
    rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
    scale: { scaleX: 1, scaleY: 1, scaleZ: 1 }
  };
}

/**
 * @param {object} overrides
 * @returns {object}
 */
function createWallJson(overrides) {
  const base = defaultWallDescriptor();
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
      log.warn("[wall] createWallJson: JSON parse failed, using default descriptor");
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
function createWall(overrides) {
  return createMesh(createWallJson(overrides));
}

function deployWall(overrides, scene) {
  if (!scene) {
    return;
  }
  const mesh = createWall(overrides);
  if (mesh) {
    scene.add(mesh);
  }
}

function mergeRecordIntoWall(record, scene) {
  const base = defaultWallDescriptor();
  if (record.payload != null && typeof record.payload === "object") {
    deployWall({ ...record.payload, name: record.payload.name || base.name }, scene);
    return;
  }
  if (Array.isArray(record.items) && record.items[0]) {
    deployWall({ ...record.items[0], name: record.items[0].name || base.name }, scene);
    return;
  }
  const skip = new Set(["domain", "handler", "items", "options", "payload"]);
  const rest = {};
  for (const k of Object.keys(record)) {
    if (!skip.has(k)) {
      rest[k] = record[k];
    }
  }
  deployWall(Object.keys(rest).length ? { ...base, ...rest } : base, scene);
}

function resolveWallDomainModel(record, scene) {
  const handler = record.handler ?? "addToScene";
  if (handler === "addToScene") {
    mergeRecordIntoWall(record, scene);
    return;
  }
  log.warn("[wall] domainModel handler not implemented:", handler);
}

function addToScene(scene, overrides = {}) {
  deployWall(overrides, scene);
}

/**
 * @param {object} boxModel
 * @returns {import("three").Object3D|null}
 */
function composeBoxModel(boxModel) {
  if (!normalizeWallObjType(boxModel)) {
    return null;
  }
  return createWall(boxModel) ?? null;
}

const wallDomain = {
  id: "wall",
  defaultHandler: "addToScene",
  legacyBoxObjTypes: {
    wall: "addToScene"
  },
  composeBoxModel,
  resolveDomainModel: resolveWallDomainModel,
  api: {
    createWallJson,
    createWall,
    deployWall,
    addToScene
  }
};

export default wallDomain;

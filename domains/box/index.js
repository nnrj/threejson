import { createMesh } from "../../core/builder/modelBuilder.js";
import { log } from "../../core/util/logger.js";

function defaultBoxDescriptor() {
  return {
    name: `new-box-${Date.now()}`,
    objType: "box",
    boxType: "box",
    geometry: { width: 80, height: 80, depth: 80 },
    material: { type: "lambert", color: "#5dade2", opacity: 1, transparent: false },
    position: { x: 0, y: 40, z: 0 },
    rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
    scale: { scaleX: 1, scaleY: 1, scaleZ: 1 }
  };
}

/**
 * Merge default descriptor with user overrides → pure JSON aligned with {@link createMesh} / serialization.
 * @param {string|object|undefined|null} [overrides]
 * @returns {object}
 */
function createBoxJson(overrides) {
  const base = defaultBoxDescriptor();
  if (overrides == null || overrides === "") {
    return base;
  }
  if (typeof overrides === "string") {
    try {
      const parsed = JSON.parse(overrides);
      if (parsed && typeof parsed === "object") {
        return { ...base, ...parsed };
      }
    } catch {
      log.warn("[box] createBoxJson: JSON parse failed, using default descriptor");
    }
    return base;
  }
  return { ...base, ...overrides };
}

/**
 * @param {string|object|undefined|null} [overrides]
 * @returns {import("three").Mesh|import("three").InstancedMesh|undefined}
 */
function createBox(overrides) {
  return createMesh(createBoxJson(overrides));
}

/** @param {string|object|undefined|null} [overrides] @param {import("three").Scene} scene */
function deployBox(overrides, scene) {
  if (!scene) {
    return;
  }
  const mesh = createBox(overrides);
  if (mesh) {
    scene.add(mesh);
  }
}

/** @param {object} record @param {import("three").Scene} scene */
function mergeRecordIntoBox(record, scene) {
  const base = defaultBoxDescriptor();
  if (record.payload != null && typeof record.payload === "object") {
    deployBox({ ...base, ...record.payload, name: record.payload.name || base.name }, scene);
    return;
  }
  if (Array.isArray(record.items) && record.items[0]) {
    deployBox({ ...base, ...record.items[0], name: record.items[0].name || base.name }, scene);
    return;
  }
  const skip = new Set(["domain", "handler", "items", "options", "payload"]);
  const rest = {};
  for (const k of Object.keys(record)) {
    if (!skip.has(k)) {
      rest[k] = record[k];
    }
  }
  deployBox(Object.keys(rest).length ? { ...base, ...rest } : base, scene);
}

function resolveBoxDomainModel(record, scene) {
  const handler = record.handler ?? "addToScene";
  if (handler === "addToScene") {
    mergeRecordIntoBox(record, scene);
    return;
  }
  log.warn("[box] domainModel handler not implemented:", handler);
}

function addToScene(scene, overrides = {}) {
  deployBox(overrides, scene);
}

const boxDomain = {
  id: "box",
  defaultHandler: "addToScene",
  resolveDomainModel: resolveBoxDomainModel,
  api: {
    createBoxJson,
    createBox,
    deployBox,
    addToScene
  }
};

export default boxDomain;

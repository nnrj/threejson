import { reconcileTransformToDescriptor } from "../handler/descriptorSync.js";
import { getObjectByThreeJsonId, getObjectByUuid } from "../handler/objectRegistry.js";
import { getObjectsByObjType } from "../handler/objectObjType.js";
import { sanitizeObjectRecordForExport } from "./descriptorExportSanitize.js";

function cloneJson(value) {
  if (value === null || value === undefined) {
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    if (Array.isArray(value)) {
      return value.slice();
    }
    if (typeof value === "object") {
      return { ...value };
    }
    return value;
  }
}

function normalizeSelectorBy(by = "threeJsonId") {
  const key = typeof by === "string" ? by.trim() : "";
  if (key === "threeJsonId" || key === "uuid") {
    return key;
  }
  const error = new Error(`E_EXPORT_SELECTOR_INVALID: unsupported selector "${by}"`);
  error.code = "E_EXPORT_SELECTOR_INVALID";
  throw error;
}

function resolveTargetRoot(target) {
  if (target?.isScene === true || target?.isObject3D === true) {
    return target;
  }
  if (target?.scene?.isScene === true) {
    return target.scene;
  }
  const error = new Error("E_EXPORT_TARGET_INVALID: target must be THREE.Scene / THREE.Object3D / { scene }");
  error.code = "E_EXPORT_TARGET_INVALID";
  throw error;
}

function findBySelectorInTree(root, id, by) {
  if (!root?.traverse || !id) {
    return null;
  }
  let found = null;
  root.traverse((obj) => {
    if (found || !obj) {
      return;
    }
    if (by === "uuid" && obj.uuid === id) {
      found = obj;
      return;
    }
    const descriptor = obj.userData?.objJson;
    if (by === "threeJsonId" && descriptor?.threeJsonId === id) {
      found = obj;
    }
  });
  return found;
}

function resolveObjectById(target, id, by = "threeJsonId") {
  const selectorBy = normalizeSelectorBy(by);
  const root = resolveTargetRoot(target);
  const normalizedId = typeof id === "string" ? id.trim() : "";
  if (!normalizedId) {
    const error = new Error("E_EXPORT_SELECTOR_INVALID: id must be a non-empty string");
    error.code = "E_EXPORT_SELECTOR_INVALID";
    throw error;
  }
  let hit = selectorBy === "threeJsonId"
    ? getObjectByThreeJsonId(normalizedId)
    : getObjectByUuid(normalizedId);
  if (!hit || (root?.isObject3D && hit !== root && !root.getObjectByProperty("uuid", hit.uuid))) {
    hit = findBySelectorInTree(root, normalizedId, selectorBy);
  }
  return hit;
}

function resolveListNameByObjType(objType) {
  const t = typeof objType === "string" ? objType.trim().toLowerCase() : "";
  if (t === "sphere") {
    return "sphereModelList";
  }
  if (t === "group") {
    return "groupList";
  }
  if (t === "line" || t === "leakline") {
    return "lineList";
  }
  if (t === "infopanel") {
    return "infoPanelList";
  }
  if (t === "css3dpanel") {
    return "css3dPanelList";
  }
  if (t === "heatmap" || t === "heat" || t === "heatmap3d") {
    return "heatList";
  }
  if (t === "wind") {
    return "windList";
  }
  if (t === "shadersurface") {
    return "shaderSurfaceList";
  }
  if (t === "externalmodel" || t === "objmodel") {
    return "objModelList";
  }
  if (t === "domain") {
    return "domainModelList";
  }
  return "boxModelList";
}

function exportRecordFromObject3D(object3D, options = {}) {
  if (!object3D) {
    const error = new Error("E_EXPORT_OBJECT_NOT_FOUND: object is missing");
    error.code = "E_EXPORT_OBJECT_NOT_FOUND";
    throw error;
  }
  if (options.syncTransforms !== false) {
    reconcileTransformToDescriptor(object3D, { markBindingDirty: false });
  }
  const descriptor = object3D.userData?.objJson;
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
    const error = new Error("E_EXPORT_RECORD_INVALID: object does not have userData.objJson");
    error.code = "E_EXPORT_RECORD_INVALID";
    throw error;
  }
  const record = cloneJson(descriptor);
  if (!record?.objType || typeof record.objType !== "string") {
    const error = new Error("E_EXPORT_RECORD_INVALID: descriptor objType is missing");
    error.code = "E_EXPORT_RECORD_INVALID";
    throw error;
  }
  return sanitizeObjectRecordForExport(record);
}

function wrapRecordAsMinimalWorldInfo(record, options = {}) {
  const listName = resolveListNameByObjType(record?.objType);
  const out = {
    worldInfo: {
      [listName]: [cloneJson(record)]
    }
  };
  if (typeof options.threeJsonId === "string" && options.threeJsonId.trim()) {
    out.threeJsonId = options.threeJsonId.trim();
  }
  return out;
}

function collectObjectsByObjType(target, objTypeInput) {
  const root = resolveTargetRoot(target);
  const expected = Array.isArray(objTypeInput) ? objTypeInput : [objTypeInput];
  const out = [];
  const seen = new Set();
  for (let i = 0; i < expected.length; i++) {
    const type = String(expected[i] || "").trim();
    if (!type) {
      continue;
    }
    const hits = getObjectsByObjType(root, type, { root });
    for (let j = 0; j < hits.length; j++) {
      const obj = hits[j];
      if (obj && !seen.has(obj.uuid)) {
        seen.add(obj.uuid);
        out.push(obj);
      }
    }
  }
  return out;
}

export {
  collectObjectsByObjType,
  exportRecordFromObject3D,
  normalizeSelectorBy,
  resolveObjectById,
  resolveTargetRoot,
  wrapRecordAsMinimalWorldInfo
};

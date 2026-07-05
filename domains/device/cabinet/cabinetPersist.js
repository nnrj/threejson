import { cloneJson } from "../../../core/util/cloneJson.js";
import { getPersistSource } from "../../../core/handler/domainDeployDescriptor.js";
import { sanitizeObjectRecordForExport } from "../../../core/util/descriptorExportSanitize.js";
import {
  applyDescriptorTransformsFromFresh,
  descriptorListMergeKey
} from "../../../core/util/persistListMerge.js";

/**
 * @param {object|null|undefined} item
 * @returns {boolean}
 */
function isRichCabinetPersistItem(item) {
  if (!item || typeof item !== "object") {
    return false;
  }
  return Array.isArray(item.doors) && item.doors.length > 0;
}

/**
 * @param {object|null|undefined} item
 * @returns {string}
 */
export function cabinetPersistMergeKey(item) {
  if (!item || typeof item !== "object") {
    return "";
  }
  const cabLabel = item.cabLabel ?? item.businessInfo?.cabNum;
  if (cabLabel != null && String(cabLabel).trim() !== "") {
    return `cabLabel:${cabLabel}`;
  }
  return descriptorListMergeKey(item);
}

/**
 * @param {import("three").Object3D|null|undefined} object3D
 * @returns {object|null}
 */
function resolveCabinetInstanceSource(object3D) {
  const persistSource = getPersistSource(object3D);
  if (persistSource && String(persistSource.domain || "").trim() === "device.cabinet") {
    return persistSource;
  }
  const liveJson = object3D?.userData?.objJson;
  if (!liveJson || typeof liveJson !== "object" || Array.isArray(liveJson)) {
    return null;
  }
  const liveType = String(liveJson.objType || liveJson.type || "").trim();
  if (liveType === "domain" && String(liveJson.domain || "").trim() === "device.cabinet") {
    return liveJson;
  }
  if (liveType === "deviceCabinet") {
    return liveJson;
  }
  return null;
}

/**
 * @param {import("three").Object3D|null|undefined} object3D
 * @returns {object|null}
 */
export function capturePersistDescriptor(object3D) {
  const cabSource = resolveCabinetInstanceSource(object3D);
  if (!cabSource) {
    return null;
  }
  const modelData = cloneJson(cabSource);
  modelData.objType = "domain";
  modelData.domain = "device.cabinet";
  if (!String(modelData.handler || "").trim()) {
    modelData.handler = "deployCabinet";
  }
  if (object3D?.position) {
    modelData.position = {
      x: Number(object3D.position.x || 0),
      y: Number(object3D.position.y || 0),
      z: Number(object3D.position.z || 0)
    };
  }
  if (object3D?.rotation) {
    modelData.rotation = {
      rotationX: Number(object3D.rotation.x || 0),
      rotationY: Number(object3D.rotation.y || 0),
      rotationZ: Number(object3D.rotation.z || 0)
    };
  }
  if (object3D?.scale) {
    modelData.scale = {
      scaleX: Number(object3D.scale.x || 1),
      scaleY: Number(object3D.scale.y || 1),
      scaleZ: Number(object3D.scale.z || 1)
    };
  }
  return sanitizeObjectRecordForExport(modelData);
}

/**
 * @param {object} base
 * @param {object} fresh
 * @returns {object}
 */
export function mergePersistDescriptor(base, fresh) {
  if (!base || typeof base !== "object") {
    return fresh && typeof fresh === "object" ? fresh : {};
  }
  if (!fresh || typeof fresh !== "object") {
    return base;
  }
  if (isRichCabinetPersistItem(fresh)) {
    return fresh;
  }
  if (isRichCabinetPersistItem(base)) {
    return applyDescriptorTransformsFromFresh(base, fresh);
  }
  return fresh;
}

export { isRichCabinetPersistItem };

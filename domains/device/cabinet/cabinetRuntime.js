/**
 * device.cabinet runtime: addDevice / removeDevice.
 */
import { cloneJson } from "../../../core/util/cloneJson.js";
import { getPersistSource } from "../../../core/handler/domainDeployDescriptor.js";
import {
  ensureBusinessDeviceId,
  getUUsage,
  isUSlotRangeFree,
  mergeDevicePayload,
  readDeviceUSlot
} from "../deviceShared.js";
import { buildCabinetGroupJson } from "./cabinetFactory.js";

/**
 * @param {import("three").Scene} scene
 * @param {string|number} cabinetThreeJsonId
 * @returns {import("three").Object3D|null}
 */
export function findCabinetByThreeJsonId(scene, cabinetThreeJsonId) {
  if (!scene || cabinetThreeJsonId == null) {
    return null;
  }
  const want = String(cabinetThreeJsonId).trim();
  let found = null;
  scene.traverse((obj) => {
    if (found) {
      return;
    }
    const src = getPersistSource(obj) || obj.userData?.objJson;
    if (!src) {
      return;
    }
    const domain = String(src.domain || "").trim();
    const id = String(src.threeJsonId || "").trim();
    if (domain === "device.cabinet" && id === want) {
      found = obj;
    }
  });
  return found;
}

/**
 * @param {import("three").Object3D} cabinetRoot
 * @returns {object|null}
 */
export function readCabinetPersistRecord(cabinetRoot) {
  const src = getPersistSource(cabinetRoot);
  if (src && String(src.domain || "").trim() === "device.cabinet") {
    return cloneJson(src);
  }
  return null;
}

/**
 * @param {import("three").Scene} scene
 * @param {string|number} cabinetThreeJsonId
 * @param {object} deviceJson
 * @param {number} uStart
 * @param {object} [options]
 * @returns {boolean}
 */
export function addDevice(scene, cabinetThreeJsonId, deviceJson, uStart, options = {}) {
  const root = findCabinetByThreeJsonId(scene, cabinetThreeJsonId);
  const record = readCabinetPersistRecord(root);
  if (!root || !record) {
    return false;
  }
  const uSize = Number(options.uSize ?? deviceJson?.uSize) > 0 ? Number(options.uSize ?? deviceJson.uSize) : 1;
  const start = Number(uStart);
  if (!Number.isFinite(start) || start < 1) {
    return false;
  }
  const devices = Array.isArray(record.devices) ? [...record.devices] : [];
  if (!isUSlotRangeFree(devices, start, uSize)) {
    return false;
  }
  const device = ensureBusinessDeviceId(
    mergeDevicePayload(
      {},
      {
        ...deviceJson,
        uStart: start,
        uSize,
        deviceType: deviceJson?.deviceType || options.deviceType || "server"
      }
    )
  );
  devices.push(device);
  record.devices = devices;
  const groupJson = buildCabinetGroupJson(record);
  if (!groupJson) {
    return false;
  }
  root.userData.persistSource = record;
  root.userData.objJson = record;
  if (typeof options.redeploy === "function") {
    options.redeploy(root, groupJson);
    return true;
  }
  return true;
}

/**
 * @param {import("three").Scene} scene
 * @param {string|number} cabinetThreeJsonId
 * @param {number} uStart
 * @param {object} [options]
 * @returns {boolean}
 */
export function removeDevice(scene, cabinetThreeJsonId, uStart, options = {}) {
  const root = findCabinetByThreeJsonId(scene, cabinetThreeJsonId);
  const record = readCabinetPersistRecord(root);
  if (!root || !record) {
    return false;
  }
  const start = Number(uStart);
  const devices = Array.isArray(record.devices) ? record.devices : [];
  const next = devices.filter((device) => {
    const slot = readDeviceUSlot(device);
    if (!slot) {
      return true;
    }
    if (options.deviceId != null) {
      const id = device?.businessInfo?.deviceId ?? device?.threeJsonId;
      return String(id) !== String(options.deviceId);
    }
    return slot.uStart !== start;
  });
  if (next.length === devices.length) {
    return false;
  }
  record.devices = next;
  const groupJson = buildCabinetGroupJson(record);
  root.userData.persistSource = record;
  root.userData.objJson = record;
  if (typeof options.redeploy === "function") {
    options.redeploy(root, groupJson);
  }
  return true;
}

/**
 * @param {object} record
 * @returns {{used:number,total:number}}
 */
export function getSlotOccupancy(record) {
  return getUUsage(record);
}

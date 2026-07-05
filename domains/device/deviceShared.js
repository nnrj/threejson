import { cloneJson } from "../../core/util/cloneJson.js";

const DEFAULT_SLOTS = Object.freeze({
  total: 9,
  unitHeight: 0.48,
  bottomMargin: 0.77
});

/**
 * Cabinet shell butt-joint inner cavity size (matches cabinetFactory.assignCabinetShellPanels).
 * @param {number} width
 * @param {number} length
 * @param {number} height
 * @param {number} wallDepth
 * @returns {{width:number,length:number,height:number}}
 */
export function computeCabinetInnerCavity(width, length, height, wallDepth) {
  const wd = Number(wallDepth) > 0 ? Number(wallDepth) : 0;
  return {
    width: Math.max(0, width - 2 * wd),
    length: Math.max(0, length - 2 * wd),
    height: Math.max(0, height - 2 * wd)
  };
}

/**
 * @param {object|null|undefined} record
 * @returns {object}
 */
export function normalizeSlots(record) {
  let raw = record?.slots;
  if (
    !raw &&
    record &&
    typeof record === "object" &&
    (record.total != null || record.unitHeight != null || record.bottomMargin != null)
  ) {
    raw = record;
  }
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_SLOTS };
  }
  return {
    total: Number(raw.total) > 0 ? Number(raw.total) : DEFAULT_SLOTS.total,
    unitHeight:
      Number(raw.unitHeight) > 0 ? Number(raw.unitHeight) : DEFAULT_SLOTS.unitHeight,
    bottomMargin:
      Number(raw.bottomMargin) >= 0 ? Number(raw.bottomMargin) : DEFAULT_SLOTS.bottomMargin
  };
}

/**
 * U-slot center Y (1-based; U1 = bottom).
 * @param {object} slots
 * @param {number} uStart
 * @param {number} uSize
 * @returns {number}
 */
export function computeDeviceCenterY(slots, uStart, uSize) {
  const s = normalizeSlots(slots);
  const start = Number(uStart);
  const size = Number(uSize);
  if (!Number.isFinite(start) || start < 1 || !Number.isFinite(size) || size < 1) {
    return s.bottomMargin + s.unitHeight / 2;
  }
  return s.bottomMargin + (start - 1) * s.unitHeight + (size * s.unitHeight) / 2;
}

/**
 * @param {object} slots
 * @param {number} uSize
 * @returns {number}
 */
export function computeDeviceHeight(slots, uSize) {
  const s = normalizeSlots(slots);
  const size = Number(uSize);
  return Number.isFinite(size) && size > 0 ? size * s.unitHeight : s.unitHeight;
}

/**
 * @param {object} device
 * @returns {{uStart:number,uSize:number}|null}
 */
export function readDeviceUSlot(device) {
  if (!device || typeof device !== "object") {
    return null;
  }
  const uStart = Number(device.uStart);
  const uSize = Number(device.uSize);
  if (!Number.isFinite(uStart) || uStart < 1 || !Number.isFinite(uSize) || uSize < 1) {
    return null;
  }
  return { uStart, uSize };
}

/**
 * @param {object[]} devices
 * @param {number} uStart
 * @param {number} uSize
 * @param {string|number} [excludeId]
 * @returns {boolean}
 */
export function isUSlotRangeFree(devices, uStart, uSize, excludeId) {
  if (!Array.isArray(devices)) {
    return true;
  }
  const start = Number(uStart);
  const size = Number(uSize);
  const end = start + size - 1;
  for (let i = 0; i < devices.length; i++) {
    const slot = readDeviceUSlot(devices[i]);
    if (!slot) {
      continue;
    }
    const id = devices[i]?.threeJsonId ?? devices[i]?.name;
    if (excludeId != null && id === excludeId) {
      continue;
    }
    const otherEnd = slot.uStart + slot.uSize - 1;
    if (start <= otherEnd && slot.uStart <= end) {
      return false;
    }
  }
  return true;
}

/**
 * @param {object} record
 * @param {object} [slots]
 * @returns {{slots:{used:number,total:number},load?:{used:number,total:number}}}
 */
export function computeCabinetStats(record, slots) {
  const s = normalizeSlots(slots ?? record);
  const explicit = record?.stats;
  if (explicit && typeof explicit === "object") {
    const out = { slots: { used: 0, total: s.total } };
    if (explicit.slots && typeof explicit.slots === "object") {
      out.slots = {
        used: Number(explicit.slots.used) >= 0 ? Number(explicit.slots.used) : 0,
        total: Number(explicit.slots.total) > 0 ? Number(explicit.slots.total) : s.total
      };
    }
    if (explicit.load && typeof explicit.load === "object") {
      out.load = {
        used: Number(explicit.load.used) >= 0 ? Number(explicit.load.used) : 0,
        total: Number(explicit.load.total) > 0 ? Number(explicit.load.total) : 0
      };
    }
    return out;
  }
  let usedU = 0;
  const devices = Array.isArray(record?.devices) ? record.devices : [];
  for (let i = 0; i < devices.length; i++) {
    const slot = readDeviceUSlot(devices[i]);
    if (slot) {
      usedU += slot.uSize;
    }
  }
  return { slots: { used: usedU, total: s.total } };
}

/**
 * @param {object} record
 * @returns {{used:number,total:number}}
 */
export function getUUsage(record) {
  const stats = computeCabinetStats(record);
  return stats.slots;
}

/**
 * On deploy, backfill threeJsonId when businessInfo.deviceId is missing.
 * @param {object} record
 * @returns {object}
 */
export function ensureBusinessDeviceId(record) {
  if (!record || typeof record !== "object") {
    return record;
  }
  const out = record.businessInfo && typeof record.businessInfo === "object"
    ? record
    : { ...record, businessInfo: {} };
  if (!out.businessInfo || typeof out.businessInfo !== "object") {
    out.businessInfo = {};
  }
  const current = out.businessInfo.deviceId;
  if (current == null || String(current).trim() === "") {
    const id = out.threeJsonId;
    if (id != null && String(id).trim() !== "") {
      out.businessInfo.deviceId = id;
    }
  }
  return out;
}

/**
 * @param {object} record
 * @returns {object}
 */
export function mergeDevicePayload(base, override) {
  const out = cloneJson(base);
  if (!override || typeof override !== "object") {
    return out;
  }
  if (Array.isArray(override.devices)) {
    out.devices = cloneJson(override.devices);
  }
  if (Array.isArray(override.doors)) {
    out.doors = cloneJson(override.doors);
  }
  if (override.slots && typeof override.slots === "object") {
    out.slots = { ...(out.slots || {}), ...override.slots };
  }
  if (override.stats && typeof override.stats === "object") {
    out.stats = cloneJson(override.stats);
  }
  if (override.businessInfo && typeof override.businessInfo === "object") {
    out.businessInfo = { ...(out.businessInfo || {}), ...override.businessInfo };
  }
  const skip = new Set(["devices", "doors", "slots", "stats", "businessInfo"]);
  for (const key of Object.keys(override)) {
    if (!skip.has(key) && override[key] !== undefined) {
      out[key] = override[key];
    }
  }
  return out;
}

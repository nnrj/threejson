/**
 * device domain: rack device and standalone enclosure group descriptor builders.
 */
import { assetUrl } from "../../assets/assetsBase.js";
import { finalizeDomainDeployRoot } from "../../core/handler/domainDeployDescriptor.js";
import {
  createGroupFromDescriptor,
  deployGroupDescriptor
} from "../../core/handler/objectLoadHandler.js";
import { cloneJson } from "../../core/util/cloneJson.js";
import { ensureThreeJsonIdOnRecord } from "../../core/util/util.js";
import {
  computeCabinetInnerCavity,
  computeDeviceCenterY,
  computeDeviceHeight,
  ensureBusinessDeviceId,
  readDeviceUSlot
} from "./deviceShared.js";
import { brandPanel, deviceGroup } from "./deviceTemplates.js";
import { appendDevicePanelSubScene } from "./devicePanelResolver.js";

const DEVICE_DEFAULT_SIZE = { width: 60, length: 86, height: 3.5 };
const SWITCH_UNIT_HEIGHT = 1.75;
/** Single-side clearance between device and cabinet inner wall (avoids z-fighting) */
const RACK_DEVICE_WALL_CLEARANCE = 0.08;
const RACK_DEVICE_BODY_COLOR = "#000000";
const RACK_DEVICE_FALLBACK_CABINET = { width: 6, length: 12, height: 20 };
const RACK_DEVICE_FALLBACK_WALL_DEPTH = 0.2;

/**
 * @param {{width?:number,length?:number,height?:number}|null|undefined} cabinetSize cabinet outer dimensions
 * @param {number} [wallDepth] cabinet wall thickness (one side), from cabinetFactory
 * @returns {{width:number,length:number}}
 */
export function rackDeviceFootprintFromCabinet(cabinetSize, wallDepth = 0) {
  const clearance = RACK_DEVICE_WALL_CLEARANCE;
  if (!cabinetSize || typeof cabinetSize !== "object") {
    const cavity = computeCabinetInnerCavity(
      RACK_DEVICE_FALLBACK_CABINET.width,
      RACK_DEVICE_FALLBACK_CABINET.length,
      RACK_DEVICE_FALLBACK_CABINET.height,
      RACK_DEVICE_FALLBACK_WALL_DEPTH
    );
    return {
      width: Math.max(0.1, cavity.width - 2 * clearance),
      length: Math.max(0.1, cavity.length - 2 * clearance)
    };
  }
  const w = Number(cabinetSize.width);
  const l = Number(cabinetSize.length);
  const h = Number(cabinetSize.height);
  const wd = Number(wallDepth);
  const wall = Number.isFinite(wd) && wd > 0 ? wd : 0;
  if (Number.isFinite(w) && w > 0 && Number.isFinite(l) && l > 0) {
    const cavity = computeCabinetInnerCavity(
      w,
      l,
      Number.isFinite(h) && h > 0 ? h : RACK_DEVICE_FALLBACK_CABINET.height,
      wall
    );
    return {
      width: Math.max(0.1, cavity.width - 2 * clearance),
      length: Math.max(0.1, cavity.length - 2 * clearance)
    };
  }
  const cavity = computeCabinetInnerCavity(
    RACK_DEVICE_FALLBACK_CABINET.width,
    RACK_DEVICE_FALLBACK_CABINET.length,
    RACK_DEVICE_FALLBACK_CABINET.height,
    RACK_DEVICE_FALLBACK_WALL_DEPTH
  );
  return {
    width: Math.max(0.1, cavity.width - 2 * clearance),
    length: Math.max(0.1, cavity.length - 2 * clearance)
  };
}

/**
 * @param {number} width
 * @param {number} length
 * @param {{width:number,length:number}} footprint
 * @returns {{width:number,length:number}}
 */
function clampRackDevicePlanFootprint(width, length, footprint) {
  return {
    width: Math.min(width, footprint.width),
    length: Math.min(length, footprint.length)
  };
}

/**
 * In-cabinet devices default black; front keeps switch/custom textures.
 * @param {object} mesh
 * @param {{keepFrontTexture?:boolean}} [options]
 */
function applyRackDeviceBodyColors(mesh, options = {}) {
  const materials = mesh?.materials;
  if (!Array.isArray(materials)) {
    return;
  }
  const keepFrontTexture = options.keepFrontTexture === true;
  for (let i = 0; i < materials.length; i++) {
    const mat = materials[i];
    if (!mat) {
      continue;
    }
    if (i === 4 && keepFrontTexture) {
      continue;
    }
    mat.color = RACK_DEVICE_BODY_COLOR;
    if (i === 4) {
      delete mat.textureUrl;
    }
  }
}

/**
 * @param {object} source
 * @param {{width:number,length:number,height:number}} defaults
 */
export function getGeometrySize(source, defaults = DEVICE_DEFAULT_SIZE) {
  return {
    width: Number(source?.geometry?.width) > 0 ? Number(source.geometry.width) : defaults.width,
    length: Number(source?.geometry?.length ?? source?.geometry?.depth) > 0
      ? Number(source.geometry.length ?? source.geometry.depth)
      : defaults.length,
    height: Number(source?.geometry?.height) > 0 ? Number(source.geometry.height) : defaults.height
  };
}

/**
 * @param {object} deviceObj
 * @param {object} [options]
 * @returns {object|undefined}
 */
export function buildRackDeviceGroupJson(deviceObj, options = {}) {
  if (!deviceObj) {
    return undefined;
  }
  const slots = options.slots;
  const slot = readDeviceUSlot(deviceObj);
  const unitHeight = slots?.unitHeight ?? 0.48;
  const footprint = rackDeviceFootprintFromCabinet(options.cabinetSize, options.wallDepth);
  const defaultHeight =
    deviceObj.deviceType === "switch" ? SWITCH_UNIT_HEIGHT : DEVICE_DEFAULT_SIZE.height;
  let { width, length, height } = getGeometrySize(deviceObj, {
    width: footprint.width,
    length: footprint.length,
    height: defaultHeight
  });
  ({ width, length } = clampRackDevicePlanFootprint(width, length, footprint));
  if (slot && slots) {
    height = computeDeviceHeight(slots, slot.uSize);
  }
  const groupObj = cloneJson(deviceGroup);
  groupObj.name = deviceObj.name || groupObj.name;
  groupObj.deviceType = deviceObj.deviceType || groupObj.deviceType;
  groupObj.objType = deviceObj.objType || "device";
  if (slot && slots) {
    const centerY = computeDeviceCenterY(slots, slot.uStart, slot.uSize);
    groupObj.position = { x: 0, y: centerY, z: 0 };
  } else {
    groupObj.position = cloneJson(deviceObj.position || { x: 0, y: 0, z: 0 });
  }
  groupObj.rotation = cloneJson(deviceObj.rotation || groupObj.rotation);
  groupObj.scale = cloneJson(deviceObj.scale || groupObj.scale);
  const mesh = groupObj.boxModelList[0];
  mesh.geometry = { width, height, depth: length };
  const frontMat = mesh.materials?.[4];
  if (frontMat && deviceObj.textureUrl) {
    frontMat.textureUrl = deviceObj.textureUrl;
  } else if (frontMat && deviceObj.deviceType === "switch") {
    frontMat.textureUrl = assetUrl("textures/device/switch_front.png");
  }
  applyRackDeviceBodyColors(mesh, {
    keepFrontTexture: Boolean(deviceObj.textureUrl || deviceObj.deviceType === "switch")
  });
  const brandName = deviceObj.brandName || deviceObj.businessInfo?.brandName;
  if (brandName) {
    const deviceBrandPanel = cloneJson(brandPanel);
    deviceBrandPanel.text = brandName;
    const brandPanelDepth = 0.1;
    deviceBrandPanel.panel.geometry = { width: 5, height, depth: brandPanelDepth };
    deviceBrandPanel.panel.position = { x: 0, y: 0, z: length / 2 - brandPanelDepth - 0.08 };
    groupObj.infoPanelList = [deviceBrandPanel];
  }
  if (deviceObj.businessInfo && typeof deviceObj.businessInfo === "object") {
    groupObj.businessInfo = cloneJson(deviceObj.businessInfo);
  }
  if (slot) {
    groupObj.uStart = slot.uStart;
    groupObj.uSize = slot.uSize;
  }
  void unitHeight;
  return groupObj;
}

/**
 * @param {"server"|"switch"|"airConditioner"|"ups"} kind
 * @param {object} [overrides]
 * @returns {object}
 */
export function buildStandaloneDeviceGroupJson(kind, overrides = {}) {
  const presets = {
    server: {
      name: "server",
      deviceType: "server",
      geometry: { width: 5.8, length: 11.8, height: 0.48 }
    },
    switch: {
      name: "switch",
      deviceType: "switch",
      geometry: { width: 5.8, length: 11.8, height: 0.48 }
    },
    airConditioner: {
      name: "air-conditioning",
      deviceType: "airConditioner",
      geometry: { width: 6, length: 10, height: 20 },
      materials: [
        { color: "#7a7d82", type: "standard", receiveShadow: true },
        { color: "#7a7d82", type: "standard", receiveShadow: true },
        { color: "#8E8E8E", type: "standard", receiveShadow: true },
        { color: "#7a7d82", type: "standard", receiveShadow: true },
        {
          color: "#8A8A8A",
          type: "standard",
          textureUrl: assetUrl("textures/device/air_conditioner_back.png"),
          receiveShadow: true
        },
        {
          color: "#8A8A8A",
          type: "standard",
          textureUrl: assetUrl("textures/device/air_conditioner_front.png"),
          receiveShadow: true
        }
      ]
    },
    ups: {
      name: "ups",
      deviceType: "ups",
      geometry: { width: 8, length: 10, height: 16 }
    }
  };
  const preset = presets[kind] || presets.server;
  const merged = { ...preset, ...overrides };
  const { width, length, height } = getGeometrySize(merged, {
    width: preset.geometry.width,
    length: preset.geometry.length,
    height: preset.geometry.height
  });
  const groupObj = cloneJson(deviceGroup);
  groupObj.name = merged.name || groupObj.name;
  groupObj.deviceType = merged.deviceType;
  groupObj.objType = merged.objType || kind;
  groupObj.position = cloneJson(merged.position || { x: 0, y: height / 2, z: 0 });
  groupObj.rotation = cloneJson(merged.rotation || groupObj.rotation);
  groupObj.scale = cloneJson(merged.scale || groupObj.scale);
  const mesh = groupObj.boxModelList[0];
  mesh.geometry = { width, height, depth: length };
  if (Array.isArray(merged.materials)) {
    mesh.materials = cloneJson(merged.materials);
  } else if (merged.material) {
    mesh.material = cloneJson(merged.material);
    delete mesh.materials;
  }
  if (merged.infoPanel || merged.info || merged.devicePanelRef) {
    appendDevicePanelSubScene(groupObj, merged);
  } else if (merged.infoPanelList) {
    groupObj.infoPanelList = merged.infoPanelList;
  }
  if (merged.businessInfo) {
    groupObj.businessInfo = cloneJson(merged.businessInfo);
  }
  return groupObj;
}

/**
 * Normalize device record before deploy: flatten, businessId, stable threeJsonId.
 * @param {object} record
 * @returns {object}
 */
export function prepareDeviceDeployRecord(record) {
  const merged = ensureBusinessDeviceId(flattenDomainRecord(record));
  ensureThreeJsonIdOnRecord(merged);
  return merged;
}

/**
 * @param {import("three").Scene} scene
 * @param {object} groupJson
 * @param {object} meta
 * @returns {import("three").Group|null}
 */
export function deployDeviceDomainGroup(scene, groupJson, meta = {}) {
  if (!scene || !groupJson) {
    return null;
  }
  let itemDescriptor = meta.itemDescriptor;
  if (itemDescriptor) {
    itemDescriptor = ensureBusinessDeviceId(cloneJson(itemDescriptor));
  }
  const group = deployGroupDescriptor(scene, groupJson);
  if (group && itemDescriptor) {
    finalizeDomainDeployRoot(group, {
      domainId: meta.domainId,
      handler: meta.handler,
      itemDescriptor,
      loadRecord: meta.loadRecord ?? itemDescriptor,
      extras: meta.extras || {}
    });
  }
  return group;
}

/**
 * @param {object} groupJson
 * @returns {import("three").Group|undefined}
 */
export function createGroupFromDeviceJson(groupJson) {
  return createGroupFromDescriptor(groupJson);
}

/**
 * @param {object} record
 * @param {object} [options]
 * @returns {object}
 */
export function flattenDomainRecord(record, options = {}) {
  if (!record || typeof record !== "object") {
    return {};
  }
  if (record.payload && typeof record.payload === "object") {
    return { ...record.payload, ...options };
  }
  if (Array.isArray(record.items) && record.items[0]) {
    return { ...record.items[0], ...options };
  }
  const skip = new Set(["domain", "handler", "items", "options", "payload"]);
  const rest = {};
  for (const key of Object.keys(record)) {
    if (!skip.has(key)) {
      rest[key] = record[key];
    }
  }
  return rest;
}

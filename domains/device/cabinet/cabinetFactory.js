/**
 * device.cabinet factory: shell, doors (door domain), U rails, in-cabinet devices.
 */
import { log } from "../../../core/util/logger.js";

import { assetUrl } from "../../../assets/assetsBase.js";
import { finalizeDomainDeployRoot } from "../../../core/handler/domainDeployDescriptor.js";
import { coalesceBoxModelList } from "../../../core/handler/boxModelListCoalescer.js";
import {
  createGroupFromDescriptor,
  deployGroupDescriptor
} from "../../../core/handler/objectLoadHandler.js";
import { migrateGroupDescriptorToSubScene } from "../../../core/handler/subSceneHierarchy.js";
import { ensureThreeJsonIdOnRecord } from "../../../core/util/util.js";
import { DEVICE_SHELL_SIDE } from "../devicePalette.js";
import { cabinetGroup, slotRailBox } from "../deviceTemplates.js";
import {
  buildRackDeviceGroupJson,
  getGeometrySize
} from "../deviceBoxFactory.js";
import {
  computeCabinetInnerCavity,
  ensureBusinessDeviceId,
  mergeDevicePayload,
  normalizeSlots
} from "../deviceShared.js";
import { applyCabinetDoors } from "./cabinetDoorBuilder.js";
import defaultCabinetBase from "./defaultCabinet.json" with { type: "json" };

const CABINET_DEFAULT_SIZE = { width: 70, length: 90, height: 150 };
const CABINET_WALL_DEPTH_BASE_SIZE = { width: 60, length: 120, height: 200 };
const CABINET_DEFAULT_WALL_DEPTH = 2;
const CABINET_WALL_NAMES = new Set([
  "cabinetBack",
  "cabinetFront",
  "cabinetLeft",
  "cabinetRight",
  "cabinetTop",
  "cabinetBottom"
]);

/** @type {Record<string, string>} */
const CABINET_SHELL_TEXTURE_PATHS = {
  cabinetBottom: "textures/device/cabinet/cabinet_bottom_wall.png",
  cabinetTop: "textures/device/cabinet/cabinet_top_wall.png",
  cabinetLeft: "textures/device/cabinet/cabinet_left_wall.png",
  cabinetRight: "textures/device/cabinet/cabinet_right_wall.png",
  cabinetBack: "textures/device/cabinet/cabinet_back_wall.png"
};

/** @type {Record<string, string>} */
const DOOR_SIDE_TO_SHELL_PANEL = {
  left: "cabinetLeft",
  right: "cabinetRight",
  back: "cabinetBack",
  front: "cabinetFront"
};

/** U-rail texture naming: `cabinet_{n}u_left.png` / `cabinet_{n}u_right.png`. */
export const CABINET_SLOT_TEXTURE_TOTALS = Object.freeze([9, 24]);

/**
 * @param {"left"|"right"} side
 * @param {number} slotsTotal
 * @returns {string}
 */
export function resolveCabinetSlotRailTextureUrl(side, slotsTotal) {
  const total = Number(slotsTotal);
  const textureU = total === 24 ? 24 : 9;
  const safeSide = side === "right" ? "right" : "left";
  return assetUrl(`textures/device/cabinet/cabinet_${textureU}u_${safeSide}.png`);
}

/**
 * @param {object} config
 * @returns {object}
 */
function cloneModelConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

/**
 * @param {object} cabinetObj
 * @param {number} width
 * @param {number} length
 * @param {number} height
 * @returns {number}
 */
function getCabinetWallDepth(cabinetObj, width, length, height) {
  if (cabinetObj?.wallDepth) {
    return cabinetObj.wallDepth;
  }
  const scaleRatio = Math.min(
    width / CABINET_WALL_DEPTH_BASE_SIZE.width,
    length / CABINET_WALL_DEPTH_BASE_SIZE.length,
    height / CABINET_WALL_DEPTH_BASE_SIZE.height
  );
  return CABINET_DEFAULT_WALL_DEPTH * scaleRatio;
}

/**
 * `name` is for batch queries (cabinets use "cabinet"); display differentiation goes in `label`.
 * @param {object} record
 * @returns {object}
 */
function normalizeCabinetIdentity(record) {
  if (!record || typeof record !== "object") {
    return record;
  }
  const next = { ...record };
  const currentName = typeof next.name === "string" ? next.name.trim() : "";
  const currentLabel = typeof next.label === "string" ? next.label.trim() : "";
  if (!currentLabel) {
    next.label = currentName || "机柜";
  }
  next.name = "cabinet";
  return next;
}

/**
 * @param {string|object|undefined|null} cabinetObj
 * @returns {object}
 */
export function normalizeCabinetInput(cabinetObj) {
  if (cabinetObj == null || cabinetObj === "") {
    return normalizeCabinetIdentity(mergeDevicePayload(defaultCabinetBase, null));
  }
  if (typeof cabinetObj === "string") {
    try {
      const parsed = JSON.parse(cabinetObj);
      if (parsed && typeof parsed === "object") {
        return normalizeCabinetIdentity(mergeDevicePayload(defaultCabinetBase, parsed));
      }
    } catch (e) {
      log.warn("[device.cabinet] JSON parse failed, using default template", e);
    }
    return normalizeCabinetIdentity(cloneModelConfig(defaultCabinetBase));
  }
  return normalizeCabinetIdentity(mergeDevicePayload(defaultCabinetBase, cabinetObj));
}

/**
 * @param {object|null|undefined} cabinetObj
 * @returns {Set<string>}
 */
function collectCabinetDoorSides(cabinetObj) {
  const sides = new Set();
  const doors = cabinetObj?.doors;
  if (!Array.isArray(doors)) {
    return sides;
  }
  for (let i = 0; i < doors.length; i++) {
    const side = typeof doors[i]?.side === "string" ? doors[i].side.trim().toLowerCase() : "";
    if (side) {
      sides.add(side);
    }
  }
  return sides;
}

/**
 * @param {object|null|undefined} panel
 * @param {string} texturePath
 */
function applyCabinetShellPanelTexture(panel, texturePath) {
  if (!panel || !texturePath) {
    return;
  }
  const material =
    panel.material && typeof panel.material === "object"
      ? panel.material
      : { type: "standard", color: DEVICE_SHELL_SIDE };
  panel.material = {
    ...material,
    type: material.type || "standard",
    textureUrl: assetUrl(texturePath)
  };
}

/**
 * Top/bottom always textured; left/right/back only when no door on that side (single front-door rear uses cabinet_back_wall).
 * @param {object} groupObj
 * @param {object|null|undefined} cabinetObj
 */
function assignCabinetShellTextures(groupObj, cabinetObj) {
  if (!groupObj?.boxModelList?.length || !cabinetObj) {
    return;
  }
  const doorSides = collectCabinetDoorSides(cabinetObj);
  const blockedPanels = new Set();
  for (const side of doorSides) {
    const panelName = DOOR_SIDE_TO_SHELL_PANEL[side];
    if (panelName) {
      blockedPanels.add(panelName);
    }
  }
  for (let i = 0; i < groupObj.boxModelList.length; i++) {
    const panel = groupObj.boxModelList[i];
    const panelName = panel?.name;
    const texturePath = CABINET_SHELL_TEXTURE_PATHS[panelName];
    if (!texturePath) {
      continue;
    }
    if (panelName === "cabinetTop" || panelName === "cabinetBottom") {
      applyCabinetShellPanelTexture(panel, texturePath);
      continue;
    }
    if (!blockedPanels.has(panelName)) {
      applyCabinetShellPanelTexture(panel, texturePath);
    }
  }
}

/**
 * Six-wall butt-joint size and pose: side/front/back walls sit between top/bottom inner edges to avoid z-fighting.
 * boxModelList order matches {@link cabinetGroup}: bottom, top, left, right, back, front.
 * @param {object} groupObj
 * @param {number} width
 * @param {number} length
 * @param {number} height
 * @param {number} wallDepth
 * @param {object|null|undefined} [cabinetObj]
 */
export function assignCabinetShellPanels(groupObj, width, length, height, wallDepth, cabinetObj) {
  if (!groupObj?.boxModelList || groupObj.boxModelList.length < 6) {
    return;
  }
  const wd = wallDepth;
  const { width: innerW, length: innerL, height: innerH } = computeCabinetInnerCavity(
    width,
    length,
    height,
    wd
  );
  const halfW = width / 2;
  const halfL = length / 2;

  groupObj.boxModelList[0].geometry = { width, height: wd, depth: length };
  groupObj.boxModelList[1].geometry = { width, height: wd, depth: length };
  groupObj.boxModelList[2].geometry = { width: wd, height: innerH, depth: innerL };
  groupObj.boxModelList[3].geometry = { width: wd, height: innerH, depth: innerL };
  groupObj.boxModelList[4].geometry = { width: innerW, height: innerH, depth: wd };
  groupObj.boxModelList[5].geometry = { width: innerW, height: innerH, depth: wd };

  groupObj.boxModelList[0].position = { x: 0, y: wd / 2, z: 0 };
  groupObj.boxModelList[1].position = { x: 0, y: height - wd / 2, z: 0 };
  groupObj.boxModelList[2].position = { x: -halfW + wd / 2, y: height / 2, z: 0 };
  groupObj.boxModelList[3].position = { x: halfW - wd / 2, y: height / 2, z: 0 };
  groupObj.boxModelList[4].position = { x: 0, y: height / 2, z: -halfL + wd / 2 };
  groupObj.boxModelList[5].position = { x: 0, y: height / 2, z: halfL - wd / 2 };
  assignCabinetShellTextures(groupObj, cabinetObj);
}

/**
 * @param {object} cabinetObj
 * @param {object} groupObj
 * @returns {object}
 */
function productSlotRails(cabinetObj, groupObj) {
  if (!cabinetObj || !groupObj) {
    return groupObj;
  }
  const slots = normalizeSlots(cabinetObj);
  const { width, length, height } = getGeometrySize(cabinetObj, CABINET_DEFAULT_SIZE);
  const wallDepth = getCabinetWallDepth(cabinetObj, width, length, height);
  const innerHalfW = width / 2 - wallDepth;
  const scaleW = width / CABINET_DEFAULT_SIZE.width;
  const scaleL = length / CABINET_DEFAULT_SIZE.length;
  const scaleH = height / CABINET_DEFAULT_SIZE.height;
  let railT = 3 * scaleW;
  let railD = 1 * scaleL;
  const railH = height - 4 * scaleH;
  const maxRailT = Math.max(0.12, innerHalfW * 0.42);
  railT = Math.min(Math.max(0.12, railT), maxRailT);
  railD = Math.max(0.06, railD);
  let xRight = innerHalfW - railT / 2;
  let xLeft = -innerHalfW + railT / 2;
  if (!(xRight > xLeft && xRight > 0 && xLeft < 0)) {
    const halfGap = Math.max(railT / 2 + 0.02, width * 0.22);
    xRight = halfGap;
    xLeft = -halfGap;
  }
  const zFrontInner = length / 2 - wallDepth - railD / 2;
  const rightTipObj = cloneModelConfig(slotRailBox);
  rightTipObj.material.textureUrl = resolveCabinetSlotRailTextureUrl("right", slots.total);
  rightTipObj.geometry = { width: railT, height: railH, depth: railD };
  rightTipObj.position = { x: xRight, y: height / 2, z: zFrontInner };
  const leftTipObj = cloneModelConfig(slotRailBox);
  leftTipObj.material.textureUrl = resolveCabinetSlotRailTextureUrl("left", slots.total);
  leftTipObj.geometry = { width: railT, height: railH, depth: railD };
  leftTipObj.position = { x: xLeft, y: height / 2, z: zFrontInner };
  const boxModelList = groupObj.boxModelList ? [...groupObj.boxModelList] : [];
  boxModelList.push(rightTipObj, leftTipObj);
  groupObj.boxModelList = boxModelList;
  return groupObj;
}

/**
 * @param {object} cabinetObj
 * @param {object} groupObj
 * @returns {object}
 */
function productDevicesForCabinet(cabinetObj, groupObj) {
  if (!cabinetObj?.devices?.length || !groupObj) {
    return groupObj;
  }
  const slots = normalizeSlots(cabinetObj);
  const { width, length, height } = getGeometrySize(cabinetObj, CABINET_DEFAULT_SIZE);
  const wallDepth = getCabinetWallDepth(cabinetObj, width, length, height);
  const cabinetSize = { width, length, height };
  const subGroup = Array.isArray(groupObj.subGroup) ? [...groupObj.subGroup] : [];
  for (let i = 0; i < cabinetObj.devices.length; i++) {
    const deviceGroupObj = buildRackDeviceGroupJson(cabinetObj.devices[i], {
      slots,
      cabinetSize,
      wallDepth
    });
    if (deviceGroupObj) {
      subGroup.push(deviceGroupObj);
    }
  }
  groupObj.subGroup = subGroup;
  return groupObj;
}

/**
 * @param {object} cabinetObj
 * @param {object} groupObj
 * @returns {object}
 */
function applyCabinetTowardRotation(cabinetObj, groupObj) {
  if (!cabinetObj || !groupObj) {
    return groupObj;
  }
  const toward = cabinetObj.toward || "front";
  switch (toward) {
    case "back":
      groupObj.rotation.rotationY = Math.PI;
      break;
    case "left":
      groupObj.rotation.rotationY = -Math.PI / 2;
      break;
    case "right":
      groupObj.rotation.rotationY = Math.PI / 2;
      break;
    default:
      break;
  }
  return groupObj;
}

/**
 * @param {object} groupObj
 * @returns {object}
 */
function optimizeCabinet(groupObj) {
  if (groupObj?.boxModelList?.length) {
    for (let i = 0; i < groupObj.boxModelList.length; i++) {
      const boxModel = groupObj.boxModelList[i];
      if (boxModel && CABINET_WALL_NAMES.has(boxModel.name) && !boxModel.boxModelList) {
        boxModel.mergeCode = "mergeCabinet";
      }
    }
  }
  groupObj.boxModelList = coalesceBoxModelList(groupObj.boxModelList);
  return groupObj;
}

/**
 * @param {object} cabinetObj
 * @returns {object|undefined}
 */
export function buildCabinetGroupJson(cabinetObj) {
  if (!cabinetObj) {
    return undefined;
  }
  let groupObj = cloneModelConfig(cabinetGroup);
  const { width, length, height } = getGeometrySize(cabinetObj, CABINET_DEFAULT_SIZE);
  const wallDepth = getCabinetWallDepth(cabinetObj, width, length, height);
  groupObj.name = cabinetObj.name || groupObj.name;
  groupObj.position = cabinetObj.position || { x: 0, y: 0, z: 0 };
  groupObj.rotation = cabinetObj.rotation || groupObj.rotation;
  groupObj.scale = cabinetObj.scale || groupObj.scale;
  groupObj.objType = "deviceCabinet";
  assignCabinetShellPanels(groupObj, width, length, height, wallDepth, cabinetObj);
  groupObj = applyCabinetDoors(cabinetObj, groupObj, width, length, height, wallDepth);
  groupObj = productDevicesForCabinet(cabinetObj, groupObj);
  productSlotRails(cabinetObj, groupObj);
  applyCabinetTowardRotation(cabinetObj, groupObj);
  if (cabinetObj.businessInfo) {
    groupObj.businessInfo = cloneModelConfig(cabinetObj.businessInfo);
  }
  groupObj = optimizeCabinet(groupObj);
  return migrateGroupDescriptorToSubScene(groupObj);
}

/**
 * @param {string|object|undefined|null} [cabinetObj]
 * @returns {object|undefined}
 */
export function createCabinetJson(cabinetObj) {
  const merged = normalizeCabinetInput(cabinetObj);
  return buildCabinetGroupJson(merged);
}

/**
 * @param {string|object|undefined|null} [cabinetObj]
 * @returns {import("three").Group|undefined}
 */
export function createCabinet(cabinetObj) {
  const groupJson = createCabinetJson(cabinetObj);
  if (!groupJson) {
    return undefined;
  }
  return createGroupFromDescriptor(groupJson);
}

/**
 * @param {string|object|undefined|null} cabinetObj
 * @param {import("three").Scene} scene
 */
export function deployCabinet(cabinetObj, scene) {
  if (!scene) {
    return;
  }
  const merged = ensureBusinessDeviceId(normalizeCabinetInput(cabinetObj));
  ensureThreeJsonIdOnRecord(merged);
  const groupJson = buildCabinetGroupJson(merged);
  if (!groupJson) {
    return;
  }
  const group = deployGroupDescriptor(scene, groupJson);
  if (group) {
    finalizeDomainDeployRoot(group, {
      domainId: "device.cabinet",
      handler: "deployCabinet",
      itemDescriptor: merged,
      loadRecord: cabinetObj,
      extras: { threeJsonId: merged?.threeJsonId }
    });
    group.userData.objJson.pickThroughRaycast = true;
  }
}

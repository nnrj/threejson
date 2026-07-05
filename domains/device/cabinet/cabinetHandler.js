/**
 * device.cabinet stat visualization (delegates to stat.bar).
 */
import { createStatBar, createStatBarJson } from "../../stat/bar/barHandler.js";
import { animateUtilizationBarGroup } from "../../stat/statFactory.js";
import { stampStatLabels } from "../../stat/statShared.js";
import { deployGroupDescriptor } from "../../../core/handler/objectLoadHandler.js";
import { removeObjectById } from "../../../core/runtime/sceneObjectCommands.js";
import { mapUtilizationRateToColor } from "../../stat/statShared.js";
import { computeCabinetStats, normalizeSlots } from "../deviceShared.js";
import { flattenDomainRecord } from "../deviceBoxFactory.js";

const CABINET_STAT_OVERLAY_PREFIX = "__cabinetStatOverlay__";

/**
 * @param {object} cabinet
 * @param {"capacity"|"load"|"rackSpace"} statType
 * @returns {{value:number,max:number,label?:string,labelStyle?:object,position?:object}|null}
 */
function buildStatBarItemFromCabinet(cabinet, statType) {
  const source = cabinet?.userData?.objJson && typeof cabinet.userData.objJson === "object"
    ? cabinet.userData.objJson
    : cabinet;
  const record = flattenDomainRecord(source);
  const slots = normalizeSlots(record);
  const stats = computeCabinetStats(record, slots);
  const labelStyle = record?.labelStyle ?? record?.businessInfo?.labelStyle;
  const position = record.position;
  if (statType === "rackSpace") {
    return {
      value: stats.slots.used,
      max: stats.slots.total,
      label: `${stats.slots.used}/${stats.slots.total}`,
      labelStyle,
      position
    };
  }
  if (statType === "load" && stats.load) {
    return {
      value: stats.load.used,
      max: stats.load.total,
      labelStyle,
      position
    };
  }
  return {
    value: stats.slots.used,
    max: stats.slots.total,
    labelStyle,
    position
  };
}

/**
 * @param {import("three").Object3D|object} cabinet
 * @returns {import("three").Object3D|null}
 */
function resolveCabinetRoot(cabinet) {
  if (!cabinet || typeof cabinet !== "object") {
    return null;
  }
  return cabinet?.isObject3D ? cabinet : null;
}

/**
 * @param {object|null} record
 * @returns {number}
 */
function resolveCabinetBarHeight(record) {
  const fromGeometry = Number(record?.geometry?.height);
  if (Number.isFinite(fromGeometry) && fromGeometry > 0) {
    return fromGeometry;
  }
  const slots = normalizeSlots(record);
  return slots.total * slots.unitHeight;
}

/**
 * @param {object|null|undefined} record
 * @returns {{width?:number,depth?:number}}
 */
function resolveCabinetBarFootprint(record) {
  const flat = flattenDomainRecord(record);
  const geometry =
    flat?.geometry && typeof flat.geometry === "object" ? flat.geometry : {};
  const width = Number(geometry.width);
  const depth = Number(geometry.length ?? geometry.depth);
  const footprint = {};
  if (Number.isFinite(width) && width > 0) {
    footprint.width = width;
  }
  if (Number.isFinite(depth) && depth > 0) {
    footprint.depth = depth;
  }
  return footprint;
}

/**
 * @param {import("three").Object3D} cabinetRoot
 * @returns {string}
 */
function ensureCabinetThreeJsonId(cabinetRoot) {
  const userData = cabinetRoot.userData || {};
  cabinetRoot.userData = userData;
  const objJson = userData.objJson && typeof userData.objJson === "object" ? userData.objJson : {};
  userData.objJson = objJson;
  if (!objJson.threeJsonId) {
    objJson.threeJsonId = cabinetRoot.uuid;
  }
  return String(objJson.threeJsonId);
}

/**
 * @param {import("three").Object3D} cabinetRoot
 * @param {{animate?:boolean}} [options]
 * @returns {{overlayId:string,itemRecord:object}|null}
 */
function buildOverlayDescriptor(cabinetRoot, itemRecord, options = {}) {
  const rootId = ensureCabinetThreeJsonId(cabinetRoot);
  const overlayId = `${CABINET_STAT_OVERLAY_PREFIX}${rootId}`;
  const cabRecord = cabinetRoot.userData?.objJson;
  const barHeight = resolveCabinetBarHeight(cabRecord);
  const footprint = resolveCabinetBarFootprint(cabRecord);
  const desc = createStatBarJson(
    {
      ...itemRecord,
      position: { x: 0, y: 0, z: 0 },
      geometry: {
        ...(itemRecord.geometry || {}),
        ...footprint,
        height: barHeight
      }
    },
    { ...options, animate: options.animate === true, baseHeight: barHeight }
  );
  desc.threeJsonId = overlayId;
  desc.name = "cabinet-stat-overlay";
  return { overlayId, itemRecord: desc, barHeight };
}

/**
 * @param {import("three").Object3D} cabinetRoot
 */
function hideCabinetChildren(cabinetRoot) {
  const backup = [];
  for (let i = 0; i < cabinetRoot.children.length; i++) {
    const child = cabinetRoot.children[i];
    const childId = child?.userData?.objJson?.threeJsonId || child.uuid;
    backup.push({ id: String(childId), visible: child.visible !== false });
    child.visible = false;
  }
  cabinetRoot.userData._cabinetStatBackup = backup;
}

/**
 * @param {import("three").Object3D} cabinetRoot
 */
function restoreCabinetChildren(cabinetRoot) {
  const backup = Array.isArray(cabinetRoot?.userData?._cabinetStatBackup)
    ? cabinetRoot.userData._cabinetStatBackup
    : null;
  if (!backup?.length) {
    for (let i = 0; i < cabinetRoot.children.length; i++) {
      cabinetRoot.children[i].visible = true;
    }
    return;
  }
  for (let i = 0; i < cabinetRoot.children.length; i++) {
    const child = cabinetRoot.children[i];
    const childId = String(child?.userData?.objJson?.threeJsonId || child.uuid);
    const prev = backup.find((item) => item.id === childId);
    child.visible = prev ? prev.visible !== false : true;
  }
  delete cabinetRoot.userData._cabinetStatBackup;
}

/**
 * @param {import("three").Object3D|object} cabinet
 * @param {import("three").Scene} scene
 * @param {"capacity"|"load"|"rackSpace"} statType
 * @param {object} [options]
 */
function showCabinetStat(cabinet, scene, statType, options = {}) {
  const item = buildStatBarItemFromCabinet(cabinet, statType);
  if (!item || !scene?.isScene) {
    return;
  }
  const cabinetRoot = resolveCabinetRoot(cabinet);
  if (!cabinetRoot) {
    createStatBar(item, scene, { ...options, animate: options.animate === true });
    return;
  }
  clearCabinetStatView(cabinetRoot, scene);
  hideCabinetChildren(cabinetRoot);
  const overlayDesc = buildOverlayDescriptor(cabinetRoot, item, options);
  if (!overlayDesc) {
    restoreCabinetChildren(cabinetRoot);
    return;
  }
  const desc = overlayDesc.itemRecord;
  const barHeight = overlayDesc.barHeight;
  const animatePayload = desc._statAnimate;
  if (animatePayload) {
    delete desc._statAnimate;
  }
  const group = deployGroupDescriptor(cabinetRoot, desc);
  if (!group) {
    restoreCabinetChildren(cabinetRoot);
    return;
  }
  if (animatePayload) {
    animateUtilizationBarGroup(
      group,
      animatePayload.value,
      animatePayload.max,
      {
        ...animatePayload.options,
        baseHeight: barHeight
      }
    );
  } else {
    stampStatLabels(group);
  }
  cabinetRoot.userData._cabinetStatOverlayId = overlayDesc.overlayId;
}

/**
 * @param {import("three").Object3D|object} cabinet
 * @param {import("three").Scene} scene
 * @param {object} [options]
 */
export function showCapacityStats(cabinet, scene, options = {}) {
  showCabinetStat(cabinet, scene, "capacity", options);
}

/**
 * @param {import("three").Object3D|object} cabinet
 * @param {import("three").Scene} scene
 * @param {object} [options]
 */
export function showLoadStats(cabinet, scene, options = {}) {
  showCabinetStat(cabinet, scene, "load", options);
}

/**
 * @param {import("three").Object3D|object} cabinet
 * @param {import("three").Scene} scene
 * @param {object} [options]
 */
export function showUUsageStats(cabinet, scene, options = {}) {
  showCabinetStat(cabinet, scene, "rackSpace", options);
}

/**
 * @param {import("three").Object3D|object} cabinet
 * @param {import("three").Scene} scene
 * @param {object} [options]
 */
export function showRackSpaceStats(cabinet, scene, options = {}) {
  showUUsageStats(cabinet, scene, options);
}

/**
 * @param {import("three").Object3D} cabinet
 * @param {import("three").Scene} scene
 */
export function clearCabinetStatView(cabinet, scene) {
  const cabinetRoot = resolveCabinetRoot(cabinet);
  if (!cabinetRoot || !scene?.isScene) {
    return;
  }
  const overlayId = String(cabinetRoot?.userData?._cabinetStatOverlayId || "").trim();
  if (overlayId) {
    removeObjectById(scene, overlayId, { markBindingDirty: false });
    delete cabinetRoot.userData._cabinetStatOverlayId;
  }
  restoreCabinetChildren(cabinetRoot);
}

export { createStatBarJson, mapUtilizationRateToColor };

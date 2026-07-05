/**
 * device.ups: power cabinet shell + optional front single door (door domain).
 */
import { createDoorGroupJson, normalizePanelKind, normalizeSwing } from "../../door/doorGroupBuilder.js";
import { log } from "../../../core/util/logger.js";
import { cabinetGroup } from "../deviceTemplates.js";
import {
  createGroupFromDeviceJson,
  deployDeviceDomainGroup,
  getGeometrySize,
  prepareDeviceDeployRecord
} from "../deviceBoxFactory.js";
import { removeFrontWallForUps, assignCabinetDoorLeafIds } from "../cabinet/cabinetDoorBuilder.js";
import { ensureThreeJsonIdOnRecord } from "../../../core/util/util.js";
import { cloneJson } from "../../../core/util/cloneJson.js";
import { migrateGroupDescriptorToSubScene } from "../../../core/handler/subSceneHierarchy.js";
import { appendDevicePanelSubScene } from "../devicePanelResolver.js";

const UPS_DEFAULT_SIZE = { width: 8, length: 10, height: 16 };
const UPS_WALL_DEPTH = 0.2;

/**
 * @param {object|null|undefined} door
 * @returns {object|null}
 */
function normalizeUpsDoor(door) {
  if (!door || typeof door !== "object") {
    return null;
  }
  const panelKind = normalizePanelKind(door.panelKind);
  if (panelKind !== "solid" && panelKind !== "glass") {
    log.warn("[device.ups] invalid door.panelKind, fallback to solid");
  }
  const safePanel = panelKind === "glass" ? "glass" : "solid";
  if (door.leafCount != null && Number(door.leafCount) !== 1) {
    log.warn("[device.ups] UPS door only supports leafCount: 1");
  }
  if (door.side && String(door.side).trim().toLowerCase() !== "front") {
    log.warn("[device.ups] UPS door only supports front side");
  }
  return {
    panelKind: safePanel,
    swing: normalizeSwing(door),
    glassKind: door.glassKind,
    leafCount: 1
  };
}

/**
 * @param {object} record
 * @returns {object}
 */
function buildUpsShellGroup(record) {
  const { width, length, height } = getGeometrySize(record, UPS_DEFAULT_SIZE);
  const wallDepth = UPS_WALL_DEPTH;
  let groupObj = cloneJson(cabinetGroup);
  groupObj.name = record.name || "ups";
  groupObj.objType = "deviceUps";
  groupObj.position = cloneJson(record.position || { x: 0, y: 0, z: 0 });
  groupObj.rotation = cloneJson(record.rotation || groupObj.rotation);
  groupObj.scale = cloneJson(record.scale || groupObj.scale);
  groupObj.boxModelList[0].geometry = { width, height: wallDepth, depth: length };
  groupObj.boxModelList[1].geometry = { width, height: wallDepth, depth: length };
  groupObj.boxModelList[2].geometry = { width: wallDepth, height: height - wallDepth, depth: length };
  groupObj.boxModelList[3].geometry = { width: wallDepth, height, depth: length };
  groupObj.boxModelList[4].geometry = { width, height, depth: wallDepth };
  groupObj.boxModelList[5].geometry = { width, height, depth: wallDepth };
  groupObj.boxModelList[0].position = { x: 0, y: wallDepth, z: 0 };
  groupObj.boxModelList[1].position = { x: 0, y: height, z: 0 };
  groupObj.boxModelList[2].position = { x: -width / 2 + wallDepth / 2, y: height / 2, z: 0 };
  groupObj.boxModelList[3].position = { x: width / 2 - wallDepth / 2, y: height / 2, z: 0 };
  groupObj.boxModelList[4].position = { x: 0, y: height / 2, z: -length / 2 };
  groupObj.boxModelList[5].position = { x: 0, y: height / 2, z: length / 2 };
  const doorCfg = normalizeUpsDoor(record.door);
  if (doorCfg) {
    const { groupObj: shell, opening } = removeFrontWallForUps(
      groupObj,
      width,
      length,
      height,
      wallDepth
    );
    groupObj = shell;
    const swing = doorCfg.swing;
    const assembly = createDoorGroupJson({
      name: "ups-front-door",
      panelKind: doorCfg.panelKind,
      swing,
      leafCount: 1,
      glassKind: doorCfg.glassKind,
      geometry: {
        width: opening?.width ?? width,
        height: opening?.height ?? height,
        depth: opening?.depth ?? wallDepth
      }
    });
    const z = length / 2;
    assembly.position = {
      x: swing === "left" ? -width / 2 : width / 2,
      y: height / 2,
      z
    };
    groupObj.subGroup = [assembly];
    if (typeof record.threeJsonId === "string" && record.threeJsonId.trim()) {
      assignCabinetDoorLeafIds(record.threeJsonId.trim(), assembly, "front");
    }
  }
  appendDevicePanelSubScene(groupObj, record);
  if (record.businessInfo) {
    groupObj.businessInfo = cloneJson(record.businessInfo);
  }
  return migrateGroupDescriptorToSubScene(groupObj);
}

/**
 * @param {object} [overrides]
 * @returns {object}
 */
export function createUpsJson(overrides = {}) {
  return buildUpsShellGroup(overrides);
}

/**
 * @param {object} [overrides]
 * @returns {import("three").Group|undefined}
 */
export function createUps(overrides = {}) {
  return createGroupFromDeviceJson(createUpsJson(overrides));
}

/**
 * @param {object} record
 * @param {import("three").Scene} scene
 */
export function deployUps(record, scene) {
  if (!scene) {
    return;
  }
  const merged = prepareDeviceDeployRecord(record);
  ensureThreeJsonIdOnRecord(merged);
  const json = buildUpsShellGroup(merged);
  const group = deployDeviceDomainGroup(scene, json, {
    domainId: "device.ups",
    handler: "deployUps",
    itemDescriptor: merged,
    loadRecord: merged,
    extras: { threeJsonId: merged.threeJsonId }
  });
  if (group && normalizeUpsDoor(merged.door)) {
    group.userData.objJson.pickThroughRaycast = true;
  }
}

/**
 * @param {import("three").Scene} scene
 * @param {object} [overrides]
 */
export function addToScene(scene, overrides = {}) {
  deployUps(overrides, scene);
}

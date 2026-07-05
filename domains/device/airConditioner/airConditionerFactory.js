import {
  buildStandaloneDeviceGroupJson,
  createGroupFromDeviceJson,
  deployDeviceDomainGroup,
  flattenDomainRecord,
  prepareDeviceDeployRecord
} from "../deviceBoxFactory.js";
import { ensureBusinessDeviceId } from "../deviceShared.js";

/**
 * @param {object} [overrides]
 * @returns {object}
 */
export function createAirConditionerJson(overrides = {}) {
  return buildStandaloneDeviceGroupJson("airConditioner", overrides);
}

/**
 * @param {object} [overrides]
 * @returns {import("three").Group|undefined}
 */
export function createAirConditioner(overrides = {}) {
  return createGroupFromDeviceJson(createAirConditionerJson(overrides));
}

/**
 * @param {object} record
 * @param {import("three").Scene} scene
 */
export function deployAirConditioner(record, scene) {
  if (!scene) {
    return;
  }
  const merged = prepareDeviceDeployRecord(record);
  const json = createAirConditionerJson(merged);
  deployDeviceDomainGroup(scene, json, {
    domainId: "device.airConditioner",
    handler: "deployAirConditioner",
    itemDescriptor: merged,
    loadRecord: merged,
    extras: { threeJsonId: merged.threeJsonId }
  });
}

/**
 * @param {import("three").Scene} scene
 * @param {object} [overrides]
 */
export function addToScene(scene, overrides = {}) {
  deployAirConditioner(overrides, scene);
}

import {
  buildStandaloneDeviceGroupJson,
  createGroupFromDeviceJson,
  deployDeviceDomainGroup,
  prepareDeviceDeployRecord
} from "../deviceBoxFactory.js";

/**
 * @param {object} [overrides]
 * @returns {object}
 */
export function createSwitchJson(overrides = {}) {
  return buildStandaloneDeviceGroupJson("switch", overrides);
}

/**
 * @param {object} [overrides]
 * @returns {import("three").Group|undefined}
 */
export function createSwitch(overrides = {}) {
  return createGroupFromDeviceJson(createSwitchJson(overrides));
}

/**
 * @param {object} record
 * @param {import("three").Scene} scene
 */
export function deploySwitch(record, scene) {
  if (!scene) {
    return;
  }
  const merged = prepareDeviceDeployRecord(record);
  const json = createSwitchJson(merged);
  deployDeviceDomainGroup(scene, json, {
    domainId: "device.switch",
    handler: "deploySwitch",
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
  deploySwitch(overrides, scene);
}

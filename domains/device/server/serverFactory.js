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
export function createServerJson(overrides = {}) {
  return buildStandaloneDeviceGroupJson("server", overrides);
}

/**
 * @param {object} [overrides]
 * @returns {import("three").Group|undefined}
 */
export function createServer(overrides = {}) {
  return createGroupFromDeviceJson(createServerJson(overrides));
}

/**
 * @param {object} record
 * @param {import("three").Scene} scene
 */
export function deployServer(record, scene) {
  if (!scene) {
    return;
  }
  const merged = prepareDeviceDeployRecord(record);
  const json = createServerJson(merged);
  deployDeviceDomainGroup(scene, json, {
    domainId: "device.server",
    handler: "deployServer",
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
  deployServer(overrides, scene);
}

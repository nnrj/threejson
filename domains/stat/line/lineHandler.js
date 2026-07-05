/**
 * stat.line: 3D polyline chart (Line2 + optional drop lines / markers).
 */
import { log } from "../../../core/util/logger.js";
import { deployStatGroup } from "../statDeploy.js";
import { buildStatLineGroupJson, buildStatLineGroupsJson } from "../statLineFactory.js";

/**
 * @param {object} record
 * @returns {object[]}
 */
export function createStatLineJson(record = {}) {
  return buildStatLineGroupsJson(record);
}

/**
 * @param {object} record
 * @param {import("three").Scene} [scene]
 * @returns {import("three").Group[]|object[]|number}
 */
export function createStatLine(record = {}, scene) {
  const groups = createStatLineJson(record);
  if (!scene) {
    return groups;
  }
  let count = 0;
  for (let i = 0; i < groups.length; i++) {
    if (deployStatGroup(scene, groups[i])) {
      count++;
    }
  }
  return count;
}

/** @param {object} record @param {import("three").Scene} scene */
export function deployStatLine(record, scene) {
  return createStatLine(record, scene);
}

/**
 * @param {object} record
 * @param {import("three").Scene} scene
 */
export function resolveStatLineDomainModel(record, scene) {
  const handler = record?.handler ?? "createStatLine";
  if (handler === "createStatLine" || handler === "deployStatLine") {
    createStatLine(record, scene);
    return;
  }
  log.warn("[stat.line] unknown handler:", handler);
}

export { buildStatLineGroupJson, buildStatLineGroupsJson };

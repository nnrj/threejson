/**
 * stat.pie: 3D cylinder sector pie chart.
 */
import { log } from "../../../core/util/logger.js";
import { deployStatGroup } from "../statDeploy.js";
import { buildStatPieGroupJson } from "../statPieFactory.js";

/**
 * @param {object} record
 * @returns {object}
 */
export function createStatPieJson(record = {}) {
  const options = record?.options && typeof record.options === "object" ? record.options : {};
  return buildStatPieGroupJson(record, options);
}

/**
 * @param {object} record
 * @param {import("three").Scene} [scene]
 * @returns {import("three").Group|object|null}
 */
export function createStatPie(record = {}, scene) {
  const desc = createStatPieJson(record);
  if (!scene) {
    return desc;
  }
  return deployStatGroup(scene, desc);
}

/** @param {object} record @param {import("three").Scene} scene */
export function deployStatPie(record, scene) {
  return createStatPie(record, scene);
}

/**
 * @param {object} record
 * @param {import("three").Scene} scene
 */
export function resolveStatPieDomainModel(record, scene) {
  const handler = record?.handler ?? "createStatPie";
  if (handler === "createStatPie" || handler === "deployStatPie") {
    createStatPie(record, scene);
    return;
  }
  log.warn("[stat.pie] unknown handler:", handler);
}

export { buildStatPieGroupJson };

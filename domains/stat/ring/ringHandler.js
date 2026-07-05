/**
 * stat.ring: 3D ring chart (cylinder sectors + CSG inner holes; page needs three-bvh-csg).
 */
import { log } from "../../../core/util/logger.js";
import { deployStatGroup } from "../statDeploy.js";
import { buildStatRingGroupJson } from "../statRingFactory.js";

/**
 * @param {object} record
 * @returns {object}
 */
export function createStatRingJson(record = {}) {
  const options = record?.options && typeof record.options === "object" ? record.options : {};
  return buildStatRingGroupJson(record, options);
}

/**
 * @param {object} record
 * @param {import("three").Scene} [scene]
 * @returns {import("three").Group|object|null}
 */
export function createStatRing(record = {}, scene) {
  const desc = createStatRingJson(record);
  if (!scene) {
    return desc;
  }
  return deployStatGroup(scene, desc);
}

/** @param {object} record @param {import("three").Scene} scene */
export function deployStatRing(record, scene) {
  return createStatRing(record, scene);
}

/**
 * @param {object} record
 * @param {import("three").Scene} scene
 */
export function resolveStatRingDomainModel(record, scene) {
  const handler = record?.handler ?? "createStatRing";
  if (handler === "createStatRing" || handler === "deployStatRing") {
    createStatRing(record, scene);
    return;
  }
  log.warn("[stat.ring] unknown handler:", handler);
}

export { buildStatRingGroupJson };

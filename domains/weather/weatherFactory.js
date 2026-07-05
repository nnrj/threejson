import { createPlane } from "../../core/builder/modelBuilder.js";
import { log } from "../../core/util/logger.js";
import { deployParticleEmitter } from "../../core/builder/particle/particleEmitterBuilder.js";
import { buildWeatherPointsRecord, isWeatherHandler } from "./weatherPresets.js";
import {
  buildWindPlaneRecord,
  isWindHandler,
  resolveWindHandlerFromRecord
} from "./windPresets.js";

/**
 * @param {string} handler
 * @param {object} [overrides]
 * @returns {object|null}
 */
export function createWeatherJson(handler, overrides = {}) {
  if (!isWeatherHandler(handler)) {
    log.warn("[weather] unknown handler:", handler);
    return null;
  }
  return buildWeatherPointsRecord(handler, overrides);
}

/**
 * @param {object} record
 * @returns {object|null}
 */
export function createWeather(record) {
  const handler = record?.handler ?? "rain";
  return buildWeatherPointsRecord(handler, record);
}

/**
 * @param {object} record domain record (handler and optional override fields)
 * @param {THREE.Scene} scene
 * @returns {Promise<import("three").Points|null>}
 */
export async function deployWeather(record, scene, ctx = {}) {
  if (!record || !scene) {
    return null;
  }
  const handler = record.handler ?? "rain";
  const pointsRecord = buildWeatherPointsRecord(handler, record);
  if (!pointsRecord) {
    log.warn("[weather] deployWeather failed, handler:", handler);
    return null;
  }
  pointsRecord.objType = "particleEmitter";
  pointsRecord.simulation = record.simulation ?? "cpu";
  return deployParticleEmitter(pointsRecord, scene, ctx);
}

/**
 * @param {string} handler
 * @param {object} [overrides]
 * @returns {object|null}
 */
export function createWindJson(handler, overrides = {}) {
  const key =
    (typeof handler === "string" && isWindHandler(handler) ? handler : "") ||
    resolveWindHandlerFromRecord({ handler, ...overrides });
  if (!key) {
    log.warn("[weather] unknown wind handler:", handler);
    return null;
  }
  return buildWindPlaneRecord(key, overrides);
}

/**
 * @param {object} record
 * @returns {object|null}
 */
export function createWindStrip(record) {
  const handler = resolveWindHandlerFromRecord(record) || record?.handler || "wind";
  return buildWindPlaneRecord(handler, record);
}

/**
 * @param {object} record wind strip descriptor with handler or objType wind
 * @param {THREE.Scene} scene
 * @returns {import("three").Mesh|null}
 */
export function deployWindStrip(record, scene) {
  if (!record || !scene) {
    return null;
  }
  const handler = resolveWindHandlerFromRecord(record) || "wind";
  const planeRecord = buildWindPlaneRecord(handler, record);
  if (!planeRecord) {
    log.warn("[weather] deployWindStrip failed, handler:", handler);
    return null;
  }
  return createPlane(planeRecord, scene);
}

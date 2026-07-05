import { deployShaderSurface } from "../../../core/builder/shader/shaderSurfaceBuilder.js";
import { log } from "../../../core/util/logger.js";
import { finalizeDomainDeployRoot } from "../../../core/handler/domainDeployDescriptor.js";
import { buildSkyDomeRecord } from "./skyPresets.js";
import { parseSkyCycleConfig, restoreSkySyncedBackground } from "./skyTimeOfDay.js";

const NATURE_SKY_DOMAIN_ID = "nature.sky";

/**
 * @param {string} handler
 * @param {object} [overrides]
 * @returns {object|null}
 */
export function createSkyDomeJson(handler, overrides = {}) {
  return buildSkyDomeRecord(handler ?? "atmosphere", overrides);
}

/**
 * @param {import("three").Mesh|null|undefined} mesh
 * @returns {number|null}
 */
export function getSkyTimeOfDay(mesh) {
  const value = mesh?.userData?.skyCycle?.timeOfDay;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

/**
 * @param {import("three").Mesh|null|undefined} mesh
 * @param {number} hour
 */
export function setSkyTimeOfDay(mesh, hour) {
  if (!mesh?.userData?.skyCycle) {
    return;
  }
  let h = Number(hour);
  if (!Number.isFinite(h)) {
    return;
  }
  h = h % 24;
  if (h < 0) {
    h += 24;
  }
  mesh.userData.skyCycle.timeOfDay = h;
}

function attachSkyCycleRuntime(mesh, record, scene) {
  const handler = normalizeSkyHandlerKey(record?.handler);
  if (handler !== "cycle") {
    return;
  }
  const config = parseSkyCycleConfig(record);
  mesh.userData.skyCycle = config;

  if (config.syncBackground && scene?.background?.isColor) {
    mesh.userData.skyBgSnapshot = scene.background.clone();
  }

  if (!mesh.userData._skyCycleRemovedBound) {
    mesh.userData._skyCycleRemovedBound = true;
    mesh.addEventListener("removed", () => {
      restoreSkySyncedBackground(mesh, scene);
    });
  }
}

function normalizeSkyHandlerKey(handler) {
  if (typeof handler !== "string") {
    return "";
  }
  const key = handler.trim().toLowerCase();
  if (key === "dynamic" || key === "daynight") {
    return "cycle";
  }
  return key;
}

/**
 * @param {object} record
 * @param {import("three").Scene} scene
 * @param {object} [ctx]
 * @returns {import("three").Mesh|null}
 */
export function deploySkyDome(record, scene, ctx = {}) {
  if (!record || !scene) {
    return null;
  }
  const handler = record.handler ?? "atmosphere";
  const planeRecord = buildSkyDomeRecord(handler, record);
  if (!planeRecord) {
    log.warn("[nature.sky] deploySkyDome failed, handler:", handler);
    return null;
  }
  delete planeRecord._skyCycleSeed;

  const mesh = deployShaderSurface(planeRecord, scene, ctx);
  if (mesh) {
    mesh.renderOrder = Number.isFinite(Number(record.renderOrder)) ? Number(record.renderOrder) : -10;
    mesh.frustumCulled = false;
    attachSkyCycleRuntime(mesh, { ...record, handler: planeRecord.handler }, scene);

    const domainId = String(record.domain || "").trim();
    if (domainId || normalizeSceneObjType(record.objType) === "domain") {
      finalizeDomainDeployRoot(mesh, {
        domainId: domainId || NATURE_SKY_DOMAIN_ID,
        handler: planeRecord.handler,
        loadRecord: record
      });
    }
  }
  return mesh;
}

function normalizeSceneObjType(objType) {
  return typeof objType === "string" ? objType.trim().toLowerCase() : "";
}

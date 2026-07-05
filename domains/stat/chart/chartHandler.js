import { log } from "../../../core/util/logger.js";
/**
 * stat.chart: thin adapter; ECharts implementation in extensions/stat-echarts.
 */

/**
 * @param {object} record
 * @param {import("three").Scene} scene
 * @param {object} [ctx]
 * @returns {Promise<boolean>}
 */
export async function deployStatChart(record, scene, ctx = {}) {
  if (!scene) {
    return false;
  }
  await new Promise((resolve) => requestAnimationFrame(resolve));
  try {
    const mod = await import("../../../extensions/stat-echarts/bootstrapFromScene.js");
    return mod.bootstrapStatChartFromRecord({
      scene,
      record,
      sceneJson: ctx.sceneJson ?? ctx.jsonData,
      sceneConfig: ctx.sceneConfig,
      worldInfo: ctx.worldInfo ?? ctx.sceneJsonRoot?.worldInfo
    });
  } catch (err) {
    log.warn(
      "[stat.chart] extensions/stat-echarts unavailable or echarts not installed:",
      err?.message || err
    );
    return false;
  }
}

/**
 * @param {object} record
 * @param {import("three").Scene} scene
 * @param {object} [ctx]
 */
export function resolveStatChartDomainModel(record, scene, ctx) {
  const handler = record?.handler ?? "deployStatChart";
  if (handler === "deployStatChart" || handler === "createStatChart") {
    void deployStatChart(record, scene, ctx);
    return;
  }
  log.warn("[stat.chart] unknown handler:", handler);
}

/**
 * @param {object} [options]
 * @returns {object}
 */
export function createStatChartJson(options = {}) {
  return {
    handler: "deployStatChart",
    options: options && typeof options === "object" ? { ...options } : {}
  };
}

/** @param {object} record @param {import("three").Scene} scene @param {object} [ctx] */
export function createStatChart(record, scene, ctx) {
  void deployStatChart(record, scene, ctx);
  return null;
}

/** @param {object} record @param {import("three").Scene} scene @param {object} [ctx] */
export function deployStatChartApi(record, scene, ctx) {
  void deployStatChart(record, scene, ctx);
}

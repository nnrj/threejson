/**
 * stat-echarts 扩展：在场景 CSS3D 面板上初始化 ECharts（optional peer: echarts）。
 */
import { resolveSceneExtensions } from "../../core/util/extensionsUtil.js";
import { log } from "../../core/util/logger.js";
import { EXTENSION_ID } from "./constants.js";
import { findCss3dPanelElement, mountEchartsOnElement } from "./css3dChartBridge.js";

/** @type {WeakMap<HTMLElement, Promise<boolean>>} */
const bootstrapInflightByPanel = new WeakMap();

/**
 * @param {{
 *   scene?: import("three").Scene,
 *   record?: object,
 *   sceneJson?: object,
 *   sceneConfig?: object,
 *   worldInfo?: object,
 *   echarts?: object,
 * }} ctx
 * @returns {Promise<boolean>}
 */
export async function bootstrapStatChartFromRecord(ctx = {}) {
  const scene = ctx.scene;
  if (!scene) {
    return false;
  }
  const sceneConfig =
    ctx.sceneConfig ||
    ctx.sceneJson?.sceneConfig ||
    {};
  const worldInfo =
    ctx.worldInfo ||
    ctx.sceneJson?.worldInfo ||
    {};
  const extCfg = resolveSceneExtensions(sceneConfig, worldInfo)[EXTENSION_ID];
  if (extCfg?.enabled === false) {
    return false;
  }

  const record = ctx.record && typeof ctx.record === "object" ? ctx.record : {};
  const options =
    record.options && typeof record.options === "object"
      ? record.options
      : extCfg && typeof extCfg === "object"
        ? extCfg
        : {};
  const panelRef = options.panelRef || options.panelName || "kpi-chart";
  const echartsOption = options.echartsOption || options.option;
  if (!echartsOption) {
    log.warn("[stat-echarts] missing echartsOption");
    return false;
  }

  let echartsModule = ctx.echarts;
  if (!echartsModule) {
    try {
      const imported = await import("echarts");
      echartsModule = imported.default || imported;
    } catch (err) {
      log.warn("[stat-echarts] install optional peer: npm install echarts", err?.message || err);
      return false;
    }
  }

  const panelEl = findCss3dPanelElement(scene, panelRef);
  if (!panelEl) {
    log.warn("[stat-echarts] CSS3D panel not found for ref:", panelRef);
    return false;
  }

  const inflight = bootstrapInflightByPanel.get(panelEl);
  if (inflight) {
    return inflight;
  }

  const task = (async () => {
    mountEchartsOnElement(panelEl, echartsModule, echartsOption);
    return true;
  })();

  bootstrapInflightByPanel.set(panelEl, task);
  try {
    return await task;
  } finally {
    bootstrapInflightByPanel.delete(panelEl);
  }
}

/**
 * @param {object} ctx
 * @returns {Promise<boolean>}
 */
export async function bootstrapStatChartsFromScene(ctx) {
  const sceneJson = ctx?.sceneJson;
  const list = sceneJson?.worldInfo?.domainModelList;
  if (!Array.isArray(list)) {
    return false;
  }
  let ok = false;
  for (let i = 0; i < list.length; i++) {
    const rec = list[i];
    if (rec?.domain !== "stat.chart") {
      continue;
    }
    const hit = await bootstrapStatChartFromRecord({ ...ctx, record: rec });
    ok = ok || hit;
  }
  return ok;
}

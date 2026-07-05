/**
 * stat root domain: shared API and dispatch entry (capabilities in stat.* subdomains).
 */
import { mapUtilizationRateToColor } from "./statShared.js";
import { log } from "../../core/util/logger.js";
import { createStatBars } from "./bar/barHandler.js";
import { createStatGrid } from "./grid/gridHandler.js";
import { deployStatPanel } from "./panel/panelHandler.js";

function createStatJson(overrides = {}) {
  return overrides && typeof overrides === "object" ? { ...overrides } : {};
}

function createStat() {
  return null;
}

function deployStat() {}

function resolveStatDomainModel(record, scene, ctx) {
  const handler = record?.handler;
  if (handler === "createStatBars") {
    const items = Array.isArray(record.items) ? record.items : [];
    createStatBars(items, scene);
    return;
  }
  if (handler === "createStatGrid") {
    const items = Array.isArray(record.items) ? record.items : [];
    const options = record.options && typeof record.options === "object" ? record.options : {};
    createStatGrid(items, scene, options);
    return;
  }
  if (handler === "deployStatPanel") {
    deployStatPanel(record.payload || record, scene);
    return;
  }
  if (handler === "deployStatChart") {
    void import("./chart/chartHandler.js")
      .then((mod) => mod.deployStatChart(record, scene, ctx))
      .catch((err) => log.warn("[stat] deployStatChart failed:", err));
    return;
  }
  log.warn(
    "[stat] use qualified subdomain (stat.bar / stat.grid / stat.panel / stat.chart / stat.line / stat.pie / stat.ring); unknown handler:",
    handler
  );
}

const statDomain = {
  id: "stat",
  defaultHandler: "createStatBars",
  resolveDomainModel: resolveStatDomainModel,
  api: {
    createStatJson,
    createStat,
    deployStat,
    mapUtilizationRateToColor,
    createStatBars,
    createStatGrid,
    deployStatPanel
  }
};

export default statDomain;

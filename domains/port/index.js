import { log } from "../../core/util/logger.js";
import {
  createPortJson,
  createPort,
  deployPort
} from "./portFactory.js";
import {
  countPortStatisticsAnchors,
  createPortStatistics,
  mapUtilizationRateToColor
} from "./portHandler.js";

function resolvePortDomainModel(record, scene, ctx) {
  const handler = record.handler;
  if (handler === "dockCrane" || handler === "berthShip" || handler === "rtgCrane" || handler === "portLampPost") {
    deployPort(record, scene);
    return;
  }
  if (handler === "createPortStatistics") {
    const statType =
      (record.options && record.options.statType) ?? record.statType ?? "capacity";
    const root = ctx?.sceneJsonRoot ?? ctx?.jsonData ?? { worldInfo: {} };
    const n = createPortStatistics(root, scene, statType);
    if (ctx && typeof ctx === "object") {
      ctx.lastPortStatCount = n;
    }
    return;
  }
  if (handler != null) {
    log.warn("[port] domainModel handler not implemented for JSON dispatch:", handler);
  }
}

/**
 * Port business domain: canonical JSON uses `domainModelList` (`objType: domain` + handler); legacy `boxModelList` sugar rewritten by normalizer then `invokeDomainModel`.
 * Throughput/load/yard bars without cabinets via `domainModelList` + `createPortStatistics` (requires ctx.sceneJsonRoot).
 */
const portDomain = {
  id: "port",
  legacyBoxObjTypes: {
    dockCrane: "dockCrane",
    berthShip: "berthShip",
    rtgCrane: "rtgCrane",
    portLampPost: "portLampPost"
  },
  composeBoxModel(boxModel) {
    return createPort(boxModel);
  },
  resolveDomainModel: resolvePortDomainModel,
  api: {
    createPortJson,
    createPort,
    deployPort,
    countPortStatisticsAnchors,
    createPortStatistics,
    mapUtilizationRateToColor
  }
};

export default portDomain;

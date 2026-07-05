import { log } from "../../../core/util/logger.js";
import {
  createWindJson,
  createWindStrip,
  deployWindStrip
} from "../weatherFactory.js";
import { isWindHandler, WIND_HANDLER_PRESETS } from "../windPresets.js";
import { applyWindVisualScale, normalizeWindVisualScale } from "../windRecordNormalize.js";

function resolveWindDomainModel(record, scene) {
  const handler = record?.handler ?? "wind";
  if (!isWindHandler(handler)) {
    log.warn("[weather.wind] unknown handler:", handler);
    return;
  }
  deployWindStrip({ ...record, handler }, scene);
}

/**
 * Wind strip subdomain (wind / coldWind / hotWind).
 */
const weatherWindDomain = {
  id: "weather.wind",
  defaultHandler: "wind",
  peerDomains: ["weather"],
  resolveDomainModel: resolveWindDomainModel,
  api: {
    createWindJson(handler, overrides = {}) {
      return createWindJson(handler ?? "wind", overrides);
    },
    createWind(record) {
      return createWindStrip({ handler: "wind", ...record });
    },
    deployWind(record, scene) {
      return deployWindStrip({ handler: record?.handler ?? "wind", ...record }, scene);
    },
    isWindHandler,
    windPresets: WIND_HANDLER_PRESETS,
    normalizeWindVisualScale,
    applyWindVisualScale
  }
};

export { applyWindVisualScale, normalizeWindVisualScale };

export default weatherWindDomain;

import { log } from "../../../core/util/logger.js";
import {
  createWeatherJson,
  createWeather,
  deployWeather
} from "../weatherFactory.js";
import { isWeatherHandler, WEATHER_HANDLER_PRESETS } from "../weatherPresets.js";

function resolveRainDomainModel(record, scene) {
  const handler = record?.handler ?? "rain";
  if (!isWeatherHandler(handler)) {
    log.warn("[weather.rain] unknown handler:", handler);
    return;
  }
  void deployWeather({ ...record, handler }, scene);
}

/**
 * Weather particle subdomain (rain / snow / sparkles / embers).
 */
const weatherRainDomain = {
  id: "weather.rain",
  defaultHandler: "rain",
  peerDomains: ["weather"],
  resolveDomainModel: resolveRainDomainModel,
  api: {
    createRainJson(handler, overrides = {}) {
      return createWeatherJson(handler ?? "rain", overrides);
    },
    createRain(record) {
      return createWeather({ handler: "rain", ...record });
    },
    deployRain(record, scene) {
      return deployWeather({ handler: record?.handler ?? "rain", ...record }, scene);
    },
    isWeatherHandler,
    weatherPresets: WEATHER_HANDLER_PRESETS
  }
};

export default weatherRainDomain;

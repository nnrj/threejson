import { registerObjTypeDeployer } from "../../core/handler/sceneExtensionRegistry.js";
import { log } from "../../core/util/logger.js";
import {
  createWeatherJson,
  createWeather,
  deployWeather,
  createWindJson,
  createWindStrip,
  deployWindStrip
} from "./weatherFactory.js";
import { isWeatherHandler, WEATHER_HANDLER_PRESETS } from "./weatherPresets.js";
import { isWindHandler, WIND_HANDLER_PRESETS } from "./windPresets.js";

function resolveWeatherDomainModel(record, scene) {
  const handler = record?.handler ?? "rain";
  if (isWindHandler(handler)) {
    deployWindStrip(record, scene);
    return;
  }
  if (isWeatherHandler(handler)) {
    void deployWeather(record, scene);
    return;
  }
  log.warn("[weather] domainModel handler not implemented:", handler);
}

registerObjTypeDeployer("wind", (record, scene) => {
  deployWindStrip(record, scene);
});

/**
 * Weather domain: particles (rain/snow/sparkles/embers) and strip wind (wind/coldWind/hotWind).
 */
const weatherDomain = {
  id: "weather",
  defaultHandler: "rain",
  resolveDomainModel: resolveWeatherDomainModel,
  api: {
    createWeatherJson,
    createWeather,
    deployWeather,
    createWindJson,
    createWindStrip,
    deployWindStrip,
    createWind: deployWindStrip,
    isWeatherHandler,
    isWindHandler,
    weatherPresets: WEATHER_HANDLER_PRESETS,
    windPresets: WIND_HANDLER_PRESETS
  }
};

export default weatherDomain;

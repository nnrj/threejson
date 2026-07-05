import { registerObjTypeDeployer } from "../../../core/handler/sceneExtensionRegistry.js";
import { log } from "../../../core/util/logger.js";
import { registerAtmosphereShaderPresets } from "./shaders/atmosphereShader.js";
import { createSkyDomeJson, deploySkyDome, getSkyTimeOfDay, setSkyTimeOfDay } from "./skyFactory.js";
import { buildSkyDomeRecord, isSkyHandler, SKY_HANDLER_PRESETS } from "./skyPresets.js";

registerAtmosphereShaderPresets();

function resolveSkyDomainModel(record, scene) {
  const handler = record?.handler ?? "atmosphere";
  if (!isSkyHandler(handler)) {
    log.warn("[nature.sky] unknown handler:", handler);
    return;
  }
  deploySkyDome({ ...record, handler }, scene);
}

registerObjTypeDeployer("skydome", (record, scene, ctx) => {
  deploySkyDome(record, scene, ctx);
});

const natureSkyDomain = {
  id: "nature.sky",
  defaultHandler: "atmosphere",
  peerDomains: ["nature"],
  resolveDomainModel: resolveSkyDomainModel,
  api: {
    createSkyJson: createSkyDomeJson,
    createSky(handlerOrOverrides, overrides = {}) {
      if (typeof handlerOrOverrides === "string") {
        return createSkyDomeJson(handlerOrOverrides, overrides);
      }
      const rec = handlerOrOverrides && typeof handlerOrOverrides === "object" ? handlerOrOverrides : {};
      return createSkyDomeJson(rec.handler ?? "atmosphere", rec);
    },
    deploySky: deploySkyDome,
    createSkyDomeJson,
    deploySkyDome,
    getSkyTimeOfDay,
    setSkyTimeOfDay,
    buildSkyDomeRecord,
    isSkyHandler,
    skyPresets: SKY_HANDLER_PRESETS
  }
};

export default natureSkyDomain;

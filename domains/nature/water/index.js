import { registerObjTypeDeployer } from "../../../core/handler/sceneExtensionRegistry.js";
import { log } from "../../../core/util/logger.js";
import { registerOceanShaderPresets } from "./shaders/oceanShader.js";
import { createWaterSurfaceJson, deployWaterSurface } from "./waterFactory.js";
import { buildWaterSurfaceRecord, isWaterHandler, WATER_HANDLER_PRESETS } from "./waterPresets.js";
import { parseWaterQuality, WATER_QUALITY_PROFILES } from "./waterQuality.js";

registerOceanShaderPresets();

function resolveWaterDomainModel(record, scene) {
  const handler = record?.handler ?? "ocean";
  if (!isWaterHandler(handler)) {
    log.warn("[nature.water] unknown handler:", handler);
    return;
  }
  deployWaterSurface({ ...record, handler }, scene);
}

registerObjTypeDeployer("watersurface", (record, scene, ctx) => {
  deployWaterSurface(record, scene, ctx);
});

const natureWaterDomain = {
  id: "nature.water",
  defaultHandler: "ocean",
  peerDomains: ["nature"],
  resolveDomainModel: resolveWaterDomainModel,
  api: {
    createWaterJson: createWaterSurfaceJson,
    createWater(handlerOrOverrides, overrides = {}) {
      if (typeof handlerOrOverrides === "string") {
        return createWaterSurfaceJson(handlerOrOverrides, overrides);
      }
      const rec = handlerOrOverrides && typeof handlerOrOverrides === "object" ? handlerOrOverrides : {};
      return createWaterSurfaceJson(rec.handler ?? "ocean", rec);
    },
    deployWater: deployWaterSurface,
    createWaterSurfaceJson,
    deployWaterSurface,
    buildWaterSurfaceRecord,
    isWaterHandler,
    waterPresets: WATER_HANDLER_PRESETS,
    parseWaterQuality,
    waterQualityProfiles: WATER_QUALITY_PROFILES
  }
};

export default natureWaterDomain;

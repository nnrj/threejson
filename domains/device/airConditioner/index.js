import { log } from "../../../core/util/logger.js";
import {
  createAirConditioner,
  createAirConditionerJson,
  deployAirConditioner,
  addToScene
} from "./airConditionerFactory.js";

function resolveAirConditionerDomainModel(record, scene) {
  const handler = record?.handler ?? "deployAirConditioner";
  if (handler === "deployAirConditioner" || handler === "addToScene") {
    deployAirConditioner(record, scene);
    return;
  }
  log.warn("[device.airConditioner] unknown handler:", handler);
}

const deviceAirConditionerDomain = {
  id: "device.airConditioner",
  defaultHandler: "deployAirConditioner",
  peerDomains: ["device"],
  legacyBoxObjTypes: {
    airConditioning: "deployAirConditioner"
  },
  resolveDomainModel: resolveAirConditionerDomainModel,
  api: {
    createAirConditionerJson,
    createAirConditioner,
    deployAirConditioner,
    addToScene
  }
};

export default deviceAirConditionerDomain;

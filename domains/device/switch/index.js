import { log } from "../../../core/util/logger.js";
import {
  createSwitch,
  createSwitchJson,
  deploySwitch,
  addToScene
} from "./switchFactory.js";

function resolveSwitchDomainModel(record, scene) {
  const handler = record?.handler ?? "deploySwitch";
  if (handler === "deploySwitch" || handler === "addToScene") {
    deploySwitch(record, scene);
    return;
  }
  log.warn("[device.switch] unknown handler:", handler);
}

const deviceSwitchDomain = {
  id: "device.switch",
  defaultHandler: "deploySwitch",
  peerDomains: ["device"],
  resolveDomainModel: resolveSwitchDomainModel,
  api: {
    createSwitchJson,
    createSwitch,
    deploySwitch,
    addToScene
  }
};

export default deviceSwitchDomain;

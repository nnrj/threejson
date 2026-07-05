import { log } from "../../../core/util/logger.js";
import {
  createUps,
  createUpsJson,
  deployUps,
  addToScene
} from "./upsFactory.js";

function resolveUpsDomainModel(record, scene) {
  const handler = record?.handler ?? "deployUps";
  if (handler === "deployUps" || handler === "addToScene") {
    deployUps(record, scene);
    return;
  }
  log.warn("[device.ups] unknown handler:", handler);
}

const deviceUpsDomain = {
  id: "device.ups",
  defaultHandler: "deployUps",
  peerDomains: ["device"],
  resolveDomainModel: resolveUpsDomainModel,
  api: {
    createUpsJson,
    createUps,
    deployUps,
    addToScene
  }
};

export default deviceUpsDomain;

import { log } from "../../../core/util/logger.js";
import {
  createServer,
  createServerJson,
  deployServer,
  addToScene
} from "./serverFactory.js";

function resolveServerDomainModel(record, scene) {
  const handler = record?.handler ?? "deployServer";
  if (handler === "deployServer" || handler === "addToScene") {
    deployServer(record, scene);
    return;
  }
  log.warn("[device.server] unknown handler:", handler);
}

const deviceServerDomain = {
  id: "device.server",
  defaultHandler: "deployServer",
  peerDomains: ["device"],
  resolveDomainModel: resolveServerDomainModel,
  api: {
    createServerJson,
    createServer,
    deployServer,
    addToScene
  }
};

export default deviceServerDomain;

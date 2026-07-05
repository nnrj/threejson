import {
  createStatLine,
  createStatLineJson,
  deployStatLine,
  resolveStatLineDomainModel
} from "./lineHandler.js";

const statLineDomain = {
  id: "stat.line",
  defaultHandler: "createStatLine",
  peerDomains: ["stat"],
  resolveDomainModel: resolveStatLineDomainModel,
  api: {
    createLineJson: createStatLineJson,
    createLine: createStatLine,
    deployLine: deployStatLine,
    createStatLineJson,
    createStatLine,
    deployStatLine
  }
};

export default statLineDomain;

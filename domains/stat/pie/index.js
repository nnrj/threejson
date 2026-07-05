import {
  createStatPie,
  createStatPieJson,
  deployStatPie,
  resolveStatPieDomainModel
} from "./pieHandler.js";

const statPieDomain = {
  id: "stat.pie",
  defaultHandler: "createStatPie",
  peerDomains: ["stat"],
  resolveDomainModel: resolveStatPieDomainModel,
  api: {
    createPieJson: createStatPieJson,
    createPie: createStatPie,
    deployPie: deployStatPie,
    createStatPieJson,
    createStatPie,
    deployStatPie
  }
};

export default statPieDomain;

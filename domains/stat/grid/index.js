import {
  createStatGrid,
  createStatGridJson,
  deployStatGrid,
  resolveStatGridDomainModel
} from "./gridHandler.js";

const statGridDomain = {
  id: "stat.grid",
  defaultHandler: "createStatGrid",
  peerDomains: ["stat"],
  resolveDomainModel: resolveStatGridDomainModel,
  api: {
    createGridJson: createStatGridJson,
    createGrid: createStatGrid,
    deployGrid: deployStatGrid,
    createStatGridJson,
    createStatGrid,
    deployStatGrid
  }
};

export default statGridDomain;

import {
  createStatBar,
  createStatBarJson,
  deployStatBar,
  createStatBars,
  resolveStatBarDomainModel
} from "./barHandler.js";

const statBarDomain = {
  id: "stat.bar",
  defaultHandler: "createStatBars",
  peerDomains: ["stat"],
  resolveDomainModel: resolveStatBarDomainModel,
  api: {
    createBarJson: createStatBarJson,
    createBar: createStatBar,
    deployBar: deployStatBar,
    createStatBarJson,
    createStatBar,
    deployStatBar,
    createStatBars
  }
};

export default statBarDomain;

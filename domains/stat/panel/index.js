import {
  createStatPanel,
  createStatPanelJson,
  deployStatPanel,
  resolveStatPanelDomainModel
} from "./panelHandler.js";

const statPanelDomain = {
  id: "stat.panel",
  defaultHandler: "deployStatPanel",
  peerDomains: ["stat"],
  resolveDomainModel: resolveStatPanelDomainModel,
  api: {
    createPanelJson: createStatPanelJson,
    createPanel: createStatPanel,
    deployPanel: deployStatPanel,
    createStatPanelJson,
    createStatPanel,
    deployStatPanel
  }
};

export default statPanelDomain;

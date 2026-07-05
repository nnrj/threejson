import {
  createStatRing,
  createStatRingJson,
  deployStatRing,
  resolveStatRingDomainModel
} from "./ringHandler.js";

const statRingDomain = {
  id: "stat.ring",
  defaultHandler: "createStatRing",
  peerDomains: ["stat"],
  resolveDomainModel: resolveStatRingDomainModel,
  api: {
    createRingJson: createStatRingJson,
    createRing: createStatRing,
    deployRing: deployStatRing,
    createStatRingJson,
    createStatRing,
    deployStatRing
  }
};

export default statRingDomain;

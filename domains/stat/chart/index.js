import {
  createStatChart,
  createStatChartJson,
  deployStatChartApi as deployStatChart,
  resolveStatChartDomainModel
} from "./chartHandler.js";

const statChartDomain = {
  id: "stat.chart",
  defaultHandler: "deployStatChart",
  peerDomains: ["stat"],
  resolveDomainModel: resolveStatChartDomainModel,
  api: {
    createChartJson: createStatChartJson,
    createChart: createStatChart,
    deployChart: deployStatChart,
    createStatChartJson,
    createStatChart,
    deployStatChart
  }
};

export default statChartDomain;

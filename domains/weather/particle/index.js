/**
 * Weather particle namespace (intermediate node): no deploy api; package hierarchy only.
 * Sub-capabilities use weather.rain etc.; do not invoke domain: "weather.particle".
 */
const weatherParticleDomain = {
  id: "weather.particle",
  peerDomains: ["weather"],
  api: {}
};

export default weatherParticleDomain;

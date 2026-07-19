/**
 * Token-cheap business-domain lookup data for supplier-model negotiation plus focused details
 * injected only when negotiation selects a matching domain capability.
 *
 * This is intentionally declarative AI metadata. Core must not import runtime implementations
 * from domains/, because domains depend on core and that would create a reverse dependency.
 */

const THREE_JSON_DOMAIN_CAPABILITY_INDEX = `
Business-domain capability ids (these are negotiation ids, not runtime domain strings; select the most specific id whose syntax/examples are needed):
- deviceCabinetDomain (runtime domain device.cabinet) — rack/cabinet shell, doors, U slots and in-cabinet devices; use for machine rooms/data centers/server rooms.
- deviceServerDomain (device.server) — standalone server appliance; servers installed in a rack normally belong in a device.cabinet devices[] array instead.
- deviceSwitchDomain (device.switch) — standalone switch appliance; rack-mounted switches normally belong in a device.cabinet devices[] array.
- deviceUpsDomain (device.ups) — UPS enclosure with optional front door.
- deviceAirConditionerDomain (device.airConditioner) — data-center precision air conditioner.
- statBarDomain/statGridDomain/statPanelDomain/statChartDomain/statLineDomain/statPieDomain/statRingDomain (stat.*) — business statistics and dashboards.
- natureSkyDomain/natureWaterDomain (nature.sky/nature.water) — procedural sky and water.
- weatherRainDomain/weatherWindDomain (weather.rain/weather.wind) — precipitation and wind effects.
- portDomain (port) — dock cranes, ships, RTG cranes and port lamps.
- buildingDomain (floor/wall/glass/door/box) — semantic building primitives when domain dispatch is specifically needed.
- nativeThreeDomain (nativeThree) — external Three.js ObjectLoader JSON.
- sceneHighlightDomain (sceneHighlight) — locate/info/alarm highlight bundles.

Use aggregate ids deviceDomain/statDomain/natureDomain/portDomain only when several children are needed or the exact child is not yet known. Selecting an id requests its detailed contract; it does not require using every feature in that domain.
`;

const THREE_JSON_DEVICE_DOMAIN_CAPABILITY = `
Negotiated device-domain capability (machine rooms, data centers, racks and equipment):

Record contract:
- Emit each device as an objectList record with objType:"domain", a qualified domain id and its deploy handler.
- Prefer domain-specific fields directly on the record. In particular, device.cabinet reads name, label, geometry, position, doors, slots, devices, toward and businessInfo from the cabinet record. Do not hide these fields in an unrelated wrapper or copy the same default position into repeated records.
- Cabinet geometry uses the domain-specific shape {width,length,height}; length is cabinet depth. This is an exception to generic box geometry, which uses depth.
- Useful handlers: device.cabinet/deployCabinet, device.server/deployServer, device.switch/deploySwitch, device.ups/deployUps, device.airConditioner/deployAirConditioner. createCabinet is accepted for compatibility, but deployCabinet states the scene-loading intent more clearly.

Scale and anchoring:
- A practical rack default in this runtime is width 6, length 12, height 20. Treat those three values as one coherent scene scale. Do not combine a 6x12x20 rack with a 10x10 room floor.
- Cabinets are base-anchored: position.y=0 puts the cabinet on a floor whose top is y=0. Standalone UPS/air-conditioner records are center-anchored, so a height-20 unit normally uses position.y=10.
- A multi-rack machine room typically needs a floor tens of units across (for example 60x50 for a modest two-row layout), walls about 22-26 units high, and camera/controls fitted to the full room bounds.

Layout rules (mandatory for repeated full-size equipment):
1. Decide equipment dimensions and row/column counts before sizing the room.
2. Give every cabinet a unique threeJsonId and a distinct x/z center. Adjacent centers must be separated by at least the cabinet width along a row; opposing rows must be separated by at least cabinet length plus the desired aisle. Never place several cabinets at the same coordinates unless the user explicitly requests stacking/overlap.
3. Derive the floor and walls from the occupied equipment bounds plus service aisles and wall margins. Verify every footprint lies inside the room.
4. Use opposing toward values for facing rack rows when appropriate. Put rack-mounted servers/switches in the parent cabinet's devices[] using uStart/uSize; do not scatter them as building-sized standalone objects.
5. Before output, perform a mental collision pass: compare each pair's x/z footprints and fix accidental overlaps; then compare rack height with wall height and camera target.

Compact two-row example (direct fields, distinct positions, coherent room scale):
{"threeJsonId":"machine-room-floor","objType":"floor","geometry":{"width":50,"height":0.5,"depth":44},"position":{"x":0,"y":-0.25,"z":0}}
{"threeJsonId":"rack-01","objType":"domain","domain":"device.cabinet","handler":"deployCabinet","name":"cabinet","label":"Rack 01","geometry":{"width":6,"length":12,"height":20},"position":{"x":-6,"y":0,"z":-10},"toward":"front","slots":{"total":24,"unitHeight":0.48,"bottomMargin":0.77},"devices":[{"deviceType":"server","uStart":24,"uSize":1,"name":"Compute 01"}]}
{"threeJsonId":"rack-02","objType":"domain","domain":"device.cabinet","handler":"deployCabinet","name":"cabinet","label":"Rack 02","geometry":{"width":6,"length":12,"height":20},"position":{"x":0,"y":0,"z":-10},"toward":"front"}
{"threeJsonId":"rack-03","objType":"domain","domain":"device.cabinet","handler":"deployCabinet","name":"cabinet","label":"Rack 03","geometry":{"width":6,"length":12,"height":20},"position":{"x":6,"y":0,"z":10},"toward":"back"}
{"threeJsonId":"rack-04","objType":"domain","domain":"device.cabinet","handler":"deployCabinet","name":"cabinet","label":"Rack 04","geometry":{"width":6,"length":12,"height":20},"position":{"x":0,"y":0,"z":10},"toward":"back"}
`;

const DEVICE_CAPABILITY_IDS = new Set([
  "deviceDomain",
  "deviceCabinetDomain",
  "deviceServerDomain",
  "deviceSwitchDomain",
  "deviceUpsDomain",
  "deviceAirConditionerDomain",
  "domain.device",
  "domain.device.cabinet",
  "domain.device.server",
  "domain.device.switch",
  "domain.device.ups",
  "domain.device.airConditioner"
]);

/**
 * @param {string[]|null|undefined} selectedCapabilityIds
 * @returns {string[]}
 */
function resolveSelectedDomainCapabilityBlocks(selectedCapabilityIds) {
  if (!Array.isArray(selectedCapabilityIds) || selectedCapabilityIds.length === 0) {
    return [];
  }
  const selected = new Set(selectedCapabilityIds.map((id) => String(id || "").trim()).filter(Boolean));
  for (const id of selected) {
    if (DEVICE_CAPABILITY_IDS.has(id)) {
      return [THREE_JSON_DEVICE_DOMAIN_CAPABILITY.trim()];
    }
  }
  return [];
}

export {
  THREE_JSON_DOMAIN_CAPABILITY_INDEX,
  THREE_JSON_DEVICE_DOMAIN_CAPABILITY,
  resolveSelectedDomainCapabilityBlocks
};

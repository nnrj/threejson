/**
 * Legacy objType aliases for jsm / business-semantic geometry (only fills geometry.type; no standalone builder).
 */

/** @type {Record<string, { geometryType: string, defaults?: Record<string, number> }>} */
const LEGACY_GEOMETRY_OBJTYPE_ALIASES = {
  roundedbox: {
    geometryType: "RoundedBoxGeometry",
    defaults: { width: 1, height: 1, depth: 1, radius: 0.1, segments: 4 }
  }
};

function normalizeObjType(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function hasFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * @param {object} record
 * @param {object} geometry
 * @returns {object}
 */
function mergeLegacyDimensionFields(record, geometry) {
  const next = { ...geometry };
  const dimKeys = ["width", "height", "depth", "radius", "segments"];
  for (let i = 0; i < dimKeys.length; i += 1) {
    const key = dimKeys[i];
    if (next[key] === undefined && hasFiniteNumber(record[key])) {
      next[key] = record[key];
    }
  }
  return next;
}

/**
 * @param {object|null|undefined} record
 * @returns {object|null}
 */
export function applyLegacyGeometryObjTypeAlias(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return record ?? null;
  }
  const objType = normalizeObjType(record.objType);
  const alias = LEGACY_GEOMETRY_OBJTYPE_ALIASES[objType];
  if (!alias) {
    return record;
  }
  const next = { ...record };
  let geometry =
    next.geometry && typeof next.geometry === "object" && !Array.isArray(next.geometry)
      ? { ...next.geometry }
      : {};
  geometry = mergeLegacyDimensionFields(next, geometry);
  if (!geometry.type) {
    geometry.type = alias.geometryType;
  }
  if (alias.defaults) {
    for (const key of Object.keys(alias.defaults)) {
      if (geometry[key] === undefined) {
        geometry[key] = alias.defaults[key];
      }
    }
  }
  next.geometry = geometry;
  return next;
}

export { LEGACY_GEOMETRY_OBJTYPE_ALIASES };

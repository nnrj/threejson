/** Pure descriptor projection: do not send materials, scripts, assets or unrelated scene data to a worker. */
export const COMPILED_GEOMETRY_TYPES = new Set([
  "editablemesh", "parametricsurface", "bezierpatch", "nurbssurface", "lathemesh", "lathe",
  "loftmesh", "loft", "sweepmesh", "sweep", "implicitsurface", "sdfmesh"
]);

const PROCEDURAL_FIELDS = ["type", "uSegments", "vSegments", "uRange", "vRange", "x", "y", "z",
  "parameters", "controlPoints", "uDegree", "vDegree", "uKnots", "vKnots", "degreeU", "degreeV",
  "knotsU", "knotsV", "points", "segments", "phiStart", "phiLength", "sections", "closed",
  "path", "profile", "steps", "shape", "radius", "radialSegments", "twist", "scale",
  "resolution", "bounds", "sdf", "isoLevel", "expression", "expressions", "field", "values", "closedProfile", "center", "size"];

export function geometryInputRecord(record) {
  const objType = String(record.objType || "").toLowerCase();
  const input = { objType };
  for (const key of ["geometry", "topology", "modifiers", "uvProjection", "computeTangents", "meshBudget"]) {
    if (record[key] !== undefined) input[key] = record[key];
  }
  if (!record.geometry && objType !== "editablemesh") {
    for (const key of PROCEDURAL_FIELDS) if (record[key] !== undefined) input[key] = record[key];
  }
  return input;
}

export const geometryInputKey = (record) => JSON.stringify(geometryInputRecord(record));

export function collectGeometryRecords(value, result = [], seen = new WeakSet()) {
  if (!value || typeof value !== "object" || ArrayBuffer.isView(value) || seen.has(value)) return result;
  seen.add(value);
  if (Array.isArray(value)) {
    // Coordinates are data, not nested descriptors.
    if (typeof value[0] === "number") return result;
    for (const item of value) collectGeometryRecords(item, result, seen);
  } else {
    if (COMPILED_GEOMETRY_TYPES.has(String(value.objType || "").toLowerCase())) result.push(value);
    for (const [key, item] of Object.entries(value)) {
      if (!["geometry", "topology", "material", "materials", "materialArr", "assetLibrary", "userData", "metadata"].includes(key)) collectGeometryRecords(item, result, seen);
    }
  }
  return result;
}

import { defaultModelingRegistry } from "./registry.js";

const number = (defaultValue, extra = {}) => ({ type: "number", ...(defaultValue !== undefined ? { default: defaultValue } : {}), ...extra });
const positive = (value) => number(value, { exclusiveMinimum: 0 });
const integer = (value, minimum = 1) => ({ type: "integer", default: value, minimum });
const vector = (value, length = 3) => ({ type: "array", items: number(), minItems: length, maxItems: length, ...(value ? { default: value } : {}) });
const object = { type: "object" };
const points = { type: "array", items: vector(), minItems: 2 };
const schema = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const meshInput = { mesh: "mesh" }, meshOutput = { mesh: "mesh" };
const compute = (id) => async (request) => (await import("./meshOperators.js")).evaluateMeshOperator(id, request);
const entries = [
  ["primitive.box", {}, meshOutput, schema({ width: positive(1), height: positive(1), depth: positive(1), widthSegments: integer(1), heightSegments: integer(1), depthSegments: integer(1) }), "Box with independently controlled dimensions and subdivisions."],
  ["primitive.sphere", {}, meshOutput, schema({ radius: positive(1), widthSegments: integer(32, 3), heightSegments: integer(16, 2) }), "UV sphere."],
  ["primitive.cylinder", {}, meshOutput, schema({ radiusTop: number(1, { minimum: 0 }), radiusBottom: number(1, { minimum: 0 }), height: positive(1), radialSegments: integer(32, 3), heightSegments: integer(1), openEnded: { type: "boolean", default: false } }), "Cylinder or cone."],
  ["primitive.torus", {}, meshOutput, schema({ radius: positive(1), tube: positive(0.25), radialSegments: integer(16, 3), tubularSegments: integer(48, 3) }), "Torus."],
  ["mesh.raw", {}, meshOutput, schema({ geometry: object }, ["geometry"]), "Unrestricted BufferGeometry attributes, indices, material groups and morph targets."],
  ["mesh.editable", {}, meshOutput, schema({ topology: object, modifiers: { type: "array", items: object }, uvProjection: { type: "string" }, computeTangents: { type: "boolean" } }, ["topology"]), "Stable-ID control topology evaluated with local subdivision and modeling modifiers."],
  ["mesh.transform", meshInput, meshOutput, schema({ position: vector([0, 0, 0]), rotation: vector([0, 0, 0]), scale: vector([1, 1, 1]) }), "Bake a geometric transform; scene-only movement should use object transforms instead."],
  ["mesh.deform", meshInput, meshOutput, schema({ mode: { type: "string", enum: ["twist", "bend", "taper"] }, amount: number(), origin: vector([0, 0, 0]) }, ["mode", "amount"]), "Continuous Y-axis twist (radians per unit), bend (curvature) or taper (slope). Preserves UV/custom attributes; recalculates normals."],
  ["mesh.merge", { meshes: { type: "mesh", multiple: true } }, meshOutput, schema({}), "Join meshes without boolean union. Compatible attribute layouts are required; material groups are preserved."],
  ["mesh.array", meshInput, { instances: "instances" }, schema({ count: integer(2), offset: vector([1, 0, 0]), rotation: vector([0, 0, 0]), scale: vector([1, 1, 1]) }), "Compact deterministic instances; no copied vertex arrays until realization."],
  ["instances.realize", { instances: "instances" }, meshOutput, schema({}), "Bake instance transforms into one mesh with groups and source ranges."],
  ["curve.polyline", {}, { curve: "curve" }, schema({ points, closed: { type: "boolean", default: false } }, ["points"]), "Explicit 3D polyline, usable as a profile or modeling path."],
  ["curve.bezier", {}, { curve: "curve" }, schema({ points: { ...points, minItems: 4, maxItems: 4 }, segments: integer(32) }, ["points"]), "Cubic Bezier control curve, sampled deterministically."],
  ["surface.parametric", {}, { surface: "surface" }, schema({ expressions: object, uRange: vector([0, 1], 2), vRange: vector([0, 1], 2), uSegments: integer(32), vSegments: integer(32), parameters: object }, ["expressions"]), "Parametric surface with expression-based X/Y/Z coordinates."],
  ["surface.bezier", {}, { surface: "surface" }, schema({ controlPoints: { type: "array" }, uSegments: integer(32), vSegments: integer(32) }, ["controlPoints"]), "Tensor-product Bezier patch."],
  ["surface.nurbs", {}, { surface: "surface" }, schema({ controlPoints: { type: "array" }, degreeU: integer(3), degreeV: integer(3), knotsU: { type: "array", items: number() }, knotsV: { type: "array", items: number() }, uSegments: integer(32), vSegments: integer(32) }, ["controlPoints", "knotsU", "knotsV"]), "Rational B-spline surface; weighted control points and explicit knot vectors."],
  ["surface.tessellate", { surface: "surface" }, meshOutput, schema({ uSegments: integer(32), vSegments: integer(32) }), "Convert a surface into its preview/export triangle mesh; surface source remains in the graph."],
  ["curve.sweep", { profile: "curve", path: "curve" }, meshOutput, schema({ steps: integer(64), closed: { type: "boolean", default: false } }), "Sweep a local XY profile along a 3D path."],
  ["curve.loft", { sections: { type: "curve", multiple: true } }, meshOutput, schema({ segments: integer(32, 3), closed: { type: "boolean", default: true } }), "Loft corresponding closed sections, producing an open-ended surface."],
  ["curve.revolve", { profile: "curve" }, meshOutput, schema({ segments: integer(64, 3), phiStart: number(0), phiLength: positive(Math.PI * 2) }), "Revolve an XY radius/height profile around Y."],
  ["field.sphere", {}, { field: "field" }, schema({ center: vector([0, 0, 0]), radius: positive(1) }), "Signed-distance sphere."],
  ["field.box", {}, { field: "field" }, schema({ center: vector([0, 0, 0]), size: vector([1, 1, 1]) }), "Signed-distance box."],
  ["field.combine", { fields: { type: "field", multiple: true } }, { field: "field" }, schema({ operation: { type: "string", enum: ["union", "intersection", "subtract", "smoothUnion"], default: "union" }, smoothing: positive(0.2) }), "Union/intersection/difference or smooth blending of signed-distance fields."],
  ["field.mesh", { field: "field" }, meshOutput, schema({ bounds: object, resolution: integer(32, 2), isoLevel: number(0) }, ["bounds"]), "Extract a triangle mesh from a field within explicit bounds. Uniform sampling, not an exact CAD solid."],
  ["points.explicit", {}, { points: "points" }, schema({ positions: { type: "array", items: vector() } }, ["positions"]), "Explicit points without implied triangles."],
  ["points.sampleCurve", { curve: "curve" }, { points: "points" }, schema({ count: integer(32), includeEnd: { type: "boolean", default: true } }), "Equal-arclength samples of a curve artifact's polyline; exact for that polyline, not the original analytic curve."],
  ["points.scatterMesh", meshInput, { points: "points" }, schema({ count: integer(100), seed: integer(1, 0) }), "Deterministic surface points, weighted by triangle area; includes face normals and face indices."],
  ["points.instance", { points: "points", mesh: "mesh" }, { instances: "instances" }, schema({ scale: vector([1, 1, 1]) }), "Place a mesh at each point without duplicating its source geometry."]
];

export const BUILTIN_MODELING_OPERATOR_IDS = Object.freeze(entries.map(([id]) => id));

/** Idempotent, no imports of CAD, GPU, network providers or raster decoders. */
export function registerBuiltinModelingOperators(registry = defaultModelingRegistry) {
  for (const [id, inputs, outputs, parameters, description] of entries) {
    if (registry.get(id, 1)) continue;
    const backends = { cpu: compute(id) };
    if (id === "mesh.deform") backends.gpu = async (request) => {
      if (!request.context.gpu?.deform) throw new Error("The host did not supply a GPU modeling backend.");
      return request.context.gpu.deform(request);
    };
    registry.register({ id, version: 1, inputs, outputs, parameters, description, category: id.split(".")[0], backends,
      attributes: { policy: id === "mesh.deform" ? "preserve-domain-recompute-normals" : id.startsWith("mesh.") ? "operator-defined" : "generated" } });
  }
  return registry;
}

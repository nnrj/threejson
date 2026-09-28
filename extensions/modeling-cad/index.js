/** Explicit opt-in OCCT adapter. No imports of CAD packages until the host initializes it. */
import { defaultModelingRegistry, modelingError } from "../../core/modeling/registry.js";

const n = (defaultValue, extra = {}) => ({ type: "number", ...(defaultValue !== undefined ? { default: defaultValue } : {}), ...extra });
const positive = (v) => n(v, { exclusiveMinimum: 0 });
const vec = (value, size = 3) => ({ type: "array", minItems: size, maxItems: size, items: n(), ...(value ? { default: value } : {}) });
const params = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const selector = { type: "object", properties: { plane: { type: "string", enum: ["XY", "XZ", "YZ"] }, offset: n(), direction: vec(), box: { type: "object" } }, additionalProperties: false };
const profile = { type: "object", properties: {
  type: { type: "string", enum: ["circle", "rectangle", "polygon"] }, radius: positive(), width: positive(), height: positive(),
  points: { type: "array", minItems: 3, items: vec(null, 2) }, plane: { type: "string", enum: ["XY", "XZ", "YZ"] }, origin: vec()
}, required: ["type"], additionalProperties: false };
const contracts = [
  ["cad.box", {}, { solid: "solid" }, params({ size: vec([1, 1, 1]), origin: vec([0, 0, 0]) }), "Exact box solid; dimensions use scene length units (meters after parameter resolution)."],
  ["cad.cylinder", {}, { solid: "solid" }, params({ radius: positive(0.5), height: positive(1), origin: vec([0, 0, 0]), direction: vec([0, 0, 1]) }), "Exact cylinder solid."],
  ["cad.sphere", {}, { solid: "solid" }, params({ radius: positive(1) }), "Exact sphere solid at the origin."],
  ["cad.boolean", { a: "solid", b: "solid" }, { solid: "solid" }, params({ operation: { type: "string", enum: ["union", "subtract", "intersection"] } }, ["operation"]), "OCCT solid boolean; failures are errors, not substituted primitive meshes."],
  ["cad.fillet", { solid: "solid" }, { solid: "solid" }, params({ radius: positive(), selector }, ["radius"]), "True circular edge fillet; optional geometric edge selection."],
  ["cad.chamfer", { solid: "solid" }, { solid: "solid" }, params({ distance: positive(), selector }, ["distance"]), "Exact planar chamfer; optional geometric edge selection."],
  ["cad.shell", { solid: "solid" }, { solid: "solid" }, params({ thickness: n(), selector, tolerance: positive(1e-7) }, ["thickness", "selector"]), "Hollow a solid and remove explicitly selected opening faces."],
  ["cad.extrude", {}, { solid: "solid" }, params({ profile, distance: n(), direction: vec([0, 0, 1]) }, ["profile", "distance"]), "Extrude a closed planar analytic/polygon profile."],
  ["cad.revolve", {}, { solid: "solid" }, params({ profile, axis: vec([0, 1, 0]), origin: vec([0, 0, 0]), angle: positive(Math.PI * 2) }, ["profile"]), "Revolve a closed profile; angle is in radians."],
  ["cad.loft", {}, { solid: "solid" }, params({ profiles: { type: "array", minItems: 2, items: profile }, ruled: { type: "boolean", default: false } }, ["profiles"]), "Exact solid loft between closed profile sections."],
  ["cad.sweep", {}, { solid: "solid" }, params({ profile, path: { type: "array", minItems: 2, items: vec() } }, ["profile", "path"]), "Sweep a positioned closed profile along a 3D polyline; no sketch constraint solver."],
  ["cad.transform", { solid: "solid" }, { solid: "solid" }, params({ position: vec([0, 0, 0]), axis: vec([0, 0, 1]), angle: n(0), scale: positive(1) }), "Uniform scale/axis rotation/translation of an exact solid."],
  ["cad.tessellate", { solid: "solid" }, { mesh: "mesh" }, params({ tolerance: positive(0.001), angularTolerance: positive(0.1) }), "Preview mesh with explicit chord/angular tolerance; preserves the exact solid in graph history."]
];

export function registerCadModelingOperators(provider, registry = defaultModelingRegistry) {
  if (typeof provider?.evaluate !== "function") throw modelingError("CAD_PROVIDER", "A CAD provider with evaluate() is required.");
  const releases = contracts.map(([id, inputs, outputs, parameters, description]) => registry.register({
    id, version: 1, inputs, outputs, parameters, description, category: "cad", backends: { cpu: (request) => provider.evaluate(id, request) },
    attributes: { policy: "exact-brep-and-geometric-selection", units: "m", topologyNames: "geometric selectors; persistent OCCT face IDs are not promised" }
  }));
  return () => releases.forEach((release) => release());
}

export async function createOpenCascadeModelingProvider(options = {}) {
  const r = options.replicad || await import("replicad");
  let oc = options.oc;
  if (!oc) {
    const init = options.initOpenCascade || (await import("replicad-opencascadejs")).default;
    if (!options.wasmUrl && !options.wasmBinary) throw modelingError("CAD_WASM_LOCATION", "Supply a host-owned wasmUrl or wasmBinary; the engine does not pick a CDN or download an undeclared kernel.");
    oc = await init({ ...(options.wasmBinary ? { wasmBinary: options.wasmBinary } : {}),
      ...(options.wasmUrl ? { locateFile: (name) => name.endsWith(".wasm") ? String(options.wasmUrl) : name } : {}),
      print: options.onLog || (() => {}), printErr: options.onDiagnostic || (() => {}) });
  }
  let disposed = false;
  const activate = () => { if (disposed) throw modelingError("CAD_DISPOSED", "CAD provider is disposed."); r.setOC(oc); };
  const deserialize = (artifact) => {
    if (artifact?.type !== "solid" || artifact.kernel !== "occt" || artifact.format !== "replicad-brep@1" || artifact.unit !== "m") throw modelingError("CAD_SOLID_FORMAT", "Incompatible CAD solid artifact.");
    return r.deserializeShape(artifact.brep).asShape3D();
  };
  function sketch(p) {
    const plane = p.plane || "XY", origin = p.origin || [0, 0, 0];
    if (p.type === "circle") {
      if (!(p.radius > 0)) throw modelingError("CAD_PROFILE", "Circle profile needs a positive radius.");
      return r.sketchCircle(p.radius, { plane, origin });
    }
    if (p.type === "rectangle") {
      if (!(p.width > 0 && p.height > 0)) throw modelingError("CAD_PROFILE", "Rectangle profile needs positive width/height.");
      return r.sketchRectangle(p.width, p.height, { plane, origin });
    }
    if (p.type !== "polygon" || !Array.isArray(p.points) || p.points.length < 3) throw modelingError("CAD_PROFILE", "A polygon profile needs three or more 2D points.");
    const builder = new r.Sketcher(plane, origin).movePointerTo(p.points[0]);
    try { for (const point of p.points.slice(1)) builder.lineTo(point); return builder.close(); }
    catch (error) { builder.delete(); throw error; }
  }
  function select(finder, specification) {
    if (!specification || !Object.keys(specification).length) throw modelingError("CAD_SELECTOR", "An empty geometric selector would select every face/edge.");
    if (specification.plane) finder.inPlane(specification.plane, specification.offset || 0);
    if (specification.direction) {
      if (!finder.inDirection) throw modelingError("CAD_SELECTOR", "Direction selectors apply to edges; select faces by plane or bounds.");
      finder.inDirection(specification.direction);
    }
    if (specification.box) finder.inBox(specification.box.min, specification.box.max);
    return finder;
  }
  return {
    async evaluate(id, { params: p, inputs = {}, signal, nodeId }) {
      signal?.throwIfAborted(); activate();
      const owned = new Set(); const own = (value) => { if (value?.delete) owned.add(value); return value; };
      try {
        let solid;
        if (id === "cad.box") {
          if (p.size.some((v) => v <= 0)) throw modelingError("CAD_DIMENSION", "Box dimensions must be positive.");
          solid = own(r.makeBox(p.origin, p.origin.map((v, i) => v + p.size[i])));
        } else if (id === "cad.cylinder") solid = own(r.makeCylinder(p.radius, p.height, p.origin, p.direction));
        else if (id === "cad.sphere") solid = own(r.makeSphere(p.radius));
        else if (id === "cad.boolean") {
          const a = own(deserialize(inputs.a)), b = own(deserialize(inputs.b));
          solid = own(p.operation === "union" ? a.fuse(b) : p.operation === "subtract" ? a.cut(b) : a.intersect(b));
        } else if (id === "cad.fillet" || id === "cad.chamfer") {
          const input = own(deserialize(inputs.solid));
          solid = own(input[id === "cad.fillet" ? "fillet" : "chamfer"](p.radius ?? p.distance, p.selector ? (finder) => select(finder, p.selector) : undefined));
        } else if (id === "cad.shell") {
          if (!p.thickness) throw modelingError("CAD_THICKNESS", "Shell thickness must not be zero.");
          solid = own(own(deserialize(inputs.solid)).shell(p.thickness, (finder) => select(finder, p.selector), p.tolerance));
        } else if (id === "cad.extrude" || id === "cad.revolve") {
          const source = own(sketch(p.profile));
          solid = own(id === "cad.extrude" ? source.extrude(p.distance, { extrusionDirection: p.direction }) : source.revolve(p.axis, { origin: p.origin, angle: p.angle * 180 / Math.PI }));
        } else if (id === "cad.loft") {
          const sections = p.profiles.map((p) => own(sketch(p)));
          solid = own(sections[0].loftWith(sections.slice(1), { ruled: p.ruled }));
        } else if (id === "cad.sweep") {
          const section = own(sketch(p.profile)), edges = [];
          for (let i = 1; i < p.path.length; i++) edges.push(own(r.makeLine(p.path[i - 1], p.path[i])));
          const spine = own(r.assembleWire(edges));
          solid = own(r.genericSweep(section.wire, spine, {}));
        } else if (id === "cad.transform") {
          solid = own(deserialize(inputs.solid));
          if (p.scale !== 1) solid = own(solid.scale(p.scale));
          if (p.angle) solid = own(solid.rotate(p.angle * 180 / Math.PI, [0, 0, 0], p.axis));
          solid = own(solid.translate(p.position));
        } else if (id === "cad.tessellate") {
          const shape = own(deserialize(inputs.solid)), mesh = shape.mesh({ tolerance: p.tolerance, angularTolerance: p.angularTolerance });
          return { mesh: { type: "mesh", geometry: {
            attributes: { position: { array: new Float32Array(mesh.vertices), itemSize: 3, type: "Float32Array" }, normal: { array: new Float32Array(mesh.normals), itemSize: 3, type: "Float32Array" } },
            index: { array: new Uint32Array(mesh.triangles), itemSize: 1, type: "Uint32Array" },
            groups: mesh.faceGroups.map((g) => ({ start: g.start, count: g.count, materialIndex: 0 }))
          }, stats: { vertices: mesh.vertices.length / 3, triangles: mesh.triangles.length / 3 },
          provenance: { source: nodeId, kernel: "occt", faceRanges: mesh.faceGroups.map((g, i) => ({ start: g.start / 3, count: g.count / 3, face: i, persistent: false })) } } };
        } else throw modelingError("CAD_OPERATOR", `Unknown CAD operator ${id}.`);
        if (!solid || solid.isNull) throw modelingError("CAD_EMPTY_SOLID", `${id} produced no solid.`);
        signal?.throwIfAborted();
        const volume = r.measureVolume(solid);
        if (!(volume > 0)) throw modelingError("CAD_INVALID_SOLID", `${id} did not produce a positive-volume solid.`);
        return { solid: { type: "solid", kernel: "occt", format: "replicad-brep@1", unit: "m", brep: solid.serialize(), stats: { volume }, provenance: { source: nodeId } } };
      } finally {
        for (const value of [...owned].reverse()) { try { value.delete(); } catch { /* consuming OCCT operations may already have released wrappers */ } }
      }
    },
    async exportSTEP(artifact, { unit = "MM", name = "ThreeJSON model" } = {}) {
      activate();
      if (!["M", "CM", "MM", "INCH", "FT"].includes(String(unit).toUpperCase())) throw modelingError("CAD_UNIT", "Unsupported STEP unit.");
      const shape = deserialize(artifact);
      try { return r.exportSTEP([{ shape, name }], { unit: String(unit).toUpperCase(), modelUnit: "M" }); }
      finally { shape.delete(); }
    },
    dispose() { disposed = true; }
  };
}

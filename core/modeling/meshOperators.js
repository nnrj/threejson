import * as THREE from "three";
import { createGeometryFromDescriptor } from "../builder/geometry/geometryFactory.js";
import { buildBufferMeshGeometry } from "../geometry/bufferMeshGeometry.js";
import { evaluateEditableMeshGeometry } from "../geometry/editableMeshGeometry.js";
import { evaluateProceduralMeshGeometry } from "../geometry/proceduralMeshGeometry.js";
import { createGeometryCurve } from "../geometry/geometryCurve.js";
import { modelingError } from "./registry.js";

export function geometryToModelingMesh(geometry, provenance = {}) {
  const attribute = (value) => ({ array: value.array.slice(), type: value.array.constructor.name, itemSize: value.itemSize, normalized: value.normalized === true });
  geometry.computeBoundingBox();
  const count = geometry.index?.count ?? geometry.attributes.position.count;
  const data = {
    attributes: Object.fromEntries(Object.entries(geometry.attributes).map(([key, value]) => [key, attribute(value)])),
    ...(geometry.index ? { index: attribute(geometry.index) } : {}), groups: structuredClone(geometry.groups),
    drawRange: { start: geometry.drawRange.start, count: Number.isFinite(geometry.drawRange.count) ? geometry.drawRange.count : Math.max(0, count - geometry.drawRange.start) },
    morphTargetsRelative: geometry.morphTargetsRelative,
    morphAttributes: Object.fromEntries(Object.entries(geometry.morphAttributes).map(([name, targets]) => [name, targets.map(attribute)]))
  };
  return { type: "mesh", geometry: data, provenance,
    stats: { vertices: geometry.attributes.position.count, triangles: count / 3 },
    ...(geometry.boundingBox.isEmpty() ? {} : { bounds: { min: geometry.boundingBox.min.toArray(), max: geometry.boundingBox.max.toArray() } }) };
}

export function modelingMeshToGeometry(mesh, options = {}) {
  if (mesh?.type !== "mesh") throw modelingError("MODEL_EXPECTED_MESH", "Only a mesh artifact can be rendered as modeledMesh; tessellate/realize other types explicitly.");
  const built = buildBufferMeshGeometry({ geometry: mesh.geometry }, options);
  if (!built.geometry) throw modelingError(built.code || "MODEL_GEOMETRY", built.error);
  built.geometry.userData.modelingProvenance = structuredClone(mesh.provenance || {});
  return { ...built, stats: { ...built.stats, ...mesh.stats } };
}

function takeBuilt(result, nodeId) {
  if (!result.geometry) throw modelingError(result.code || "MODEL_GEOMETRY", result.error);
  try {
    const geometry = result.geometry;
    return { mesh: geometryToModelingMesh(geometry, { source: nodeId, ...(geometry.userData?.editableMesh?.faceRanges ? { faceRanges: geometry.userData.editableMesh.faceRanges } : {}) }) };
  } finally { result.geometry.dispose(); }
}

const matrix = (p) => new THREE.Matrix4().compose(new THREE.Vector3(...(p.position || [0, 0, 0])),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.rotation || [0, 0, 0]))), new THREE.Vector3(...(p.scale || [1, 1, 1])));

function transformMesh(mesh, transform) {
  if (Math.abs(transform.determinant()) < Number.EPSILON) throw modelingError("MODEL_SINGULAR_TRANSFORM", "A modeling transform must not collapse a dimension; use an object transform for visibility effects.");
  const { geometry } = modelingMeshToGeometry(mesh);
  try {
    if (Object.keys(geometry.morphAttributes).length) throw modelingError("MODEL_MORPH_TRANSFORM", "Bake morph targets before applying geometric modeling transforms; object transforms preserve them.");
    geometry.applyMatrix4(transform);
    if (transform.determinant() < 0) {
      if (!geometry.index) geometry.setIndex(Array.from({ length: geometry.attributes.position.count }, (_, i) => i));
      const array = geometry.index.array;
      for (let i = 0; i < array.length; i += 3) [array[i + 1], array[i + 2]] = [array[i + 2], array[i + 1]];
      if (geometry.attributes.tangent) for (let i = 0; i < geometry.attributes.tangent.count; i++) geometry.attributes.tangent.setW(i, -geometry.attributes.tangent.getW(i));
    }
    return geometryToModelingMesh(geometry, mesh.provenance);
  } finally { geometry.dispose(); }
}

export function deformPositions(array, { mode, amount, origin = [0, 0, 0] }) {
  const result = new Float32Array(array.length);
  for (let i = 0; i < array.length; i += 3) {
    let x = array[i] - origin[0], y = array[i + 1] - origin[1], z = array[i + 2] - origin[2];
    if (mode === "twist") { const a = amount * y, c = Math.cos(a), s = Math.sin(a); [x, z] = [x * c - z * s, x * s + z * c]; }
    else if (mode === "taper") { const s = 1 + amount * y; x *= s; z *= s; }
    else if (mode === "bend" && amount !== 0) { const a = amount * y, r = 1 / amount; [x, y] = [(x + r) * Math.cos(a) - r, (x + r) * Math.sin(a)]; }
    result[i] = x + origin[0]; result[i + 1] = y + origin[1]; result[i + 2] = z + origin[2];
  }
  return result;
}

export function readModelingMeshPositions(mesh) {
  const attribute = mesh.geometry?.attributes?.position;
  if (attribute?.itemSize === 3 && !attribute.normalized && attribute.array) return new Float32Array(attribute.array);
  const { geometry } = modelingMeshToGeometry(mesh);
  try {
    const position = geometry.attributes.position, result = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) result.set([position.getX(i), position.getY(i), position.getZ(i)], i * 3);
    return result;
  } finally { geometry.dispose(); }
}

export function finishDeformedMesh(mesh, positions) {
  const { geometry } = modelingMeshToGeometry(mesh);
  try {
    if (Object.keys(geometry.morphAttributes).length || geometry.attributes.skinWeight) throw modelingError("MODEL_DEFORM_RIGGED", "This deformation operator requires a baked mesh; it does not silently discard skin/morph data.");
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    if (geometry.attributes.tangent) {
      if (geometry.index && geometry.attributes.uv) geometry.computeTangents();
      else throw modelingError("MODEL_TANGENT_LAYOUT", "Recomputing tangents requires indexed geometry and UVs.");
    }
    return { mesh: geometryToModelingMesh(geometry, mesh.provenance) };
  } finally { geometry.dispose(); }
}

async function mergeMeshes(meshes, nodeId) {
  if (!meshes.length) throw modelingError("MODEL_EMPTY_INPUT", "Merging requires at least one mesh.");
  const geometries = [], faceRanges = [];
  let triangleOffset = 0;
  try {
    for (const mesh of meshes) {
      const { geometry } = modelingMeshToGeometry(mesh);
      geometries.push(geometry);
      if (!geometry.index) geometry.setIndex(Array.from({ length: geometry.attributes.position.count }, (_, i) => i));
      // Each source may expose only part of its index buffer. A single merged drawRange cannot
      // represent several disjoint ranges, so bake the visible ranges into the new index data.
      const start = Math.min(geometry.index.count, geometry.drawRange.start);
      const end = Math.min(geometry.index.count, start + geometry.drawRange.count);
      if (start % 3 || (end - start) % 3) throw modelingError("MODEL_TRIANGLE_RANGE", "Merged draw ranges must align with whole triangles.");
      if (start !== 0 || end !== geometry.index.count) {
        const groups = geometry.groups.map((g) => ({ ...g, start: Math.max(start, g.start) - start,
          count: Math.max(0, Math.min(end, g.start + g.count) - Math.max(start, g.start)) })).filter((g) => g.count);
        geometry.setIndex(new THREE.BufferAttribute(geometry.index.array.slice(start, end), 1));
        geometry.clearGroups(); for (const group of groups) geometry.addGroup(group.start, group.count, group.materialIndex);
        geometry.setDrawRange(0, end - start);
      }
      const triangleCount = geometry.index.count / 3;
      faceRanges.push({ start: triangleOffset, count: triangleCount, source: mesh.provenance?.source || nodeId }); triangleOffset += triangleCount;
    }
    const { mergeGeometries } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");
    // Reject mismatched layouts ourselves rather than allowing the Three.js utility to log and return null.
    const signature = (g) => JSON.stringify({ attrs: Object.keys(g.attributes).sort().map((k) => [k, g.attributes[k].itemSize, g.attributes[k].normalized, g.attributes[k].array.constructor.name]), morph: Object.keys(g.morphAttributes).sort().map((k) => [k, g.morphAttributes[k].length]), relative: g.morphTargetsRelative });
    if (geometries.some((g) => signature(g) !== signature(geometries[0]))) throw modelingError("MODEL_ATTRIBUTE_LAYOUT", "Merge inputs must have compatible vertex and morph attribute layouts.");
    const merged = mergeGeometries(geometries, false);
    if (!merged) throw modelingError("MODEL_MERGE_FAILED", "Geometry merge failed.");
    try {
      let offset = 0;
      for (const g of geometries) {
        for (const group of g.groups.length ? g.groups : [{ start: 0, count: g.index.count, materialIndex: 0 }]) merged.addGroup(offset + group.start, group.count, group.materialIndex);
        offset += g.index.count;
      }
      return { mesh: geometryToModelingMesh(merged, { source: nodeId, faceRanges }) };
    } finally { merged.dispose(); }
  } finally { for (const g of geometries) g.dispose(); }
}

export async function evaluateMeshOperator(id, { params: p, inputs, nodeId, context = {}, signal }) {
  signal?.throwIfAborted();
  if (id.startsWith("primitive.")) return takeBuilt({ geometry: createGeometryFromDescriptor({ objType: id.slice(10), geometry: p }) }, nodeId);
  if (id === "mesh.raw") return takeBuilt(buildBufferMeshGeometry({ geometry: p.geometry }, context), nodeId);
  if (id === "mesh.editable") return takeBuilt(evaluateEditableMeshGeometry({ objType: "editableMesh", ...p }, context), nodeId);
  if (id === "mesh.transform") return { mesh: transformMesh(inputs.mesh, matrix(p)) };
  if (id === "mesh.deform") return finishDeformedMesh(inputs.mesh, deformPositions(readModelingMeshPositions(inputs.mesh), p));
  if (id === "mesh.merge") return mergeMeshes(inputs.meshes, nodeId);
  if (id === "mesh.array" || id === "points.instance") {
    const transforms = [];
    if (id === "points.instance") for (const position of inputs.points.positions) transforms.push(matrix({ position, scale: p.scale }).toArray());
    else {
      const step = matrix({ position: p.offset, rotation: p.rotation, scale: p.scale }), current = new THREE.Matrix4();
      for (let i = 0; i < p.count; i++) { transforms.push(current.toArray()); current.multiply(step); }
    }
    return { instances: { type: "instances", mesh: inputs.mesh, transforms, provenance: { source: nodeId } } };
  }
  if (id === "instances.realize") return mergeMeshes(inputs.instances.transforms.map((m) => transformMesh(inputs.instances.mesh, new THREE.Matrix4().fromArray(m))), nodeId);
  if (id === "points.explicit") return { points: { type: "points", positions: p.positions, provenance: { source: nodeId } } };
  if (id === "curve.polyline") return { curve: { type: "curve", points: p.points, closed: p.closed, provenance: { source: nodeId } } };
  if (id === "curve.bezier") {
    const curve = new THREE.CubicBezierCurve3(...p.points.map((v) => new THREE.Vector3(...v)));
    return { curve: { type: "curve", points: curve.getPoints(p.segments).map((v) => v.toArray()), closed: false, provenance: { source: nodeId } } };
  }
  if (["surface.parametric", "surface.bezier", "surface.nurbs"].includes(id)) {
    if (id === "surface.nurbs") validateNurbs(p);
    return { surface: { type: "surface", descriptor: { objType: { "surface.parametric": "parametricSurface", "surface.bezier": "bezierPatch", "surface.nurbs": "nurbsSurface" }[id], geometry: p }, provenance: { source: nodeId } } };
  }
  if (id === "surface.tessellate") return takeBuilt(evaluateProceduralMeshGeometry({ ...inputs.surface.descriptor, geometry: { ...inputs.surface.descriptor.geometry, ...p } }, context), nodeId);
  if (id === "curve.sweep") {
    const closed = p.closed || inputs.path.closed;
    const pathPoints = closed ? [...inputs.path.points, inputs.path.points[0]] : inputs.path.points;
    return takeBuilt(evaluateProceduralMeshGeometry({ objType: "sweepMesh", geometry: { segments: p.steps, profile: inputs.profile.points.map(([x, y]) => [x, y]), path: { type: "line", points: pathPoints, closed }, closedProfile: inputs.profile.closed } }, context), nodeId);
  }
  if (id === "curve.loft") {
    if (inputs.sections.length < 2) throw modelingError("MODEL_LOFT_SECTIONS", "Loft needs two or more sections.");
    const sections = inputs.sections.map((c) => {
      if (c.points.length < 3) throw modelingError("MODEL_LOFT_SECTIONS", "A loft section needs three or more points.");
      const curve = createGeometryCurve({ type: "line", points: p.closed ? [...c.points, c.points[0]] : c.points });
      return Array.from({ length: p.segments }, (_, i) => curve.getPoint(i / (p.closed ? p.segments : p.segments - 1)).toArray());
    });
    return takeBuilt(evaluateProceduralMeshGeometry({ objType: "loftMesh", geometry: { closed: p.closed, sections } }, context), nodeId);
  }
  if (id === "curve.revolve") return takeBuilt(evaluateProceduralMeshGeometry({ objType: "latheMesh", geometry: { ...p, points: inputs.profile.points.map(([x, y]) => [x, y]) } }, context), nodeId);
  if (id === "field.sphere" || id === "field.box") {
    if (p.size?.some((v) => v <= 0)) throw modelingError("MODEL_FIELD_SIZE", "Box dimensions must be positive.");
    return { field: { type: "field", sdf: { type: id.slice(6), ...p }, provenance: { source: nodeId } } };
  }
  if (id === "field.combine") {
    if (inputs.fields.length < 2) throw modelingError("MODEL_FIELD_INPUTS", "Combining fields needs at least two inputs.");
    const fields = inputs.fields.map((f) => f.sdf);
    const children = p.operation === "subtract" && fields.length > 2 ? [fields[0], { type: "union", children: fields.slice(1) }] : fields;
    return { field: { type: "field", sdf: { type: p.operation, smoothness: p.smoothing, children }, provenance: { source: nodeId } } };
  }
  if (id === "field.mesh") return takeBuilt(evaluateProceduralMeshGeometry({ objType: "implicitSurface", geometry: { ...p, sdf: inputs.field.sdf } }, context), nodeId);
  throw modelingError("MODEL_OPERATOR_MISSING", `No implementation for ${id}.`);
}

function validateNurbs(p) {
  const rows = p.controlPoints, columns = rows[0]?.length;
  if (!columns || rows.some((row) => !Array.isArray(row) || row.length !== columns || row.some((point) => !Array.isArray(point) || ![3, 4].includes(point.length) || point.some((n) => !Number.isFinite(n)) || (point.length === 4 && point[3] <= 0)))) throw modelingError("MODEL_NURBS_CONTROL", "NURBS requires a rectangular grid of finite [x,y,z,weight?] control points and positive weights.");
  for (const [count, degree, knots] of [[columns, p.degreeU, p.knotsU], [rows.length, p.degreeV, p.knotsV]]) {
    if (degree >= count || knots.length !== count + degree + 1 || knots.some((v, i) => !Number.isFinite(v) || (i > 0 && v < knots[i - 1])) || knots[degree] >= knots[count]) throw modelingError("MODEL_NURBS_KNOTS", "NURBS degree, control count and nondecreasing knot vector are inconsistent.");
  }
}

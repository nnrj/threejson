/** Compact procedural descriptions for smooth/free-form meshes. */
import * as THREE from "three";
import { evaluateNumericExpression } from "../util/numericExpression.js";
import { log } from "../util/logger.js";
import { trackDisposableResource } from "../handler/trackedResourceRegistry.js";
import { registerObject } from "../handler/objectRegistry.js";
import { setUserDataObjJson } from "../handler/objectDescriptorAttach.js";
import { buildBufferMeshMaterials, applyBufferMeshRecord } from "./bufferMeshBuilder.js";
import { validateBufferMeshStats } from "./bufferMeshLimits.js";

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function point3(value) {
  if (Array.isArray(value)) return [finite(value[0]), finite(value[1]), finite(value[2])];
  return [finite(value?.x), finite(value?.y), finite(value?.z)];
}

function point2(value) {
  if (Array.isArray(value)) return [finite(value[0]), finite(value[1])];
  return [finite(value?.x ?? value?.radius), finite(value?.y)];
}

function gridGeometry(sample, uSegments, vSegments, closedU = false, closedV = false) {
  const uCount = uSegments + 1;
  const vCount = vSegments + 1;
  const positions = new Float32Array(uCount * vCount * 3);
  for (let v = 0; v <= vSegments; v += 1) {
    for (let u = 0; u <= uSegments; u += 1) {
      const sampleU = closedU && u === uSegments ? 0 : u;
      const sampleV = closedV && v === vSegments ? 0 : v;
      const p = sample(u / uSegments, v / vSegments, sampleU, sampleV);
      positions.set(point3(p), (v * uCount + u) * 3);
    }
  }
  const indices = [];
  for (let v = 0; v < vSegments; v += 1) {
    for (let u = 0; u < uSegments; u += 1) {
      const a = v * uCount + u;
      const b = a + 1;
      const d = (v + 1) * uCount + u;
      const c = d + 1;
      indices.push(a, b, d, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const IndexArray = (positions.length / 3) > 65535 ? Uint32Array : Uint16Array;
  geometry.setIndex(new THREE.BufferAttribute(new IndexArray(indices), 1));
  const uvs = new Float32Array(uCount * vCount * 2);
  for (let v = 0; v <= vSegments; v += 1) for (let u = 0; u <= uSegments; u += 1) uvs.set([u / uSegments, v / vSegments], (v * uCount + u) * 2);
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function buildParametricGeometry(descriptor) {
  const uSegments = Math.max(1, Math.round(finite(descriptor.uSegments, 32)));
  const vSegments = Math.max(1, Math.round(finite(descriptor.vSegments, 16)));
  const rangeU = Array.isArray(descriptor.uRange) ? descriptor.uRange : [0, 1];
  const rangeV = Array.isArray(descriptor.vRange) ? descriptor.vRange : [0, 1];
  const expressions = descriptor.expressions || descriptor.expression || {};
  if (![expressions.x, expressions.y, expressions.z].every((value) => typeof value === "string")) {
    throw new Error("parametricSurface requires geometry.expressions {x,y,z}.");
  }
  return gridGeometry((tu, tv) => {
    const u = finite(rangeU[0]) + (finite(rangeU[1], 1) - finite(rangeU[0])) * tu;
    const v = finite(rangeV[0]) + (finite(rangeV[1], 1) - finite(rangeV[0])) * tv;
    const variables = { u, v, s: tu, t: tv };
    return [
      evaluateNumericExpression(expressions.x, variables),
      evaluateNumericExpression(expressions.y, variables),
      evaluateNumericExpression(expressions.z, variables)
    ];
  }, uSegments, vSegments);
}

function binomial(n, k) {
  let result = 1;
  for (let i = 1; i <= k; i += 1) result = result * (n - (k - i)) / i;
  return result;
}

function bernstein(n, i, t) {
  return binomial(n, i) * (t ** i) * ((1 - t) ** (n - i));
}

function buildBezierPatchGeometry(descriptor) {
  const rows = Array.isArray(descriptor.controlPoints) ? descriptor.controlPoints : [];
  if (rows.length < 2 || !rows.every((row) => Array.isArray(row) && row.length >= 2 && row.length === rows[0].length)) {
    throw new Error("bezierPatch requires a rectangular controlPoints grid of at least 2x2.");
  }
  const controls = rows.map((row) => row.map(point3));
  const uDegree = controls[0].length - 1;
  const vDegree = controls.length - 1;
  return gridGeometry((u, v) => {
    const p = new THREE.Vector3();
    for (let j = 0; j <= vDegree; j += 1) for (let i = 0; i <= uDegree; i += 1) {
      p.addScaledVector(new THREE.Vector3(...controls[j][i]), bernstein(uDegree, i, u) * bernstein(vDegree, j, v));
    }
    return p.toArray();
  }, Math.max(1, Math.round(finite(descriptor.uSegments, 32))), Math.max(1, Math.round(finite(descriptor.vSegments, 32))));
}

function bsplineBasis(i, degree, t, knots) {
  if (degree === 0) return (knots[i] <= t && t < knots[i + 1]) || (t === knots[knots.length - 1] && t === knots[i + 1]) ? 1 : 0;
  const leftDenominator = knots[i + degree] - knots[i];
  const rightDenominator = knots[i + degree + 1] - knots[i + 1];
  const left = leftDenominator ? ((t - knots[i]) / leftDenominator) * bsplineBasis(i, degree - 1, t, knots) : 0;
  const right = rightDenominator ? ((knots[i + degree + 1] - t) / rightDenominator) * bsplineBasis(i + 1, degree - 1, t, knots) : 0;
  return left + right;
}

function uniformClampedKnots(controlCount, degree) {
  const total = controlCount + degree + 1;
  const knots = [];
  for (let i = 0; i < total; i += 1) {
    if (i <= degree) knots.push(0);
    else if (i >= controlCount) knots.push(1);
    else knots.push((i - degree) / (controlCount - degree));
  }
  return knots;
}

function buildNurbsSurfaceGeometry(descriptor) {
  const rows = Array.isArray(descriptor.controlPoints) ? descriptor.controlPoints : [];
  if (rows.length < 2 || !rows.every((row) => Array.isArray(row) && row.length >= 2 && row.length === rows[0].length)) {
    throw new Error("nurbsSurface requires a rectangular controlPoints grid of at least 2x2.");
  }
  const degreeU = Math.max(1, Math.min(rows[0].length - 1, Math.round(finite(descriptor.degreeU, 3))));
  const degreeV = Math.max(1, Math.min(rows.length - 1, Math.round(finite(descriptor.degreeV, 3))));
  const knotsU = Array.isArray(descriptor.knotsU) ? descriptor.knotsU.map(Number) : uniformClampedKnots(rows[0].length, degreeU);
  const knotsV = Array.isArray(descriptor.knotsV) ? descriptor.knotsV.map(Number) : uniformClampedKnots(rows.length, degreeV);
  const controls = rows.map((row) => row.map((value) => {
    const p = point3(value);
    return { p: new THREE.Vector3(...p), w: finite(value?.w ?? value?.[3], 1) };
  }));
  const uMin = knotsU[degreeU];
  const uMax = knotsU[knotsU.length - degreeU - 1];
  const vMin = knotsV[degreeV];
  const vMax = knotsV[knotsV.length - degreeV - 1];
  return gridGeometry((su, sv) => {
    const u = THREE.MathUtils.lerp(uMin, uMax, su);
    const v = THREE.MathUtils.lerp(vMin, vMax, sv);
    const numerator = new THREE.Vector3();
    let denominator = 0;
    for (let j = 0; j < controls.length; j += 1) for (let i = 0; i < controls[j].length; i += 1) {
      const weight = controls[j][i].w * bsplineBasis(i, degreeU, u, knotsU) * bsplineBasis(j, degreeV, v, knotsV);
      numerator.addScaledVector(controls[j][i].p, weight);
      denominator += weight;
    }
    return denominator ? numerator.multiplyScalar(1 / denominator).toArray() : [0, 0, 0];
  }, Math.max(1, Math.round(finite(descriptor.uSegments, 32))), Math.max(1, Math.round(finite(descriptor.vSegments, 32))));
}

function buildLatheGeometry(descriptor) {
  const profile = (descriptor.profile || descriptor.points || []).map(point2).map(([radius, y]) => new THREE.Vector2(radius, y));
  if (profile.length < 2) throw new Error("latheMesh requires geometry.profile with at least two [radius,y] points.");
  const segments = Math.max(3, Math.round(finite(descriptor.segments, 32)));
  const phiStart = finite(descriptor.phiStart, 0);
  const phiLength = finite(descriptor.phiLength, Math.PI * 2);
  const geometry = new THREE.LatheGeometry(profile, segments, phiStart, phiLength);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function resamplePolyline(points, count, closed) {
  const source = points.map((point) => new THREE.Vector3(...point3(point)));
  if (source.length === count) return source;
  const curve = new THREE.CatmullRomCurve3(source, closed, "centripetal");
  return Array.from({ length: count }, (_, index) => curve.getPoint(closed ? index / count : index / Math.max(1, count - 1)));
}

function buildLoftGeometry(descriptor) {
  const sections = Array.isArray(descriptor.sections) ? descriptor.sections : [];
  if (sections.length < 2 || sections.some((section) => !Array.isArray(section) || section.length < 3)) throw new Error("loftMesh requires at least two sections with three or more points.");
  const closed = descriptor.closed !== false;
  const count = Math.max(...sections.map((section) => section.length));
  const sampled = sections.map((section) => resamplePolyline(section, count, closed));
  return gridGeometry((u, v, ui, vi) => sampled[vi][Math.min(ui, count - 1)].toArray(), count - (closed ? 0 : 1), sampled.length - 1, closed, false);
}

function buildSweepGeometry(descriptor) {
  const profile = (descriptor.profile || []).map(point2);
  const pathPoints = (descriptor.path?.points || descriptor.path || []).map(point3).map((point) => new THREE.Vector3(...point));
  if (profile.length < 2 || pathPoints.length < 2) throw new Error("sweepMesh requires a 2D profile and a 3D path.");
  const path = new THREE.CatmullRomCurve3(pathPoints, descriptor.path?.closed === true, descriptor.path?.curveType || "centripetal");
  const segments = Math.max(1, Math.round(finite(descriptor.segments, 48)));
  const frames = path.computeFrenetFrames(segments, descriptor.path?.closed === true);
  const closedProfile = descriptor.closedProfile !== false;
  return gridGeometry((u, v, ui, vi) => {
    const index = Math.min(segments, vi);
    const center = path.getPoint(v);
    const [x, y] = profile[Math.min(profile.length - 1, ui)];
    return center.addScaledVector(frames.normals[index], x).addScaledVector(frames.binormals[index], y).toArray();
  }, profile.length - (closedProfile ? 0 : 1), segments, closedProfile, false);
}

function sdfBox(point, descriptor) {
  const center = new THREE.Vector3(...point3(descriptor.center));
  const size = new THREE.Vector3(...point3(descriptor.size || [1, 1, 1])).multiplyScalar(0.5);
  const q = point.clone().sub(center);
  q.set(Math.abs(q.x) - size.x, Math.abs(q.y) - size.y, Math.abs(q.z) - size.z);
  const outside = new THREE.Vector3(Math.max(q.x, 0), Math.max(q.y, 0), Math.max(q.z, 0)).length();
  return outside + Math.min(Math.max(q.x, q.y, q.z), 0);
}

function evaluateSdf(node, point) {
  if (!node || typeof node !== "object") return Infinity;
  const type = String(node.type || "sphere").trim().toLowerCase();
  if (type === "sphere") return point.distanceTo(new THREE.Vector3(...point3(node.center))) - Math.abs(finite(node.radius, 1));
  if (type === "box") return sdfBox(point, node);
  if (type === "torus") {
    const local = point.clone().sub(new THREE.Vector3(...point3(node.center)));
    const major = Math.abs(finite(node.majorRadius, 1));
    const minor = Math.abs(finite(node.minorRadius, 0.25));
    return new THREE.Vector2(new THREE.Vector2(local.x, local.z).length() - major, local.y).length() - minor;
  }
  if (type === "capsule") {
    const a = new THREE.Vector3(...point3(node.a || [0, -1, 0]));
    const b = new THREE.Vector3(...point3(node.b || [0, 1, 0]));
    const pa = point.clone().sub(a);
    const ba = b.clone().sub(a);
    const h = THREE.MathUtils.clamp(pa.dot(ba) / Math.max(ba.dot(ba), 1e-12), 0, 1);
    return pa.sub(ba.multiplyScalar(h)).length() - Math.abs(finite(node.radius, 0.5));
  }
  const children = Array.isArray(node.children) ? node.children : [node.a, node.b].filter(Boolean);
  if (type === "union") return Math.min(...children.map((child) => evaluateSdf(child, point)));
  if (type === "intersection") return Math.max(...children.map((child) => evaluateSdf(child, point)));
  if (type === "subtract" && children.length >= 2) return Math.max(evaluateSdf(children[0], point), -evaluateSdf(children[1], point));
  if (type === "smoothunion") {
    const k = Math.max(1e-9, Math.abs(finite(node.smoothness, 0.2)));
    if (children.length === 0) return Infinity;
    return children.slice(1).reduce((a, child) => {
      const b = evaluateSdf(child, point);
      const h = THREE.MathUtils.clamp(0.5 + 0.5 * (b - a) / k, 0, 1);
      return THREE.MathUtils.lerp(b, a, h) - k * h * (1 - h);
    }, evaluateSdf(children[0], point));
  }
  if (type === "expression" && typeof node.value === "string") return evaluateNumericExpression(node.value, { x: point.x, y: point.y, z: point.z });
  return Infinity;
}

const TETRAHEDRA = Object.freeze([[0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6]]);
const CUBE_CORNERS = Object.freeze([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]);

function interpolateIso(a, b, va, vb, iso) {
  const denominator = vb - va;
  const t = Math.abs(denominator) < 1e-12 ? 0.5 : THREE.MathUtils.clamp((iso - va) / denominator, 0, 1);
  return a.clone().lerp(b, t);
}

function polygonizeTetra(points, values, iso, output) {
  const inside = [];
  const outside = [];
  for (let i = 0; i < 4; i += 1) (values[i] <= iso ? inside : outside).push(i);
  if (inside.length === 0 || inside.length === 4) return;
  const edge = (a, b) => interpolateIso(points[a], points[b], values[a], values[b], iso);
  if (inside.length === 1 || inside.length === 3) {
    const invert = inside.length === 3;
    const lone = invert ? outside[0] : inside[0];
    const others = invert ? inside : outside;
    const triangle = others.map((other) => edge(lone, other));
    if (invert) triangle.reverse();
    output.push(...triangle);
    return;
  }
  const [a, b] = inside;
  const [c, d] = outside;
  const ac = edge(a, c);
  const ad = edge(a, d);
  const bc = edge(b, c);
  const bd = edge(b, d);
  output.push(ac, bc, ad, ad.clone(), bc.clone(), bd);
}

function buildImplicitGeometry(descriptor) {
  const resolutionValue = descriptor.resolution;
  const resolution = Array.isArray(resolutionValue)
    ? resolutionValue.map((value) => Math.max(2, Math.round(finite(value, 24))))
    : [0, 1, 2].map(() => Math.max(2, Math.round(finite(resolutionValue, 24))));
  const bounds = descriptor.bounds || {};
  const min = new THREE.Vector3(...point3(bounds.min || [-1.5, -1.5, -1.5]));
  const max = new THREE.Vector3(...point3(bounds.max || [1.5, 1.5, 1.5]));
  const iso = finite(descriptor.isoLevel, 0);
  const nx = resolution[0];
  const ny = resolution[1];
  const nz = resolution[2];
  const field = new Float32Array(nx * ny * nz);
  const index = (x, y, z) => z * nx * ny + y * nx + x;
  const sampleValue = (x, y, z) => {
    if (Array.isArray(descriptor.values) || ArrayBuffer.isView(descriptor.values)) return finite(descriptor.values[index(x, y, z)], Infinity);
    const p = new THREE.Vector3(
      THREE.MathUtils.lerp(min.x, max.x, x / (nx - 1)),
      THREE.MathUtils.lerp(min.y, max.y, y / (ny - 1)),
      THREE.MathUtils.lerp(min.z, max.z, z / (nz - 1))
    );
    return evaluateSdf(descriptor.sdf || descriptor.field, p);
  };
  for (let z = 0; z < nz; z += 1) for (let y = 0; y < ny; y += 1) for (let x = 0; x < nx; x += 1) field[index(x, y, z)] = sampleValue(x, y, z);
  const triangles = [];
  for (let z = 0; z < nz - 1; z += 1) for (let y = 0; y < ny - 1; y += 1) for (let x = 0; x < nx - 1; x += 1) {
    const points = CUBE_CORNERS.map(([dx, dy, dz]) => new THREE.Vector3(
      THREE.MathUtils.lerp(min.x, max.x, (x + dx) / (nx - 1)),
      THREE.MathUtils.lerp(min.y, max.y, (y + dy) / (ny - 1)),
      THREE.MathUtils.lerp(min.z, max.z, (z + dz) / (nz - 1))
    ));
    const values = CUBE_CORNERS.map(([dx, dy, dz]) => field[index(x + dx, y + dy, z + dz)]);
    for (const tetra of TETRAHEDRA) polygonizeTetra(tetra.map((corner) => points[corner]), tetra.map((corner) => values[corner]), iso, triangles);
  }
  if (triangles.length === 0) throw new Error("implicitSurface produced no triangles inside the requested bounds.");
  const positions = new Float32Array(triangles.length * 3);
  triangles.forEach((point, i) => positions.set(point.toArray(), i * 3));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function buildProceduralMeshGeometry(record = {}, options = {}) {
  const descriptor = record.geometry && typeof record.geometry === "object" ? record.geometry : record;
  const type = String(record.objType || descriptor.type || "").trim().toLowerCase();
  let geometry;
  try {
    if (type === "parametricsurface") geometry = buildParametricGeometry(descriptor);
    else if (type === "bezierpatch") geometry = buildBezierPatchGeometry(descriptor);
    else if (type === "nurbssurface") geometry = buildNurbsSurfaceGeometry(descriptor);
    else if (type === "lathemesh" || type === "lathe") geometry = buildLatheGeometry(descriptor);
    else if (type === "loftmesh" || type === "loft") geometry = buildLoftGeometry(descriptor);
    else if (type === "sweepmesh" || type === "sweep") geometry = buildSweepGeometry(descriptor);
    else if (type === "implicitsurface" || type === "sdfmesh") geometry = buildImplicitGeometry(descriptor);
    else throw new Error(`Unsupported procedural mesh type \"${type}\".`);
    const position = geometry.getAttribute("position");
    const stats = {
      vertexCount: position?.count || 0,
      triangleCount: (geometry.index?.count || position?.count || 0) / 3,
      minIndex: 0,
      maxIndex: Math.max(0, (position?.count || 1) - 1),
      byteLength: Object.values(geometry.attributes).reduce((sum, attribute) => sum + (attribute.array?.byteLength || 0), geometry.index?.array?.byteLength || 0)
    };
    const budget = validateBufferMeshStats(stats, options.meshBudget || record.meshBudget || {});
    if (!budget.ok) throw new Error(budget.message);
    trackDisposableResource(geometry);
    return { geometry, stats };
  } catch (error) {
    geometry?.dispose?.();
    return { geometry: null, code: error?.code || "E_PROCEDURAL_MESH_BUILD", error: String(error?.message || error) };
  }
}

export function createProceduralMesh(record, parent, ctx = {}) {
  const built = buildProceduralMeshGeometry(record, { meshBudget: ctx?.meshBudget ?? ctx?.options?.meshBudget });
  if (!built.geometry) {
    log.warn("[proceduralMesh]", built.code, built.error, record?.name || "");
    return null;
  }
  const mesh = new THREE.Mesh(built.geometry, buildBufferMeshMaterials(record));
  trackDisposableResource(mesh);
  applyBufferMeshRecord(mesh, record);
  setUserDataObjJson(mesh, record);
  mesh.userData.threeJsonMeshStats = built.stats;
  parent.add(mesh);
  registerObject(mesh, record, {}, parent);
  return mesh;
}

export const PROCEDURAL_MESH_OBJ_TYPES = Object.freeze(new Set([
  "parametricsurface", "bezierpatch", "nurbssurface", "lathemesh", "lathe", "loftmesh", "loft", "sweepmesh", "sweep", "implicitsurface", "sdfmesh"
]));

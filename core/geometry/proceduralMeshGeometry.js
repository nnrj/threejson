/** Pure procedural surface evaluation; usable in an optional worker. */
import * as THREE from "three";
import { evaluateNumericExpression } from "../util/numericExpression.js";
import { validateBufferMeshStats } from "../builder/bufferMeshLimits.js";
import { createGeometryCurve } from "./geometryCurve.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { inspectGeometryQuality } from "./geometryQuality.js";

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

function assertBudget(stats, budget = {}) {
  for (const [key, value] of Object.entries(stats)) {
    if (!Number.isSafeInteger(value) || value < 0) throw Object.assign(new RangeError(`Procedural ${key} must be a non-negative safe integer.`), { code: "E_PROCEDURAL_ALLOCATION_RANGE" });
  }
  const vertices = stats.vertexCount || 0;
  const checked = validateBufferMeshStats({ triangleCount: 0, ...stats, vertexCount: vertices, minIndex: 0, maxIndex: Math.max(0, vertices - 1) }, budget);
  if (!checked.ok) throw Object.assign(new Error(checked.message), { code: checked.code });
  if (budget.maxSamples != null && Number.isFinite(Number(budget.maxSamples)) && (stats.sampleCount || 0) > Number(budget.maxSamples)) {
    throw Object.assign(new Error(`samples ${stats.sampleCount} exceeds host meshBudget.maxSamples ${budget.maxSamples}`), { code: "E_BUFFER_MESH_BUDGET_EXCEEDED" });
  }
}

function assertGridBudget(uSegments, vSegments, budget) {
  const vertexCount = (uSegments + 1) * (vSegments + 1), triangleCount = uSegments * vSegments * 2;
  assertBudget({ vertexCount, triangleCount, byteLength: vertexCount * 32 + triangleCount * 3 * (vertexCount > 65535 ? 4 : 2) }, budget);
}

function gridGeometry(sample, uSegments, vSegments, closedU = false, closedV = false, smoothSeams = true, budget) {
  assertGridBudget(uSegments, vSegments, budget);
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
  // UV seams keep separate vertices, but a smooth closed surface shares normals.
  // Only join the declared seam, never weld unrelated points or intentional edges.
  if (smoothSeams && (closedU || closedV)) {
    const normal = geometry.getAttribute("normal");
    const groups = new Map();
    for (let v = 0; v <= vSegments; v += 1) for (let u = 0; u <= uSegments; u += 1) {
      if (!(closedU && (u === 0 || u === uSegments) || closedV && (v === 0 || v === vSegments))) continue;
      const key = `${closedU && u === uSegments ? 0 : u}:${closedV && v === vSegments ? 0 : v}`;
      const group = groups.get(key) || [];
      group.push(v * uCount + u); groups.set(key, group);
    }
    for (const group of groups.values()) {
      const sum = new THREE.Vector3();
      const origin = new THREE.Vector3().fromBufferAttribute(geometry.attributes.position, group[0]);
      const matching = group.filter(i => origin.distanceToSquared(new THREE.Vector3().fromBufferAttribute(geometry.attributes.position, i)) < 1e-12);
      for (const i of matching) sum.add(new THREE.Vector3().fromBufferAttribute(normal, i));
      if (sum.lengthSq() > 0) { sum.normalize(); for (const i of matching) normal.setXYZ(i, sum.x, sum.y, sum.z); }
    }
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

// Deterministic error refinement; only authored limits or explicit host budgets
// bound precision. Worker and main-thread evaluation share this implementation.
function surfaceGrid(sample, descriptor, uSegments, vSegments, budget) {
  const tolerance = Number(descriptor.tessellation?.maxError);
  const requestedLimit = descriptor.tessellation?.maxSegments;
  if (requestedLimit != null && (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1)) throw new RangeError("tessellation.maxSegments must be a positive safe integer.");
  const limit = requestedLimit == null ? Infinity : Math.max(uSegments, vSegments, requestedLimit);
  let error = 0;
  if (Number.isFinite(tolerance) && tolerance > 0) {
    for (;;) {
      assertGridBudget(uSegments, vSegments, budget);
      error = 0;
      for (let v = 0; v < vSegments; v++) for (let u = 0; u < uSegments; u++) {
        const p = (a, b) => new THREE.Vector3(...point3(sample(a, b)));
        const a = p(u / uSegments, v / vSegments), b = p((u + 1) / uSegments, v / vSegments);
        const c = p(u / uSegments, (v + 1) / vSegments), d = p((u + 1) / uSegments, (v + 1) / vSegments);
        error = Math.max(error,
          p((u + .5) / uSegments, (v + .5) / vSegments).distanceTo(a.clone().add(b).add(c).add(d).multiplyScalar(.25)),
          p((u + .5) / uSegments, v / vSegments).distanceTo(a.clone().add(b).multiplyScalar(.5)),
          p(u / uSegments, (v + .5) / vSegments).distanceTo(a.clone().add(c).multiplyScalar(.5)));
      }
      if (error <= tolerance || (uSegments >= limit && vSegments >= limit)) break;
      uSegments = Math.min(limit, uSegments * 2); vSegments = Math.min(limit, vSegments * 2);
    }
  }
  const geometry = gridGeometry(sample, uSegments, vSegments, descriptor.closedU === true, descriptor.closedV === true, descriptor.smoothSeams !== false, budget);
  if (Number.isFinite(tolerance) && tolerance > 0) geometry.userData.tessellation = { maxError: tolerance, measuredError: error, converged: error <= tolerance, uSegments, vSegments };
  return geometry;
}

function buildParametricGeometry(descriptor, budget) {
  const uSegments = Math.max(1, Math.round(finite(descriptor.uSegments, 32)));
  const vSegments = Math.max(1, Math.round(finite(descriptor.vSegments, 16)));
  const rangeU = Array.isArray(descriptor.uRange) ? descriptor.uRange : [0, 1];
  const rangeV = Array.isArray(descriptor.vRange) ? descriptor.vRange : [0, 1];
  const expressions = descriptor.expressions || descriptor.expression || {};
  if (![expressions.x, expressions.y, expressions.z].every((value) => typeof value === "string")) {
    throw new Error("parametricSurface requires geometry.expressions {x,y,z}.");
  }
  return surfaceGrid((tu, tv) => {
    const u = finite(rangeU[0]) + (finite(rangeU[1], 1) - finite(rangeU[0])) * tu;
    const v = finite(rangeV[0]) + (finite(rangeV[1], 1) - finite(rangeV[0])) * tv;
    const variables = { u, v, s: tu, t: tv };
    return [
      evaluateNumericExpression(expressions.x, variables),
      evaluateNumericExpression(expressions.y, variables),
      evaluateNumericExpression(expressions.z, variables)
    ];
  }, descriptor, uSegments, vSegments, budget);
}

function binomial(n, k) {
  let result = 1;
  for (let i = 1; i <= k; i += 1) result = result * (n - (k - i)) / i;
  return result;
}

function bernstein(n, i, t) {
  return binomial(n, i) * (t ** i) * ((1 - t) ** (n - i));
}

function buildBezierPatchGeometry(descriptor, budget) {
  const rows = Array.isArray(descriptor.controlPoints) ? descriptor.controlPoints : [];
  if (rows.length < 2 || !rows.every((row) => Array.isArray(row) && row.length >= 2 && row.length === rows[0].length)) {
    throw new Error("bezierPatch requires a rectangular controlPoints grid of at least 2x2.");
  }
  const controls = rows.map((row) => row.map(point3));
  const uDegree = controls[0].length - 1;
  const vDegree = controls.length - 1;
  return surfaceGrid((u, v) => {
    const p = new THREE.Vector3();
    for (let j = 0; j <= vDegree; j += 1) for (let i = 0; i <= uDegree; i += 1) {
      p.addScaledVector(new THREE.Vector3(...controls[j][i]), bernstein(uDegree, i, u) * bernstein(vDegree, j, v));
    }
    return p.toArray();
  }, descriptor, Math.max(1, Math.round(finite(descriptor.uSegments, 32))), Math.max(1, Math.round(finite(descriptor.vSegments, 32))), budget);
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

function buildNurbsSurfaceGeometry(descriptor, budget) {
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
  return surfaceGrid((su, sv) => {
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
  }, descriptor, Math.max(1, Math.round(finite(descriptor.uSegments, 32))), Math.max(1, Math.round(finite(descriptor.vSegments, 32))), budget);
}

function buildLatheGeometry(descriptor, budget) {
  const profile = (descriptor.profile || descriptor.points || []).map(point2).map(([radius, y]) => new THREE.Vector2(radius, y));
  if (profile.length < 2) throw new Error("latheMesh requires geometry.profile with at least two [radius,y] points.");
  const segments = Math.max(3, Math.round(finite(descriptor.segments, 32)));
  assertGridBudget(segments, profile.length - 1, budget);
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

function buildLoftGeometry(descriptor, budget) {
  const sections = Array.isArray(descriptor.sections) ? descriptor.sections : [];
  if (sections.length < 2 || sections.some((section) => !Array.isArray(section) || section.length < 3)) throw new Error("loftMesh requires at least two sections with three or more points.");
  const closed = descriptor.closed !== false;
  const count = Math.max(...sections.map((section) => section.length));
  assertGridBudget(count - (closed ? 0 : 1), sections.length - 1, budget);
  const sampled = sections.map((section) => resamplePolyline(section, count, closed));
  const geometry = gridGeometry((u, v, ui, vi) => sampled[vi][Math.min(ui, count - 1)].toArray(), count - (closed ? 0 : 1), sampled.length - 1, closed, false, descriptor.smoothSeams !== false, budget);
  return closed ? orientSolidGrid(capGridEnds(geometry, count, sampled.length - 1, descriptor), count, sampled.length - 1, descriptor) : geometry;
}

// Closed profiles describe a solid shell. Choose its exterior independently of
// profile point ordering. Virtual end fans make the signed-volume test stable
// even when caps are omitted; UV/hard-edge splits remain completely untouched.
function orientSolidGrid(geometry, profileSegments, pathSegments, descriptor) {
  if (descriptor.orientation === "profile") return geometry;
  const p = geometry.attributes.position, index = geometry.index;
  const origin = new THREE.Vector3().fromBufferAttribute(p, 0);
  const at = i => new THREE.Vector3().fromBufferAttribute(p, i).sub(origin);
  let volume = 0;
  for (let i = 0; i < profileSegments * pathSegments * 6; i += 3) volume += at(index.getX(i)).dot(at(index.getX(i + 1)).cross(at(index.getX(i + 2))));
  for (const [offset, sign] of [[0, -1], [pathSegments * (profileSegments + 1), 1]]) {
    const center = new THREE.Vector3();
    for (let i = 0; i < profileSegments; i++) center.add(at(offset + i));
    center.divideScalar(profileSegments);
    for (let i = 0; i < profileSegments; i++) volume += sign * center.dot(at(offset + i).cross(at(offset + (i + 1) % profileSegments)));
  }
  if (Math.abs(volume) > 1e-20 && (volume < 0) !== (descriptor.orientation === "inward")) {
    for (let i = 0; i < index.count; i += 3) { const b = index.getX(i + 1); index.setX(i + 1, index.getX(i + 2)); index.setX(i + 2, b); }
    const n = geometry.attributes.normal;
    for (let i = 0; i < n.array.length; i++) n.array[i] *= -1;
  }
  return geometry;
}

// Separate cap vertices preserve the deliberate hard boundary and planar UVs.
function capGridEnds(geometry, profileSegments, pathSegments, descriptor) {
  const start = descriptor.capStart ?? descriptor.caps ?? false, end = descriptor.capEnd ?? descriptor.caps ?? false;
  if (!start && !end) return geometry;
  const parts = [geometry], positions = geometry.attributes.position;
  for (const atEnd of [false, true]) {
    if (!(atEnd ? end : start)) continue;
    const offset = atEnd ? pathSegments * (profileSegments + 1) : 0;
    const ring = Array.from({ length: profileSegments }, (_, i) => new THREE.Vector3().fromBufferAttribute(positions, offset + i));
    const normal = new THREE.Vector3();
    for (let i = 0; i < ring.length; i++) normal.add(ring[i].clone().cross(ring[(i + 1) % ring.length]));
    if (normal.lengthSq() < 1e-20) continue;
    normal.normalize();
    const axis = Math.abs(normal.x) > .8 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = axis.addScaledVector(normal, -axis.dot(normal)).normalize(), v = new THREE.Vector3().crossVectors(normal, u);
    const contour = ring.map(p => new THREE.Vector2(p.dot(u), p.dot(v)));
    const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
    const indices = triangles.flatMap(face => {
      const [a, b, c] = face, dot = ring[b].clone().sub(ring[a]).cross(ring[c].clone().sub(ring[a])).dot(normal);
      return (dot > 0) === atEnd ? [a, b, c] : [a, c, b];
    });
    const cap = new THREE.BufferGeometry();
    cap.setAttribute("position", new THREE.Float32BufferAttribute(ring.flatMap(p => p.toArray()), 3));
    cap.setAttribute("uv", new THREE.Float32BufferAttribute(contour.flatMap(p => p.toArray()), 2));
    cap.setIndex(indices); cap.computeVertexNormals(); parts.push(cap);
  }
  if (parts.length === 1) return geometry;
  const merged = mergeGeometries(parts); parts.forEach(part => part.dispose());
  merged.computeBoundingBox(); merged.computeBoundingSphere(); return merged;
}

function buildSweepGeometry(descriptor, budget) {
  const profile = (descriptor.profile || []).map(point2);
  const points = descriptor.path?.points || (Array.isArray(descriptor.path) ? descriptor.path : []);
  const pathPoints = points.map(point3).map((point) => new THREE.Vector3(...point));
  if (profile.length < 2 || (!descriptor.path?.type && pathPoints.length < 2)) throw new Error("sweepMesh requires a 2D profile and a 3D path.");
  const path = descriptor.path?.type
    ? createGeometryCurve(descriptor.path)
    : new THREE.CatmullRomCurve3(pathPoints, descriptor.path?.closed === true, descriptor.path?.curveType || "centripetal");
  if (!path) throw new Error("sweepMesh path could not be evaluated.");
  const segments = Math.max(1, Math.round(finite(descriptor.segments, 48)));
  assertGridBudget(profile.length - (descriptor.closedProfile !== false ? 0 : 1), segments, budget);
  const frames = path.computeFrenetFrames(segments, descriptor.path?.closed === true);
  const closedProfile = descriptor.closedProfile !== false;
  const geometry = gridGeometry((u, v, ui, vi) => {
    const index = Math.min(segments, vi);
    const center = path.getPointAt(v);
    const [px, py] = profile[Math.min(profile.length - 1, ui)];
    const twist = finite(descriptor.twist, 0) * v;
    const x = px * Math.cos(twist) - py * Math.sin(twist), y = px * Math.sin(twist) + py * Math.cos(twist);
    return center.addScaledVector(frames.normals[index], x).addScaledVector(frames.binormals[index], y).toArray();
  }, profile.length - (closedProfile ? 0 : 1), segments, closedProfile, descriptor.path?.closed === true, descriptor.smoothSeams !== false);
  if (!closedProfile) return geometry;
  return orientSolidGrid(descriptor.path?.closed !== true ? capGridEnds(geometry, profile.length, segments, descriptor) : geometry, profile.length, segments, descriptor);
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
  const centroid = indices => indices.reduce((sum, i) => sum.add(points[i]), new THREE.Vector3()).multiplyScalar(1 / indices.length);
  const outward = centroid(outside).sub(centroid(inside));
  const emit = (a, b, c) => {
    const cross = b.clone().sub(a).cross(c.clone().sub(a));
    if (cross.lengthSq() < 1e-24) return;
    if (cross.dot(outward) < 0) output.push(a, c, b);
    else output.push(a, b, c);
  };
  const edge = (a, b) => interpolateIso(points[a], points[b], values[a], values[b], iso);
  if (inside.length === 1 || inside.length === 3) {
    const invert = inside.length === 3;
    const lone = invert ? outside[0] : inside[0];
    const others = invert ? inside : outside;
    const triangle = others.map((other) => edge(lone, other));
    if (invert) triangle.reverse();
    emit(...triangle);
    return;
  }
  const [a, b] = inside;
  const [c, d] = outside;
  const ac = edge(a, c);
  const ad = edge(a, d);
  const bc = edge(b, c);
  const bd = edge(b, d);
  emit(ac, bc, ad); emit(ad.clone(), bc.clone(), bd);
}

function buildImplicitGeometry(descriptor, budget) {
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
  if (resolution.length !== 3 || !resolution.every(Number.isSafeInteger)) throw Object.assign(new RangeError("implicitSurface resolution requires three safe integers."), { code: "E_PROCEDURAL_ALLOCATION_RANGE" });
  assertBudget({ sampleCount: nx * ny * nz, byteLength: nx * ny * nz * 4 }, budget);
  if (![0, 1, 2].every(i => max.getComponent(i) > min.getComponent(i))) throw new Error("implicitSurface bounds must have positive extent.");
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
    if (budget.maxVertices != null || budget.maxTriangles != null || budget.maxBytes != null) assertBudget({ vertexCount: triangles.length, triangleCount: triangles.length / 3, byteLength: triangles.length * 24 }, budget);
  }
  if (triangles.length === 0) throw new Error("implicitSurface produced no triangles inside the requested bounds.");
  const positions = new Float32Array(triangles.length * 3);
  triangles.forEach((point, i) => positions.set(point.toArray(), i * 3));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  if (descriptor.smoothNormals !== false) {
    const steps = max.clone().sub(min).divide(new THREE.Vector3(nx - 1, ny - 1, nz - 1));
    const sampledField = Array.isArray(descriptor.values) || ArrayBuffer.isView(descriptor.values);
    const sampleAt = p => {
      if (!sampledField) return evaluateSdf(descriptor.sdf || descriptor.field, p);
      const q = p.clone().sub(min).divide(steps);
      const dims = [nx, ny, nz], base = [], t = [];
      for (let i = 0; i < 3; i++) { const x = THREE.MathUtils.clamp(q.getComponent(i), 0, dims[i] - 1); base[i] = Math.min(dims[i] - 2, Math.floor(x)); t[i] = x - base[i]; }
      let result = 0;
      for (let z = 0; z < 2; z++) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) result += field[index(base[0] + x, base[1] + y, base[2] + z)] * (x ? t[0] : 1 - t[0]) * (y ? t[1] : 1 - t[1]) * (z ? t[2] : 1 - t[2]);
      return result;
    };
    const epsilon = Math.min(steps.x, steps.y, steps.z) * .001;
    const normals = geometry.getAttribute("normal");
    triangles.forEach((p, i) => {
      const n = new THREE.Vector3();
      for (let axis = 0; axis < 3; axis++) {
        const a = p.clone(), b = p.clone(); a.setComponent(axis, a.getComponent(axis) + epsilon); b.setComponent(axis, b.getComponent(axis) - epsilon);
        n.setComponent(axis, sampleAt(a) - sampleAt(b));
      }
      if (Number.isFinite(n.lengthSq()) && n.lengthSq() > 1e-24) { n.normalize(); normals.setXYZ(i, n.x, n.y, n.z); }
    });
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function evaluateProceduralMeshGeometry(record = {}, options = {}) {
  const descriptor = record.geometry && typeof record.geometry === "object" ? record.geometry : record;
  const type = String(record.objType || descriptor.type || "").trim().toLowerCase();
  let geometry;
  const meshBudget = options.meshBudget ?? record.meshBudget ?? {};
  try {
    if (type === "parametricsurface") geometry = buildParametricGeometry(descriptor, meshBudget);
    else if (type === "bezierpatch") geometry = buildBezierPatchGeometry(descriptor, meshBudget);
    else if (type === "nurbssurface") geometry = buildNurbsSurfaceGeometry(descriptor, meshBudget);
    else if (type === "lathemesh" || type === "lathe") geometry = buildLatheGeometry(descriptor, meshBudget);
    else if (type === "loftmesh" || type === "loft") geometry = buildLoftGeometry(descriptor, meshBudget);
    else if (type === "sweepmesh" || type === "sweep") geometry = buildSweepGeometry(descriptor, meshBudget);
    else if (type === "implicitsurface" || type === "sdfmesh") geometry = buildImplicitGeometry(descriptor, meshBudget);
    else throw new Error(`Unsupported procedural mesh type \"${type}\".`);
    const position = geometry.getAttribute("position");
    const stats = {
      vertexCount: position?.count || 0,
      triangleCount: (geometry.index?.count || position?.count || 0) / 3,
      minIndex: 0,
      maxIndex: Math.max(0, (position?.count || 1) - 1),
      byteLength: Object.values(geometry.attributes).reduce((sum, attribute) => sum + (attribute.array?.byteLength || 0), geometry.index?.array?.byteLength || 0)
    };
    const budget = validateBufferMeshStats(stats, meshBudget);
    if (!budget.ok) throw Object.assign(new Error(budget.message), { code: budget.code });
    return { geometry, stats, ...(options.diagnostics ? { diagnostics: inspectGeometryQuality(geometry, options.diagnostics === true ? {} : options.diagnostics) } : {}) };
  } catch (error) {
    geometry?.dispose?.();
    return { geometry: null, code: error?.code || "E_PROCEDURAL_MESH_BUILD", error: String(error?.message || error) };
  }
}

export const PROCEDURAL_MESH_OBJ_TYPES = Object.freeze(new Set([
  "parametricsurface", "bezierpatch", "nurbssurface", "lathemesh", "lathe", "loftmesh", "loft", "sweepmesh", "sweep", "implicitsurface", "sdfmesh"
]));

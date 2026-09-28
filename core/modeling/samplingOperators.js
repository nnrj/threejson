import { Vector3 } from "three";
import { modelingMeshToGeometry } from "./meshOperators.js";
import { modelingError } from "./registry.js";

export function sampleModelingPoints(id, { params, inputs, nodeId, context, signal }) {
  const positions = [], normals = [], faceIndices = [];
  if (id === "points.sampleCurve") {
    const points = inputs.curve.points.map((p) => new Vector3(...p));
    if (inputs.curve.closed) points.push(points[0].clone());
    const lengths = points.slice(1).map((p, i) => p.distanceTo(points[i])), total = lengths.reduce((a, b) => a + b, 0);
    if (!(total > 0)) throw modelingError("MODEL_ZERO_CURVE", "Cannot sample a zero-length curve.");
    for (let i = 0; i < params.count; i++) {
      signal?.throwIfAborted();
      let d = total * i / (params.includeEnd && !inputs.curve.closed ? Math.max(1, params.count - 1) : params.count), j = 0;
      while (j < lengths.length - 1 && d > lengths[j]) { d -= lengths[j]; j++; }
      positions.push(points[j].clone().lerp(points[j + 1], lengths[j] ? d / lengths[j] : 0).toArray());
    }
  } else {
    const { geometry } = modelingMeshToGeometry(inputs.mesh, context);
    try {
      const attribute = geometry.attributes.position, index = geometry.index, triangles = [], cumulative = [];
      const start = geometry.drawRange.start || 0, end = Math.min(index?.count ?? attribute.count, start + geometry.drawRange.count);
      let total = 0, seed = params.seed >>> 0;
      const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      for (let i = start; i + 2 < end; i += 3) {
        signal?.throwIfAborted();
        const a = new Vector3().fromBufferAttribute(attribute, index ? index.getX(i) : i), b = new Vector3().fromBufferAttribute(attribute, index ? index.getX(i + 1) : i + 1), c = new Vector3().fromBufferAttribute(attribute, index ? index.getX(i + 2) : i + 2);
        const n = b.clone().sub(a).cross(c.clone().sub(a)), area = n.length() / 2;
        if (!area) continue;
        triangles.push({ a, b, c, normal: n.normalize().toArray(), face: Math.floor(i / 3) }); cumulative.push(total += area);
      }
      if (!(total > 0)) throw modelingError("MODEL_ZERO_SURFACE", "Cannot scatter on a mesh without nondegenerate triangles.");
      for (let i = 0; i < params.count; i++) {
        signal?.throwIfAborted();
        const target = random() * total; let low = 0, high = cumulative.length - 1;
        while (low < high) { const mid = Math.floor((low + high) / 2); if (cumulative[mid] <= target) low = mid + 1; else high = mid; }
        const { a, b, c, normal, face } = triangles[low], u = Math.sqrt(random()), v = random();
        positions.push(a.clone().multiplyScalar(1 - u).addScaledVector(b, u * (1 - v)).addScaledVector(c, u * v).toArray()); normals.push(normal); faceIndices.push(face);
      }
    } finally { geometry.dispose(); }
  }
  return { points: { type: "points", positions, ...(normals.length ? { normals, faceIndices } : {}), provenance: { source: nodeId, algorithm: id === "points.sampleCurve" ? "polyline-arclength" : "triangle-area-weighted", seed: params.seed ?? null } } };
}

import { Vector3 } from "three";

/** Read-only diagnostics. Open boundaries are informational: a sheet is valid. */
export function inspectGeometryQuality(geometry, { maxTriangles = 20000, maxVertices = 60000, tolerance = 1e-6 } = {}) {
  const positions = geometry?.getAttribute?.("position"), normals = geometry?.getAttribute?.("normal");
  const result = { vertices: positions?.count || 0, triangles: 0, inspectedTriangles: 0, invalidPositions: 0, invalidNormals: 0, invalidIndices: 0, degenerateTriangles: 0, reversedNormals: 0, boundaryEdges: 0, nonManifoldEdges: 0, inconsistentWindingEdges: 0, complete: true };
  if (!positions) return result;
  maxTriangles = Number.isFinite(maxTriangles) ? Math.max(0, Math.min(200000, Math.floor(maxTriangles))) : 20000;
  maxVertices = Number.isFinite(maxVertices) ? Math.max(0, Math.min(600000, Math.floor(maxVertices))) : 60000;
  tolerance = Number.isFinite(tolerance) && tolerance > 0 ? tolerance : 1e-6;
  result.inspectedVertices = Math.min(positions.count, maxVertices);
  for (let i = 0; i < result.inspectedVertices; i++) {
    if (![positions.getX(i), positions.getY(i), positions.getZ(i)].every(Number.isFinite)) result.invalidPositions++;
    if (normals && (![normals.getX(i), normals.getY(i), normals.getZ(i)].every(Number.isFinite) || Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i)) < 1e-8)) result.invalidNormals++;
  }
  const count = geometry.index?.count ?? positions.count;
  result.triangles = Math.floor(count / 3);
  result.complete = result.triangles <= maxTriangles && positions.count <= maxVertices;
  const edges = new Map(), ids = new Map();
  const id = p => { const key = p.toArray().map(v => Math.round(v / tolerance)).join(","); if (!ids.has(key)) ids.set(key, ids.size); return ids.get(key); };
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), normal = new Vector3();
  for (let f = 0; f < Math.min(result.triangles, maxTriangles); f++) {
    const indices = [0, 1, 2].map(j => geometry.index ? geometry.index.getX(f * 3 + j) : f * 3 + j);
    if (!indices.every(i => Number.isInteger(i) && i >= 0 && i < positions.count)) { result.invalidIndices++; continue; }
    [a, b, c].forEach((p, j) => p.fromBufferAttribute(positions, indices[j]));
    normal.subVectors(b, a).cross(c.clone().sub(a));
    if (normal.lengthSq() < tolerance ** 4) result.degenerateTriangles++;
    else if (normals) {
      const n = indices.reduce((sum, i) => sum.add(new Vector3().fromBufferAttribute(normals, i)), new Vector3());
      if (normal.dot(n) < -1e-12) result.reversedNormals++;
    }
    const vertices = [id(a), id(b), id(c)];
    for (let j = 0; j < 3; j++) {
      const from = vertices[j], to = vertices[(j + 1) % 3]; if (from === to) continue;
      const key = `${Math.min(from, to)}:${Math.max(from, to)}`, edge = edges.get(key) || { count: 0, direction: 0 };
      edge.count++; edge.direction += from < to ? 1 : -1; edges.set(key, edge);
    }
    result.inspectedTriangles++;
  }
  // A partial sample has artificial boundaries: do not report them as topology facts.
  if (result.complete) for (const edge of edges.values()) {
    if (edge.count === 1) result.boundaryEdges++;
    else if (edge.count > 2) result.nonManifoldEdges++;
    else if (edge.direction !== 0) result.inconsistentWindingEdges++;
  }
  return result;
}

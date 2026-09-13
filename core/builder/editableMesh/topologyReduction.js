import * as THREE from "three";
import { cloneEditableMeshTopology, buildTopologyIndexes, canonicalEdgeKey, triangulateEditableFace } from "./editableMeshTopology.js";

// Garland/Heckbert plane quadrics, with manifold/link, seam, boundary and normal checks.
// Unlike face sampling, every reduction contracts an actual edge and keeps the surface closed.
class MinHeap {
  items = [];
  push(value) {
    const items = this.items; let i = items.length; items.push(value);
    while (i > 0) { const p = (i - 1) >> 1; if (items[p].cost <= value.cost) break; items[i] = items[p]; i = p; }
    items[i] = value;
  }
  pop() {
    const items = this.items, first = items[0], last = items.pop();
    if (items.length) {
      let i = 0;
      while (i * 2 + 1 < items.length) {
        let child = i * 2 + 1;
        if (child + 1 < items.length && items[child + 1].cost < items[child].cost) child++;
        if (items[child].cost >= last.cost) break;
        items[i] = items[child]; i = child;
      }
      items[i] = last;
    }
    return first;
  }
}
const point = (value) => new THREE.Vector3().fromArray(value);
const normal = (a, b, c) => point(b).sub(point(a)).cross(point(c).sub(point(a)));
const quadricCost = (q, position) => {
  const v = [...position, 1]; let cost = 0;
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) cost += v[row] * q[row * 4 + col] * v[col];
  return Math.max(0, cost);
};

export function reduceEditableTopology(input, options = {}) {
  if (options.maxError !== undefined && (!Number.isFinite(Number(options.maxError)) || Number(options.maxError) < 0)) throw new Error("Simplify maxError must be a finite non-negative distance.");
  const topology = cloneEditableMeshTopology(input);
  const indexes = buildTopologyIndexes(topology);
  for (const [edge, faces] of indexes.edgeFaces) if (faces.length > 2) throw new Error(`Simplify requires manifold edges: ${edge.replace("\u0000", " / ")}.`);
  const faceIds = new Set(topology.faces.map((face) => face.id));
  const triangles = [];
  for (const face of topology.faces) {
    if (face.vertices.length === 3) { triangles.push(face); continue; }
    let n = 0;
    for (const triangle of triangulateEditableFace(face, indexes.vertexById)) {
      let id; do { id = `${face.id}-reduce-${++n}`; } while (faceIds.has(id)); faceIds.add(id);
      triangles.push({ ...face, id, vertices: triangle.map((i) => face.vertices[i]) });
    }
  }
  const ratio = Number(options.ratio ?? 0.5), requested = Number(options.targetFaceCount ?? Math.round(triangles.length * ratio));
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1 || !Number.isFinite(requested) || requested < 1) throw new Error("Simplify requires a positive targetFaceCount or ratio in (0,1].");
  const target = Math.min(triangles.length, Math.round(requested));
  if (target === triangles.length) return topology;
  const vertices = new Map(topology.vertices.map((vertex) => [vertex.id, { vertex, q: new Float64Array(16), faces: new Set(), neighbors: new Set(), version: 0, locked: false }]));
  const faces = new Map(triangles.map((face) => [face.id, face]));
  for (const face of faces.values()) {
    const nodes = face.vertices.map((id) => vertices.get(id));
    const n = normal(...nodes.map((node) => node.vertex.position)).normalize();
    const plane = [n.x, n.y, n.z, -n.dot(point(nodes[0].vertex.position))];
    for (const node of nodes) {
      node.faces.add(face.id);
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) node.q[r * 4 + c] += plane[r] * plane[c];
    }
  }
  for (const [key, adjacent] of indexes.edgeFaces) {
    const seam = adjacent.length === 2 && options.preserveSeams !== false && (() => {
      const [a, b] = adjacent.map((id) => indexes.faceById.get(id).face);
      return a.part !== b.part || a.materialIndex !== b.materialIndex || a.smooth !== b.smooth;
    })();
    if (seam || (indexes.creaseByEdge.get(key) || 0) > 0 || (options.preserveBoundary !== false && adjacent.length === 1)) {
      for (const id of key.split("\u0000")) vertices.get(id).locked = true;
    }
  }
  const refreshNeighbors = (node) => {
    node.neighbors.clear();
    for (const id of node.faces) for (const neighbor of faces.get(id)?.vertices || []) if (neighbor !== node.vertex.id) node.neighbors.add(neighbor);
  };
  for (const node of vertices.values()) refreshNeighbors(node);
  const heap = new MinHeap();
  const enqueue = (aId, bId) => {
    if (aId > bId) [aId, bId] = [bId, aId];
    const a = vertices.get(aId), b = vertices.get(bId);
    if (!a || !b || a.locked || b.locked || !a.neighbors.has(bId)) return;
    const q = a.q.map((value, index) => value + b.q[index]);
    const candidates = [a.vertex.position, b.vertex.position, point(a.vertex.position).lerp(point(b.vertex.position), 0.5).toArray()];
    const matrix = new THREE.Matrix3().set(q[0],q[1],q[2], q[4],q[5],q[6], q[8],q[9],q[10]);
    const scale = Math.max(...matrix.elements.map(Math.abs));
    if (scale && Math.abs(matrix.determinant()) > 1e-12 * scale ** 3) {
      const p = new THREE.Vector3(-q[3], -q[7], -q[11]).applyMatrix3(matrix.invert()).toArray();
      if (p.every(Number.isFinite)) candidates.push(p);
    }
    const ranked = candidates.map((position) => ({ position, cost: quadricCost(q, position) })).sort((a, b) => a.cost - b.cost);
    heap.push({ aId, bId, aVersion: a.version, bVersion: b.version, q, ...ranked[0] });
  };
  for (const [id, node] of vertices) for (const neighbor of node.neighbors) if (id < neighbor) enqueue(id, neighbor);
  let collapsed = 0;
  while (faces.size > target && heap.items.length) {
    const candidate = heap.pop(), { aId, bId, position, cost } = candidate;
    const a = vertices.get(aId), b = vertices.get(bId);
    if (!a || !b || a.version !== candidate.aVersion || b.version !== candidate.bVersion || !a.neighbors.has(bId)) continue;
    if (options.maxError != null && cost > Number(options.maxError) ** 2) break;
    const shared = [...a.faces].filter((id) => b.faces.has(id));
    if (shared.length < 1 || shared.length > 2) continue;
    const opposite = new Set(shared.flatMap((id) => faces.get(id).vertices.filter((v) => v !== aId && v !== bId)));
    const common = [...a.neighbors].filter((id) => b.neighbors.has(id));
    if (common.length !== opposite.size || common.some((id) => !opposite.has(id))) continue; // link condition
    const affected = new Set([...a.faces, ...b.faces]), signatures = new Set();
    let valid = true;
    for (const id of affected) {
      if (shared.includes(id)) continue;
      const face = faces.get(id), next = face.vertices.map((id) => id === bId ? aId : id);
      const signature = [...next].sort().join("\u0000");
      if (signatures.has(signature)) { valid = false; break; } signatures.add(signature);
      const before = normal(...face.vertices.map((id) => vertices.get(id).vertex.position));
      const after = normal(...next.map((id) => id === aId ? position : vertices.get(id).vertex.position));
      if (after.lengthSq() <= before.lengthSq() * 1e-20 || before.dot(after) <= 1e-8 * before.length() * after.length()) { valid = false; break; }
    }
    if (!valid) continue;
    const neighbors = new Set([...a.neighbors, ...b.neighbors, aId]); neighbors.delete(bId);
    for (const id of affected) {
      const face = faces.get(id);
      for (const v of face.vertices) vertices.get(v).faces.delete(id);
      if (shared.includes(id)) { faces.delete(id); continue; }
      face.vertices = face.vertices.map((id) => id === bId ? aId : id);
      for (const v of face.vertices) vertices.get(v).faces.add(id);
    }
    a.vertex.position = [...position]; a.q = candidate.q; vertices.delete(bId); collapsed++;
    for (const id of neighbors) { const node = vertices.get(id); if (node) { node.version++; refreshNeighbors(node); } }
    for (const id of neighbors) for (const neighbor of vertices.get(id)?.neighbors || []) enqueue(id, neighbor);
  }
  const used = new Set([...faces.values()].flatMap((face) => face.vertices));
  topology.vertices = [...vertices.values()].map((node) => node.vertex).filter((vertex) => used.has(vertex.id));
  topology.faces = [...faces.values()];
  topology.edges = topology.edges.filter((edge) => edge.vertices.every((id) => used.has(id)));
  topology.reduction = { requestedFaceCount: target, faceCount: faces.size, collapsedEdges: collapsed, reachedTarget: faces.size <= target,
    reason: faces.size <= target ? "target-reached" : "surface-constraints" };
  return topology;
}

/** Split only disconnected smoothing fans at each vertex, not all vertices of incident faces. */
export function splitEditableSmoothingFans(input, options = {}) {
  const topology = cloneEditableMeshTopology(input), indexes = buildTopologyIndexes(topology);
  const threshold = Number(options.creaseThreshold ?? 0.5);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error("creaseThreshold must be in [0,1].");
  const incident = new Map(topology.vertices.map((vertex) => [vertex.id, new Set()]));
  for (const face of topology.faces) for (const id of face.vertices) incident.get(id).add(face.id);
  const remap = new Map(), used = new Set(topology.vertices.map((vertex) => vertex.id));
  const smoothEdges = new Map();
  for (const [key, faces] of indexes.edgeFaces) {
    if (faces.length !== 2 || (indexes.creaseByEdge.get(key) || 0) >= threshold) continue;
    for (const id of key.split("\u0000")) {
      if (!smoothEdges.has(id)) smoothEdges.set(id, []);
      smoothEdges.get(id).push(faces);
    }
  }
  for (const source of [...topology.vertices]) {
    const pending = new Set(incident.get(source.id)); let component = 0;
    while (pending.size) {
      const first = pending.values().next().value, queue = [first], fan = []; pending.delete(first);
      for (let n = 0; n < queue.length; n++) {
        const face = queue[n]; fan.push(face);
        for (const pair of smoothEdges.get(source.id) || []) if (pair.includes(face)) for (const neighbor of pair) if (pending.delete(neighbor)) queue.push(neighbor);
      }
      let id = source.id;
      if (component++) {
        id = `${source.id}-split-${component}`;
        while (used.has(id)) id += "_";
        used.add(id); topology.vertices.push({ ...source, id, position: [...source.position] });
      }
      for (const face of fan) { if (!remap.has(face)) remap.set(face, new Map()); remap.get(face).set(source.id, id); }
    }
  }
  const edges = [], edgeKeys = new Set();
  for (const edge of topology.edges) for (const face of indexes.edgeFaces.get(canonicalEdgeKey(...edge.vertices)) || []) {
    const vertices = edge.vertices.map((id) => remap.get(face).get(id)), key = canonicalEdgeKey(...vertices);
    if (!edgeKeys.has(key)) { edgeKeys.add(key); edges.push({ ...edge, vertices }); }
  }
  for (const face of topology.faces) face.vertices = face.vertices.map((id) => remap.get(face.id).get(id));
  topology.edges = edges;
  return topology;
}

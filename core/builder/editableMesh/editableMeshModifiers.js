import * as THREE from "three";
import {
  buildTopologyIndexes,
  canonicalEdgeKey,
  cloneEditableMeshTopology,
  normalizeEditableMeshTopology
} from "./editableMeshTopology.js";

function nextId(prefix, used) {
  let index = used.size + 1;
  let id = `${prefix}-${index}`;
  while (used.has(id)) {
    index += 1;
    id = `${prefix}-${index}`;
  }
  used.add(id);
  return id;
}

function vector(position) {
  return new THREE.Vector3(position[0], position[1], position[2]);
}

function array(vector3) {
  return [vector3.x, vector3.y, vector3.z];
}

export function mirrorEditableTopology(input, modifier = {}) {
  const topology = cloneEditableMeshTopology(input);
  const axis = ["x", "y", "z"].includes(modifier.axis) ? modifier.axis : "x";
  const axisIndex = { x: 0, y: 1, z: 2 }[axis];
  const center = Number(modifier.center) || 0;
  const merge = modifier.merge !== false;
  const tolerance = Math.max(0, Number(modifier.mergeTolerance) || 1e-6);
  const vertexIds = new Set(topology.vertices.map((item) => item.id));
  const faceIds = new Set(topology.faces.map((item) => item.id));
  const mirroredId = new Map();
  for (const source of [...topology.vertices]) {
    if (merge && Math.abs(source.position[axisIndex] - center) <= tolerance) {
      mirroredId.set(source.id, source.id);
      continue;
    }
    const id = nextId(`${source.id}-mirror`, vertexIds);
    const position = source.position.slice();
    position[axisIndex] = center * 2 - position[axisIndex];
    topology.vertices.push({ ...source, id, position });
    mirroredId.set(source.id, id);
  }
  for (const source of [...topology.faces]) {
    const vertices = source.vertices.map((id) => mirroredId.get(id)).reverse();
    if (new Set(vertices).size < 3) continue;
    topology.faces.push({ ...source, id: nextId(`${source.id}-mirror`, faceIds), vertices });
  }
  const edgeKeys = new Set(topology.edges.map((edge) => canonicalEdgeKey(...edge.vertices)));
  for (const source of [...topology.edges]) {
    const vertices = source.vertices.map((id) => mirroredId.get(id));
    if (vertices[0] === vertices[1]) continue;
    const key = canonicalEdgeKey(...vertices);
    if (!edgeKeys.has(key)) {
      topology.edges.push({ ...source, vertices });
      edgeKeys.add(key);
    }
  }
  return topology;
}

export function smoothEditableTopology(input, modifier = {}) {
  const topology = cloneEditableMeshTopology(input);
  const iterations = Math.max(1, Math.round(Number(modifier.iterations) || 1));
  const factor = THREE.MathUtils.clamp(Number(modifier.factor) || 0.5, 0, 1);
  const preserveBoundary = modifier.preserveBoundary !== false;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const { vertexById, edgeFaces } = buildTopologyIndexes(topology);
    const neighbors = new Map(topology.vertices.map((vertex) => [vertex.id, new Set()]));
    const boundary = new Set();
    for (const [key, faces] of edgeFaces) {
      const [a, b] = key.split("\u0000");
      neighbors.get(a)?.add(b);
      neighbors.get(b)?.add(a);
      if (faces.length === 1) {
        boundary.add(a);
        boundary.add(b);
      }
    }
    const updates = new Map();
    for (const vertex of topology.vertices) {
      const ids = neighbors.get(vertex.id);
      if (!ids?.size || (preserveBoundary && boundary.has(vertex.id))) continue;
      const average = new THREE.Vector3();
      for (const id of ids) average.add(vector(vertexById.get(id).vertex.position));
      average.multiplyScalar(1 / ids.size);
      updates.set(vertex.id, array(vector(vertex.position).lerp(average, factor)));
    }
    for (const vertex of topology.vertices) if (updates.has(vertex.id)) vertex.position = updates.get(vertex.id);
  }
  return topology;
}

export function triangulateEditableTopology(input) {
  const topology = cloneEditableMeshTopology(input);
  const faceIds = new Set(topology.faces.map((item) => item.id));
  const faces = [];
  for (const face of topology.faces) {
    if (face.vertices.length === 3) {
      faces.push(face);
      continue;
    }
    for (let i = 1; i < face.vertices.length - 1; i += 1) {
      faces.push({ ...face, id: nextId(`${face.id}-tri`, faceIds), vertices: [face.vertices[0], face.vertices[i], face.vertices[i + 1]] });
    }
  }
  topology.faces = faces;
  return topology;
}

export function tessellateEditableTopology(input, modifier = {}) {
  let topology = triangulateEditableTopology(input);
  const iterations = Math.max(1, Math.round(Number(modifier.iterations) || 1));
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const { vertexById } = buildTopologyIndexes(topology);
    const vertexIds = new Set(topology.vertices.map((item) => item.id));
    const faceIds = new Set(topology.faces.map((item) => item.id));
    const midpointIds = new Map();
    const midpoint = (a, b) => {
      const key = canonicalEdgeKey(a, b);
      if (midpointIds.has(key)) return midpointIds.get(key);
      const id = nextId("v-tess", vertexIds);
      topology.vertices.push({ id, position: array(vector(vertexById.get(a).vertex.position).lerp(vector(vertexById.get(b).vertex.position), 0.5)) });
      midpointIds.set(key, id);
      return id;
    };
    const faces = [];
    for (const face of topology.faces) {
      const [a, b, c] = face.vertices;
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      faces.push(
        { ...face, id: nextId(`${face.id}-a`, faceIds), vertices: [a, ab, ca] },
        { ...face, id: nextId(`${face.id}-b`, faceIds), vertices: [ab, b, bc] },
        { ...face, id: nextId(`${face.id}-c`, faceIds), vertices: [ca, bc, c] },
        { ...face, id: nextId(`${face.id}-d`, faceIds), vertices: [ab, bc, ca] }
      );
    }
    topology.faces = faces;
  }
  return topology;
}

export function catmullClarkEditableTopology(input, modifier = {}) {
  let topology = cloneEditableMeshTopology(input);
  const iterations = Math.max(1, Math.round(Number(modifier.iterations ?? modifier.levels) || 1));
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const { vertexById, edgeFaces, creaseByEdge } = buildTopologyIndexes(topology);
    const vertexIds = new Set(topology.vertices.map((item) => item.id));
    const faceIds = new Set(topology.faces.map((item) => item.id));
    const facePoint = new Map();
    const faceById = new Map(topology.faces.map((face) => [face.id, face]));
    for (const face of topology.faces) {
      const point = new THREE.Vector3();
      for (const id of face.vertices) point.add(vector(vertexById.get(id).vertex.position));
      point.multiplyScalar(1 / face.vertices.length);
      const id = nextId(`${face.id}-center`, vertexIds);
      topology.vertices.push({ id, position: array(point), part: face.part });
      facePoint.set(face.id, { id, point });
    }
    const edgePoint = new Map();
    for (const [key, adjacentFaces] of edgeFaces) {
      const [a, b] = key.split("\u0000");
      const point = vector(vertexById.get(a).vertex.position).add(vector(vertexById.get(b).vertex.position));
      const crease = creaseByEdge.get(key) || 0;
      if (adjacentFaces.length === 2 && crease < 1) {
        point.add(facePoint.get(adjacentFaces[0]).point).add(facePoint.get(adjacentFaces[1]).point).multiplyScalar(0.25);
      } else {
        point.multiplyScalar(0.5);
      }
      const id = nextId("v-edge", vertexIds);
      topology.vertices.push({ id, position: array(point) });
      edgePoint.set(key, { id, point });
    }
    const incidentFaces = new Map();
    const incidentEdges = new Map();
    for (const id of vertexById.keys()) {
      incidentFaces.set(id, []);
      incidentEdges.set(id, []);
    }
    for (const face of faceById.values()) for (const id of face.vertices) incidentFaces.get(id)?.push(face.id);
    for (const [key, adjacentFaces] of edgeFaces) {
      const [a, b] = key.split("\u0000");
      incidentEdges.get(a)?.push({ key, other: b, boundary: adjacentFaces.length === 1, crease: creaseByEdge.get(key) || 0 });
      incidentEdges.get(b)?.push({ key, other: a, boundary: adjacentFaces.length === 1, crease: creaseByEdge.get(key) || 0 });
    }
    const originalVertices = [...vertexById.values()].map((entry) => entry.vertex);
    for (const vertex of originalVertices) {
      const edges = incidentEdges.get(vertex.id) || [];
      const sharp = edges.filter((edge) => edge.boundary || edge.crease >= 1);
      const current = vector(vertex.position);
      let next = current.clone();
      if (sharp.length >= 2) {
        const a = vector(vertexById.get(sharp[0].other).vertex.position);
        const b = vector(vertexById.get(sharp[1].other).vertex.position);
        next = current.clone().multiplyScalar(6).add(a).add(b).multiplyScalar(1 / 8);
      } else if (edges.length > 0) {
        const faces = incidentFaces.get(vertex.id) || [];
        const f = new THREE.Vector3();
        for (const id of faces) f.add(facePoint.get(id).point);
        if (faces.length) f.multiplyScalar(1 / faces.length);
        const r = new THREE.Vector3();
        for (const edge of edges) r.add(current.clone().add(vector(vertexById.get(edge.other).vertex.position)).multiplyScalar(0.5));
        r.multiplyScalar(1 / edges.length);
        const n = Math.max(1, faces.length);
        next = f.add(r.multiplyScalar(2)).add(current.clone().multiplyScalar(n - 3)).multiplyScalar(1 / n);
      }
      vertex.position = array(next);
    }
    const faces = [];
    for (const face of faceById.values()) {
      for (let i = 0; i < face.vertices.length; i += 1) {
        const current = face.vertices[i];
        const nextVertex = face.vertices[(i + 1) % face.vertices.length];
        const previous = face.vertices[(i - 1 + face.vertices.length) % face.vertices.length];
        faces.push({
          ...face,
          id: nextId(`${face.id}-sub`, faceIds),
          vertices: [current, edgePoint.get(canonicalEdgeKey(current, nextVertex)).id, facePoint.get(face.id).id, edgePoint.get(canonicalEdgeKey(previous, current)).id]
        });
      }
    }
    topology.faces = faces;
  }
  return normalizeEditableMeshTopology(topology);
}

export function loopSubdivisionEditableTopology(input, modifier = {}) {
  let topology = triangulateEditableTopology(input);
  const iterations = Math.max(1, Math.round(Number(modifier.iterations ?? modifier.levels) || 1));
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const indexes = buildTopologyIndexes(topology);
    const originalVertices = topology.vertices.map((vertex) => ({ ...vertex, position: vertex.position.slice() }));
    const originalFaces = topology.faces.map((face) => ({ ...face, vertices: face.vertices.slice() }));
    const faceById = new Map(originalFaces.map((face) => [face.id, face]));
    const vertexIds = new Set(topology.vertices.map((item) => item.id));
    const faceIds = new Set(topology.faces.map((item) => item.id));
    const edgePointId = new Map();
    const childCreases = [];
    const neighbors = new Map(originalVertices.map((vertex) => [vertex.id, new Set()]));
    const sharpNeighbors = new Map(originalVertices.map((vertex) => [vertex.id, []]));

    for (const [key, adjacentFaceIds] of indexes.edgeFaces) {
      const [a, b] = key.split("\u0000");
      neighbors.get(a)?.add(b);
      neighbors.get(b)?.add(a);
      const pa = vector(indexes.vertexById.get(a).vertex.position);
      const pb = vector(indexes.vertexById.get(b).vertex.position);
      const crease = THREE.MathUtils.clamp(Number(indexes.creaseByEdge.get(key)) || 0, 0, 1);
      const boundary = adjacentFaceIds.length !== 2;
      const sharpPoint = pa.clone().add(pb).multiplyScalar(0.5);
      let smoothPoint = sharpPoint.clone();
      if (!boundary) {
        const opposite = adjacentFaceIds.map((faceId) =>
          faceById.get(faceId)?.vertices.find((id) => id !== a && id !== b)
        );
        if (opposite.every(Boolean)) {
          smoothPoint = pa.clone().add(pb).multiplyScalar(3 / 8)
            .add(vector(indexes.vertexById.get(opposite[0]).vertex.position).multiplyScalar(1 / 8))
            .add(vector(indexes.vertexById.get(opposite[1]).vertex.position).multiplyScalar(1 / 8));
        }
      }
      const point = boundary ? sharpPoint : smoothPoint.lerp(sharpPoint, crease);
      const id = nextId("v-loop-edge", vertexIds);
      topology.vertices.push({ id, position: array(point) });
      edgePointId.set(key, id);
      if (boundary || crease > 0) {
        const weight = boundary ? 1 : crease;
        sharpNeighbors.get(a)?.push({ id: b, weight });
        sharpNeighbors.get(b)?.push({ id: a, weight });
        childCreases.push(
          { vertices: [a, id], crease: weight },
          { vertices: [id, b], crease: weight }
        );
      }
    }

    for (const vertex of originalVertices) {
      const source = vector(vertex.position);
      const sharp = (sharpNeighbors.get(vertex.id) || [])
        .sort((left, right) => right.weight - left.weight || left.id.localeCompare(right.id));
      let next;
      if (sharp.length >= 2) {
        const creasePoint = source.clone().multiplyScalar(3 / 4)
          .add(vector(indexes.vertexById.get(sharp[0].id).vertex.position).multiplyScalar(1 / 8))
          .add(vector(indexes.vertexById.get(sharp[1].id).vertex.position).multiplyScalar(1 / 8));
        const blend = Math.min(1, Math.max(sharp[0].weight, sharp[1].weight));
        const ids = [...(neighbors.get(vertex.id) || [])];
        const n = ids.length;
        if (n > 0) {
          const beta = n === 3 ? 3 / 16 : 3 / (8 * n);
          const smooth = source.clone().multiplyScalar(1 - n * beta);
          for (const id of ids) smooth.add(vector(indexes.vertexById.get(id).vertex.position).multiplyScalar(beta));
          next = smooth.lerp(creasePoint, blend);
        } else {
          next = creasePoint;
        }
      } else {
        const ids = [...(neighbors.get(vertex.id) || [])];
        const n = ids.length;
        if (n === 0) continue;
        const beta = n === 3 ? 3 / 16 : 3 / (8 * n);
        next = source.multiplyScalar(1 - n * beta);
        for (const id of ids) next.add(vector(indexes.vertexById.get(id).vertex.position).multiplyScalar(beta));
      }
      topology.vertices.find((item) => item.id === vertex.id).position = array(next);
    }

    const faces = [];
    for (const face of originalFaces) {
      const [a, b, c] = face.vertices;
      const ab = edgePointId.get(canonicalEdgeKey(a, b));
      const bc = edgePointId.get(canonicalEdgeKey(b, c));
      const ca = edgePointId.get(canonicalEdgeKey(c, a));
      faces.push(
        { ...face, id: nextId(`${face.id}-loop-a`, faceIds), vertices: [a, ab, ca] },
        { ...face, id: nextId(`${face.id}-loop-b`, faceIds), vertices: [b, bc, ab] },
        { ...face, id: nextId(`${face.id}-loop-c`, faceIds), vertices: [c, ca, bc] },
        { ...face, id: nextId(`${face.id}-loop-center`, faceIds), vertices: [ab, bc, ca] }
      );
    }
    topology.faces = faces;
    topology.edges = childCreases;
  }
  return normalizeEditableMeshTopology(topology);
}

export function solidifyEditableTopology(input, modifier = {}) {
  const topology = cloneEditableMeshTopology(input);
  const thickness = Number(modifier.thickness);
  const distance = Number.isFinite(thickness) ? thickness : 0.1;
  const { vertexById, faceById, edgeFaces } = buildTopologyIndexes(topology);
  const normals = new Map(topology.vertices.map((vertex) => [vertex.id, new THREE.Vector3()]));
  for (const face of topology.faces) {
    const a = vector(vertexById.get(face.vertices[0]).vertex.position);
    const b = vector(vertexById.get(face.vertices[1]).vertex.position);
    const c = vector(vertexById.get(face.vertices[2]).vertex.position);
    const normal = b.sub(a).cross(c.sub(a)).normalize();
    for (const id of face.vertices) normals.get(id).add(normal);
  }
  const vertexIds = new Set(topology.vertices.map((item) => item.id));
  const faceIds = new Set(topology.faces.map((item) => item.id));
  const innerId = new Map();
  for (const source of [...topology.vertices]) {
    const id = nextId(`${source.id}-solid`, vertexIds);
    const normal = normals.get(source.id).normalize();
    topology.vertices.push({ ...source, id, position: array(vector(source.position).addScaledVector(normal, -distance)) });
    innerId.set(source.id, id);
  }
  for (const source of [...topology.faces]) {
    topology.faces.push({ ...source, id: nextId(`${source.id}-inner`, faceIds), vertices: source.vertices.map((id) => innerId.get(id)).reverse() });
  }
  for (const [key, faces] of edgeFaces) {
    if (faces.length !== 1) continue;
    const boundaryFace = faceById.get(faces[0])?.face;
    if (!boundaryFace) continue;
    let a = null;
    let b = null;
    for (let index = 0; index < boundaryFace.vertices.length; index += 1) {
      const current = boundaryFace.vertices[index];
      const next = boundaryFace.vertices[(index + 1) % boundaryFace.vertices.length];
      if (canonicalEdgeKey(current, next) !== key) continue;
      a = current;
      b = next;
      break;
    }
    if (!a || !b) continue;
    // A closed, consistently wound shell must traverse each shared edge in opposite
    // directions. The outer face uses a -> b, so the side closes with b -> a; the
    // reversed inner face uses inner(b) -> inner(a), so the side uses the inverse.
    topology.faces.push({ id: nextId("f-solid-side", faceIds), vertices: [a, innerId.get(a), innerId.get(b), b], part: modifier.sidePart || "solidify-side", materialIndex: Math.max(0, Math.round(Number(modifier.materialIndex) || 0)), smooth: false });
  }
  return topology;
}

/** Deterministic face-bevel approximation for a control cage: inset selected faces and optionally
 * offset the new face along its normal. It keeps stable source IDs and gives generated ring
 * vertices/faces deterministic IDs, making it suitable for repeated AI edits. */
export function bevelEditableTopology(input, modifier = {}) {
  const topology = cloneEditableMeshTopology(input);
  const selectedIds = new Set(Array.isArray(modifier.faceIds) ? modifier.faceIds.map(String) : []);
  const selectedParts = new Set(Array.isArray(modifier.parts) ? modifier.parts.map(String) : []);
  const amount = THREE.MathUtils.clamp(Number(modifier.amount ?? modifier.factor) || 0.08, 0.000001, 0.499999);
  const offset = Number(modifier.offset ?? modifier.distance) || 0;
  const { vertexById } = buildTopologyIndexes(topology);
  const vertexIds = new Set(topology.vertices.map((item) => item.id));
  const faceIds = new Set(topology.faces.map((item) => item.id));
  const sourceFaces = [...topology.faces];
  for (const face of sourceFaces) {
    if (selectedIds.size && !selectedIds.has(face.id)) continue;
    if (selectedParts.size && !selectedParts.has(face.part)) continue;
    const center = new THREE.Vector3();
    for (const id of face.vertices) center.add(vector(vertexById.get(id).vertex.position));
    center.multiplyScalar(1 / face.vertices.length);
    const normal = face.vertices.length >= 3
      ? vector(vertexById.get(face.vertices[1]).vertex.position)
          .sub(vector(vertexById.get(face.vertices[0]).vertex.position))
          .cross(
            vector(vertexById.get(face.vertices[2]).vertex.position)
              .sub(vector(vertexById.get(face.vertices[0]).vertex.position))
          )
          .normalize()
      : new THREE.Vector3(0, 1, 0);
    const inner = [];
    for (const id of face.vertices) {
      const source = vertexById.get(id).vertex;
      const innerId = nextId(`${id}-bevel`, vertexIds);
      const position = vector(source.position).lerp(center, amount).addScaledVector(normal, offset);
      topology.vertices.push({ ...source, id: innerId, position: array(position) });
      inner.push(innerId);
    }
    const outer = face.vertices.slice();
    face.vertices = inner;
    for (let i = 0; i < outer.length; i += 1) {
      topology.faces.push({
        ...face,
        id: nextId(`${face.id}-bevel-ring`, faceIds),
        vertices: [outer[i], outer[(i + 1) % outer.length], inner[(i + 1) % inner.length], inner[i]],
        part: modifier.ringPart ?? face.part
      });
    }
  }
  return topology;
}

/** Split vertices at explicitly creased/boundary edges so ordinary BufferGeometry normal
 * calculation produces a hard edge. This is the control-topology equivalent of EdgeSplit. */
export function edgeSplitEditableTopology(input, modifier = {}) {
  const topology = cloneEditableMeshTopology(input);
  const threshold = THREE.MathUtils.clamp(Number(modifier.creaseThreshold) || 0.5, 0, 1);
  const includeBoundary = modifier.includeBoundary === true;
  const indexes = buildTopologyIndexes(topology);
  const sharpFaces = new Set();
  for (const [key, faces] of indexes.edgeFaces) {
    const crease = indexes.creaseByEdge.get(key) || 0;
    if (crease >= threshold || (includeBoundary && faces.length === 1)) {
      for (const faceId of faces) sharpFaces.add(faceId);
    }
  }
  if (!sharpFaces.size) return topology;
  const vertexIds = new Set(topology.vertices.map((item) => item.id));
  for (const face of topology.faces) {
    if (!sharpFaces.has(face.id)) continue;
    face.vertices = face.vertices.map((id) => {
      const source = indexes.vertexById.get(id).vertex;
      const splitId = nextId(`${id}-split-${face.id}`, vertexIds);
      topology.vertices.push({ ...source, id: splitId, position: source.position.slice() });
      return splitId;
    });
  }
  topology.edges = topology.edges.filter((edge) => !(
    (indexes.creaseByEdge.get(canonicalEdgeKey(...edge.vertices)) || 0) >= threshold
  ));
  return topology;
}

/** Optional, explicitly requested simplification. Core never invokes this automatically. */
export function simplifyEditableTopology(input, modifier = {}) {
  const topology = cloneEditableMeshTopology(input);
  const requestedCount = Number(modifier.targetFaceCount);
  const ratio = THREE.MathUtils.clamp(Number(modifier.ratio) || 0.5, 0.000001, 1);
  const target = Number.isFinite(requestedCount) && requestedCount >= 1
    ? Math.min(topology.faces.length, Math.round(requestedCount))
    : Math.max(1, Math.round(topology.faces.length * ratio));
  if (target >= topology.faces.length) return topology;
  const keep = [];
  for (let i = 0; i < target; i += 1) {
    keep.push(topology.faces[Math.floor((i * topology.faces.length) / target)]);
  }
  topology.faces = keep;
  const used = new Set(keep.flatMap((face) => face.vertices));
  topology.vertices = topology.vertices.filter((vertex) => used.has(vertex.id));
  topology.edges = topology.edges.filter((edge) => edge.vertices.every((id) => used.has(id)));
  return topology;
}

export function applyEditableMeshModifiers(input, modifiers = []) {
  let topology = cloneEditableMeshTopology(input);
  const applied = [];
  for (const descriptor of Array.isArray(modifiers) ? modifiers : []) {
    if (!descriptor || descriptor.enabled === false) continue;
    const type = String(descriptor.type || descriptor.kind || "").trim().toLowerCase().replace(/[-_\s]/g, "");
    if (type === "mirror") topology = mirrorEditableTopology(topology, descriptor);
    else if (type === "catmullclark" || type === "subdivision" || type === "subdivisionsurface") topology = catmullClarkEditableTopology(topology, descriptor);
    else if (type === "loop" || type === "loopsubdivision") topology = loopSubdivisionEditableTopology(topology, descriptor);
    else if (type === "smooth" || type === "laplaciansmooth") topology = smoothEditableTopology(topology, descriptor);
    else if (type === "triangulate") topology = triangulateEditableTopology(topology);
    else if (type === "tessellate") topology = tessellateEditableTopology(topology, descriptor);
    else if (type === "solidify") topology = solidifyEditableTopology(topology, descriptor);
    else if (type === "bevel") topology = bevelEditableTopology(topology, descriptor);
    else if (type === "edgesplit" || type === "creasenormal") topology = edgeSplitEditableTopology(topology, descriptor);
    else if (type === "simplify") topology = simplifyEditableTopology(topology, descriptor);
    else if (["recalculatenormals", "recomputenormals", "recalculatetangents", "recomputetangents", "uvplanar", "uvbox", "uvcylindrical", "uvspherical", "uvtriplanar"].includes(type)) {
      // Evaluated by editableMeshBuilder after topology conversion.
    }
    else continue;
    applied.push(descriptor.id || descriptor.type || descriptor.kind);
  }
  return { topology, applied };
}

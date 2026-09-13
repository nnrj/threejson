import * as THREE from "three";
import {
  buildTopologyIndexes,
  canonicalEdgeKey,
  cloneEditableMeshTopology,
  normalizeEditableMeshTopology,
  triangulateEditableFace
} from "./editableMeshTopology.js";
import { reduceEditableTopology, splitEditableSmoothingFans } from "./topologyReduction.js";
import { bevelTopologyEdges } from "./topologyBevel.js";

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
  const { vertexById } = buildTopologyIndexes(topology);
  const faces = [];
  for (const face of topology.faces) {
    if (face.vertices.length === 3) {
      faces.push(face);
      continue;
    }
    for (const triangle of triangulateEditableFace(face, vertexById)) {
      faces.push({ ...face, id: nextId(`${face.id}-tri`, faceIds), vertices: triangle.map((index) => face.vertices[index]) });
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

/** True edge chamfers. Inset remains a separate modeling operation. */
export function bevelEditableTopology(input, modifier = {}) { return bevelTopologyEdges(input, modifier); }

export function edgeSplitEditableTopology(input, modifier = {}) { return splitEditableSmoothingFans(input, modifier); }

export function simplifyEditableTopology(input, modifier = {}) { return reduceEditableTopology(input, modifier); }

export function applyEditableMeshModifiers(input, modifiers = []) {
  let topology = cloneEditableMeshTopology(input);
  const applied = [];
  const diagnostics = [];
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
    else if (type === "simplify") {
      topology = simplifyEditableTopology(topology, descriptor);
      if (topology.reduction) diagnostics.push({ modifier: descriptor.id || "simplify", ...topology.reduction });
    }
    else if (["recalculatenormals", "recomputenormals", "recalculatetangents", "recomputetangents", "uvplanar", "uvbox", "uvcylindrical", "uvspherical", "uvtriplanar"].includes(type)) {
      // Evaluated by editableMeshBuilder after topology conversion.
    }
    else throw Object.assign(new Error(`Unsupported editable mesh modifier: ${descriptor.type || descriptor.kind || "(missing type)"}`), { code: "E_MESH_MODIFIER_UNSUPPORTED" });
    applied.push(descriptor.id || descriptor.type || descriptor.kind);
  }
  return { topology, applied, diagnostics };
}

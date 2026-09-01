import * as THREE from "three";
import {
  buildTopologyIndexes,
  canonicalEdgeKey,
  cloneEditableMeshTopology,
  normalizeEditableMeshTopology,
  validateEditableMeshTopology
} from "../builder/editableMesh/editableMeshTopology.js";
import { mirrorEditableTopology } from "../builder/editableMesh/editableMeshModifiers.js";

function cloneJson(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function requiredId(value, field) {
  const id = String(value || "").trim();
  if (!id) throw new Error(`${field} is required.`);
  return id;
}

function positionArray(value, field = "position") {
  const raw = Array.isArray(value) ? value : value && typeof value === "object" ? [value.x, value.y, value.z] : [];
  const result = [Number(raw[0]), Number(raw[1]), Number(raw[2])];
  if (!result.every(Number.isFinite)) throw new Error(`${field} must contain three finite numbers.`);
  return result;
}

function uniqueId(requested, prefix, records) {
  const used = new Set(records.map((item) => item.id));
  let id = String(requested || "").trim();
  if (id && !used.has(id)) return id;
  let index = records.length + 1;
  do {
    id = `${prefix}-${index}`;
    index += 1;
  } while (used.has(id));
  return id;
}

function faceNormal(face, indexes) {
  const a = new THREE.Vector3(...indexes.vertexById.get(face.vertices[0]).vertex.position);
  const b = new THREE.Vector3(...indexes.vertexById.get(face.vertices[1]).vertex.position);
  const c = new THREE.Vector3(...indexes.vertexById.get(face.vertices[2]).vertex.position);
  const normal = b.sub(a).cross(c.sub(a));
  return normal.lengthSq() > 1e-20 ? normal.normalize() : new THREE.Vector3(0, 1, 0);
}

function addVertex(topology, operation) {
  const requested = String(operation.id || operation.vertex?.id || "").trim();
  if (requested && topology.vertices.some((item) => item.id === requested)) throw new Error(`Vertex \"${requested}\" already exists.`);
  const id = uniqueId(requested, "v", topology.vertices);
  const position = positionArray(operation.position ?? operation.vertex?.position);
  topology.vertices.push({ ...(operation.vertex && typeof operation.vertex === "object" ? cloneJson(operation.vertex) : {}), id, position });
}

function setVertex(topology, operation) {
  const id = requiredId(operation.id ?? operation.vertexId, "vertex id");
  const vertex = topology.vertices.find((item) => item.id === id);
  if (!vertex) throw new Error(`Vertex \"${id}\" was not found.`);
  if (operation.position != null) vertex.position = positionArray(operation.position);
  if (operation.delta != null) {
    const delta = positionArray(operation.delta, "delta");
    vertex.position = vertex.position.map((value, index) => value + delta[index]);
  }
  if (operation.attributes && typeof operation.attributes === "object") {
    vertex.attributes = { ...(vertex.attributes || {}), ...cloneJson(operation.attributes) };
  }
}

function removeVertex(topology, operation) {
  const id = requiredId(operation.id ?? operation.vertexId, "vertex id");
  const referencedFaces = topology.faces.filter((face) => face.vertices.includes(id));
  if (referencedFaces.length > 0 && operation.cascade !== true) {
    throw new Error(`Vertex \"${id}\" is used by ${referencedFaces.length} face(s); set cascade:true to remove them atomically.`);
  }
  topology.vertices = topology.vertices.filter((item) => item.id !== id);
  if (operation.cascade === true) topology.faces = topology.faces.filter((face) => !face.vertices.includes(id));
  topology.edges = topology.edges.filter((edge) => !edge.vertices.includes(id));
}

function normalizeFaceInput(operation, fallback = {}) {
  const raw = operation.face && typeof operation.face === "object" ? operation.face : operation;
  const vertices = Array.isArray(raw.vertices) ? raw.vertices.map((id) => String(id || "").trim()).filter(Boolean) : fallback.vertices;
  if (!Array.isArray(vertices) || vertices.length < 3) throw new Error("face.vertices needs at least three vertex IDs.");
  return {
    ...cloneJson(fallback),
    ...cloneJson(raw),
    vertices,
    part: typeof raw.part === "string" ? raw.part : fallback.part || "",
    materialIndex: Math.max(0, Math.round(Number(raw.materialIndex ?? fallback.materialIndex) || 0)),
    smooth: raw.smooth ?? fallback.smooth ?? true
  };
}

function assertFaceVertices(topology, vertices) {
  const known = new Set(topology.vertices.map((item) => item.id));
  const missing = vertices.find((id) => !known.has(id));
  if (missing) throw new Error(`Face references missing vertex \"${missing}\".`);
  if (new Set(vertices).size !== vertices.length) throw new Error("Face may not repeat a vertex ID.");
}

function addFace(topology, operation) {
  const face = normalizeFaceInput(operation);
  assertFaceVertices(topology, face.vertices);
  const requested = String(operation.id || operation.face?.id || "").trim();
  if (requested && topology.faces.some((item) => item.id === requested)) throw new Error(`Face \"${requested}\" already exists.`);
  face.id = uniqueId(requested, "f", topology.faces);
  topology.faces.push(face);
}

function setFace(topology, operation) {
  const id = requiredId(operation.id ?? operation.faceId, "face id");
  const index = topology.faces.findIndex((item) => item.id === id);
  if (index < 0) throw new Error(`Face \"${id}\" was not found.`);
  const face = normalizeFaceInput(operation, topology.faces[index]);
  face.id = id;
  assertFaceVertices(topology, face.vertices);
  topology.faces[index] = face;
}

function removeFace(topology, operation) {
  const id = requiredId(operation.id ?? operation.faceId, "face id");
  const before = topology.faces.length;
  topology.faces = topology.faces.filter((item) => item.id !== id);
  if (topology.faces.length === before) throw new Error(`Face \"${id}\" was not found.`);
}

function assignPart(topology, operation) {
  const faceIds = new Set((operation.faceIds || (operation.faceId ? [operation.faceId] : [])).map(String));
  if (faceIds.size === 0) throw new Error("assignPart requires faceIds.");
  const part = String(operation.part || "");
  let count = 0;
  for (const face of topology.faces) {
    if (faceIds.has(face.id)) {
      face.part = part;
      if (operation.materialIndex != null) face.materialIndex = Math.max(0, Math.round(Number(operation.materialIndex) || 0));
      count += 1;
    }
  }
  if (count !== faceIds.size) throw new Error("assignPart referenced one or more unknown face IDs.");
}

function setEdgeCrease(topology, operation) {
  const vertices = Array.isArray(operation.vertices) ? operation.vertices.slice(0, 2).map(String) : [];
  if (vertices.length !== 2 || vertices[0] === vertices[1]) throw new Error("setEdgeCrease requires two different vertex IDs.");
  const known = new Set(topology.vertices.map((item) => item.id));
  const missing = vertices.find((id) => !known.has(id));
  if (missing) throw new Error(`Edge references missing vertex "${missing}".`);
  const key = canonicalEdgeKey(...vertices);
  const index = topology.edges.findIndex((edge) => canonicalEdgeKey(...edge.vertices) === key);
  const crease = THREE.MathUtils.clamp(Number(operation.crease) || 0, 0, 1);
  if (index >= 0) topology.edges[index] = { ...topology.edges[index], vertices, crease };
  else topology.edges.push({ vertices, crease });
}

function resolveFaces(topology, operation) {
  const ids = new Set((operation.faceIds || (operation.faceId ? [operation.faceId] : [])).map(String));
  if (ids.size === 0 && typeof operation.part === "string") {
    for (const face of topology.faces) if (face.part === operation.part) ids.add(face.id);
  }
  const faces = topology.faces.filter((face) => ids.has(face.id));
  if (faces.length === 0 || faces.length !== ids.size) throw new Error("The operation referenced one or more unknown faces.");
  return faces;
}

function extrudeFaces(topology, operation) {
  const faces = resolveFaces(topology, operation);
  const indexes = buildTopologyIndexes(topology);
  const distance = Number(operation.distance);
  if (!Number.isFinite(distance)) throw new Error("extrudeFaces.distance must be finite.");
  const selected = new Set(faces.map((face) => face.id));
  const vertexNormals = new Map();
  for (const face of faces) {
    const normal = faceNormal(face, indexes);
    for (const id of face.vertices) {
      const sum = vertexNormals.get(id) || new THREE.Vector3();
      sum.add(normal);
      vertexNormals.set(id, sum);
    }
  }
  const duplicate = new Map();
  for (const [id, normal] of vertexNormals) {
    const source = indexes.vertexById.get(id).vertex;
    const next = new THREE.Vector3(...source.position).addScaledVector(normal.normalize(), distance);
    const duplicateId = uniqueId(`${id}-extrude`, "v-extrude", topology.vertices);
    topology.vertices.push({ ...cloneJson(source), id: duplicateId, position: next.toArray() });
    duplicate.set(id, duplicateId);
  }
  const boundaryEdges = [];
  for (const face of faces) {
    for (let i = 0; i < face.vertices.length; i += 1) {
      const a = face.vertices[i];
      const b = face.vertices[(i + 1) % face.vertices.length];
      const adjacent = indexes.edgeFaces.get(canonicalEdgeKey(a, b)) || [];
      if (adjacent.filter((id) => selected.has(id)).length === 1) boundaryEdges.push([a, b, face]);
    }
  }
  for (const face of faces) {
    topology.faces.push({
      ...cloneJson(face),
      id: uniqueId(`${face.id}-extrude`, "f-extrude", topology.faces),
      vertices: face.vertices.map((id) => duplicate.get(id)),
      part: operation.part ?? face.part
    });
  }
  for (const [a, b, sourceFace] of boundaryEdges) {
    topology.faces.push({
      id: uniqueId("f-extrude-side", "f-extrude-side", topology.faces),
      vertices: [a, b, duplicate.get(b), duplicate.get(a)],
      part: operation.sidePart || sourceFace.part,
      materialIndex: Math.max(0, Math.round(Number(operation.sideMaterialIndex ?? sourceFace.materialIndex) || 0)),
      smooth: operation.smoothSides === true
    });
  }
  if (operation.keepOriginal !== true && operation.removeOriginal !== false) {
    topology.faces = topology.faces.filter((face) => !selected.has(face.id));
  }
}

function insetFaces(topology, operation) {
  const faces = resolveFaces(topology, operation);
  const factor = THREE.MathUtils.clamp(Number(operation.factor ?? operation.amount) || 0.2, 0.000001, 0.999999);
  const indexes = buildTopologyIndexes(topology);
  for (const face of faces) {
    const center = new THREE.Vector3();
    for (const id of face.vertices) center.add(new THREE.Vector3(...indexes.vertexById.get(id).vertex.position));
    center.multiplyScalar(1 / face.vertices.length);
    const inner = [];
    for (const id of face.vertices) {
      const source = indexes.vertexById.get(id).vertex;
      const nextId = uniqueId(`${id}-inset`, "v-inset", topology.vertices);
      topology.vertices.push({ ...cloneJson(source), id: nextId, position: new THREE.Vector3(...source.position).lerp(center, factor).toArray() });
      inner.push(nextId);
    }
    const original = face.vertices.slice();
    face.vertices = inner;
    for (let i = 0; i < original.length; i += 1) {
      topology.faces.push({
        ...cloneJson(face),
        id: uniqueId(`${face.id}-inset-ring`, "f-inset", topology.faces),
        vertices: [original[i], original[(i + 1) % original.length], inner[(i + 1) % inner.length], inner[i]],
        part: operation.ringPart ?? face.part
      });
    }
  }
}

function bridgeLoops(topology, operation) {
  const a = Array.isArray(operation.loopA) ? operation.loopA.map(String) : [];
  const b = Array.isArray(operation.loopB) ? operation.loopB.map(String) : [];
  if (a.length < 2 || a.length !== b.length) throw new Error("bridgeLoops requires equally sized loopA and loopB arrays.");
  assertFaceVertices(topology, [...new Set([...a, ...b])]);
  const reverse = operation.reverse === true;
  for (let i = 0; i < a.length; i += 1) {
    const next = (i + 1) % a.length;
    const vertices = reverse ? [a[i], b[i], b[next], a[next]] : [a[i], a[next], b[next], b[i]];
    topology.faces.push({
      id: uniqueId("f-bridge", "f-bridge", topology.faces),
      vertices,
      part: String(operation.part || ""),
      materialIndex: Math.max(0, Math.round(Number(operation.materialIndex) || 0)),
      smooth: operation.smooth !== false
    });
  }
}

function interpolateAttributeValue(a, b, factor) {
  if (Number.isFinite(Number(a)) && Number.isFinite(Number(b))) {
    return Number(a) + (Number(b) - Number(a)) * factor;
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    const values = a.map((value, index) => interpolateAttributeValue(value, b[index], factor));
    return values.every((value) => value !== undefined) ? values : undefined;
  }
  return undefined;
}

function interpolateVertexRecord(a, b, factor, id) {
  const result = {
    ...cloneJson(a),
    id,
    position: a.position.map((value, index) => value + (b.position[index] - value) * factor)
  };
  if (a.attributes && b.attributes && typeof a.attributes === "object" && typeof b.attributes === "object") {
    const attributes = {};
    for (const key of new Set([...Object.keys(a.attributes), ...Object.keys(b.attributes)])) {
      const value = interpolateAttributeValue(a.attributes[key], b.attributes[key], factor);
      if (value !== undefined) attributes[key] = value;
    }
    if (Object.keys(attributes).length > 0) result.attributes = attributes;
  }
  return result;
}

function edgeIndexInFace(face, edgeA, edgeB) {
  for (let index = 0; index < face.vertices.length; index += 1) {
    const a = face.vertices[index];
    const b = face.vertices[(index + 1) % face.vertices.length];
    if ((a === edgeA && b === edgeB) || (a === edgeB && b === edgeA)) return index;
  }
  return -1;
}

function loopCut(topology, operation) {
  const factor = THREE.MathUtils.clamp(Number(operation.factor ?? operation.position ?? 0.5), 0.000001, 0.999999);
  if (!Number.isFinite(factor)) throw new Error("loopCut.position must be finite.");
  const indexes = buildTopologyIndexes(topology);
  const seedEdges = [];
  const requestedEdges = Array.isArray(operation.edges)
    ? operation.edges
    : Array.isArray(operation.edge)
      ? [operation.edge]
      : [];
  for (const raw of requestedEdges) {
    const edge = Array.isArray(raw) ? raw.slice(0, 2).map(String) : [];
    if (edge.length !== 2 || edge[0] === edge[1] || !indexes.vertexById.has(edge[0]) || !indexes.vertexById.has(edge[1])) {
      throw new Error("loopCut.edge/edges must contain two existing, distinct vertex IDs.");
    }
    if (!indexes.edgeFaces.has(canonicalEdgeKey(...edge))) throw new Error(`loopCut edge "${edge.join(" / ")}" is not used by a face.`);
    seedEdges.push(edge);
  }
  if (seedEdges.length === 0) {
    const faces = resolveFaces(topology, operation);
    const requestedIndex = Math.round(Number(operation.edgeIndex ?? 0));
    for (const face of faces) {
      if (face.vertices.length !== 4) throw new Error(`loopCut currently requires quad faces; "${face.id}" has ${face.vertices.length} vertices.`);
      const edgeIndex = Number.isInteger(requestedIndex)
        ? ((requestedIndex % 4) + 4) % 4
        : 0;
      seedEdges.push([face.vertices[edgeIndex], face.vertices[(edgeIndex + 1) % 4]]);
    }
  }

  const cutByEdge = new Map();
  const cutsByFace = new Map();

  const ensureCutVertex = (aId, bId, alongAB) => {
    const key = canonicalEdgeKey(aId, bId);
    const existing = cutByEdge.get(key);
    if (existing) return existing;
    const a = indexes.vertexById.get(aId)?.vertex;
    const b = indexes.vertexById.get(bId)?.vertex;
    if (!a || !b) throw new Error(`loopCut references missing edge vertex "${aId}" or "${bId}".`);
    const id = uniqueId(`${aId}-${bId}-cut`, "v-loop-cut", topology.vertices);
    topology.vertices.push(interpolateVertexRecord(a, b, alongAB, id));
    const record = { id, aId, bId, alongAB, key };
    cutByEdge.set(key, record);
    return record;
  };

  const fractionAlong = (record, aId, bId) => {
    if (record.aId === aId && record.bId === bId) return record.alongAB;
    if (record.aId === bId && record.bId === aId) return 1 - record.alongAB;
    throw new Error("loopCut encountered an inconsistent edge orientation.");
  };

  const queue = [];
  for (const [seedA, seedB] of seedEdges) {
    const seedCut = ensureCutVertex(seedA, seedB, factor);
    for (const faceId of indexes.edgeFaces.get(seedCut.key) || []) {
      queue.push({ faceId, enterEdgeKey: seedCut.key });
    }
  }

  while (queue.length > 0) {
    const current = queue.shift();
    const face = indexes.faceById.get(current.faceId)?.face;
    if (!face) continue;
    if (cutsByFace.has(face.id)) {
      const existing = cutsByFace.get(face.id);
      if (existing.enterEdgeKey !== current.enterEdgeKey && existing.oppositeEdgeKey !== current.enterEdgeKey) {
        throw new Error(`loopCut paths intersect on face "${face.id}"; split intersecting cuts into separate edits.`);
      }
      continue;
    }
    if (face.vertices.length !== 4) {
      // A propagated quad strip naturally terminates at a triangle or n-gon. A directly selected
      // non-quad was rejected above, so stopping here preserves the valid portion of the loop.
      continue;
    }
    const [edgeA, edgeB] = current.enterEdgeKey.split("\u0000");
    const enterIndex = edgeIndexInFace(face, edgeA, edgeB);
    if (enterIndex < 0) throw new Error(`loopCut could not resolve edge on face "${face.id}".`);
    const aId = face.vertices[enterIndex];
    const bId = face.vertices[(enterIndex + 1) % 4];
    const cId = face.vertices[(enterIndex + 2) % 4];
    const dId = face.vertices[(enterIndex + 3) % 4];
    const enterCut = cutByEdge.get(current.enterEdgeKey);
    const faceFactor = fractionAlong(enterCut, aId, bId);
    // In ordered quad [a,b,c,d], the corresponding point on the opposite edge runs d -> c.
    // Expressed in that face's stored c -> d direction, its interpolation factor is 1-t.
    const oppositeCut = ensureCutVertex(cId, dId, 1 - faceFactor);
    cutsByFace.set(face.id, {
      face,
      enterEdgeKey: current.enterEdgeKey,
      oppositeEdgeKey: oppositeCut.key,
      aId,
      bId,
      cId,
      dId,
      enterCutId: enterCut.id,
      oppositeCutId: oppositeCut.id
    });
    if (operation.propagate !== false) {
      for (const adjacentFaceId of indexes.edgeFaces.get(oppositeCut.key) || []) {
        if (adjacentFaceId !== face.id) queue.push({ faceId: adjacentFaceId, enterEdgeKey: oppositeCut.key });
      }
    }
  }

  if (cutsByFace.size === 0) throw new Error("loopCut did not find a quad strip to cut.");

  const splitCreases = new Map();
  for (const cut of cutByEdge.values()) {
    const explicit = topology.edges.find((edge) => canonicalEdgeKey(...edge.vertices) === cut.key);
    if (!explicit) continue;
    splitCreases.set(cut.key, {
      source: explicit,
      children: [
        { ...cloneJson(explicit), vertices: [cut.aId, cut.id] },
        { ...cloneJson(explicit), vertices: [cut.id, cut.bId] }
      ]
    });
  }
  if (splitCreases.size > 0) {
    topology.edges = topology.edges.filter((edge) => !splitCreases.has(canonicalEdgeKey(...edge.vertices)));
    for (const { children } of splitCreases.values()) topology.edges.push(...children);
  }

  for (const cut of cutsByFace.values()) {
    const source = cut.face;
    source.vertices = [cut.aId, cut.enterCutId, cut.oppositeCutId, cut.dId];
    topology.faces.push({
      ...cloneJson(source),
      id: uniqueId(`${source.id}-loop`, "f-loop-cut", topology.faces),
      vertices: [cut.enterCutId, cut.bId, cut.cId, cut.oppositeCutId]
    });
    if (operation.crease != null) {
      const crease = THREE.MathUtils.clamp(Number(operation.crease) || 0, 0, 1);
      topology.edges.push({ vertices: [cut.enterCutId, cut.oppositeCutId], crease });
    }
  }
}

function bevelEdges(topology, operation) {
  const edges = Array.isArray(operation.edges) ? operation.edges : [];
  if (edges.length > 0) {
    const amount = THREE.MathUtils.clamp(Number(operation.factor ?? operation.amount) || 0.08, 0.000001, 0.499999);
    for (const rawEdge of edges) {
      const requested = Array.isArray(rawEdge) ? rawEdge.slice(0, 2).map(String) : [];
      if (requested.length !== 2 || requested[0] === requested[1]) {
        throw new Error("bevelEdges.edges must contain pairs of distinct vertex IDs.");
      }
      const indexes = buildTopologyIndexes(topology);
      const key = canonicalEdgeKey(...requested);
      const adjacent = indexes.edgeFaces.get(key) || [];
      if (adjacent.length !== 2) {
        throw new Error(`bevelEdges currently requires a two-sided manifold edge; "${requested.join(" / ")}" has ${adjacent.length} adjacent face(s).`);
      }
      const sides = [];
      for (const faceId of adjacent) {
        const face = indexes.faceById.get(faceId)?.face;
        const edgeIndex = edgeIndexInFace(face, requested[0], requested[1]);
        if (!face || edgeIndex < 0) throw new Error(`bevelEdges could not resolve edge on face "${faceId}".`);
        const startId = face.vertices[edgeIndex];
        const endId = face.vertices[(edgeIndex + 1) % face.vertices.length];
        const center = new THREE.Vector3();
        for (const id of face.vertices) center.add(new THREE.Vector3(...indexes.vertexById.get(id).vertex.position));
        center.multiplyScalar(1 / face.vertices.length);
        const start = indexes.vertexById.get(startId).vertex;
        const end = indexes.vertexById.get(endId).vertex;
        const startInsetId = uniqueId(`${startId}-${face.id}-bevel`, "v-bevel", topology.vertices);
        topology.vertices.push({
          ...cloneJson(start),
          id: startInsetId,
          position: new THREE.Vector3(...start.position).lerp(center, amount).toArray()
        });
        const endInsetId = uniqueId(`${endId}-${face.id}-bevel`, "v-bevel", topology.vertices);
        topology.vertices.push({
          ...cloneJson(end),
          id: endInsetId,
          position: new THREE.Vector3(...end.position).lerp(center, amount).toArray()
        });
        const vertices = [];
        for (let index = 0; index < face.vertices.length; index += 1) {
          vertices.push(face.vertices[index]);
          if (index === edgeIndex) vertices.push(startInsetId, endInsetId);
        }
        face.vertices = vertices;
        sides.push({ face, startId, endId, startInsetId, endInsetId });
      }
      const first = sides[0];
      const second = sides[1];
      const secondStartAtFirstEnd = second.startId === first.endId;
      const secondEndInsetId = secondStartAtFirstEnd ? second.startInsetId : second.endInsetId;
      const secondStartInsetId = secondStartAtFirstEnd ? second.endInsetId : second.startInsetId;
      const materialIndex = Math.max(0, Math.round(Number(operation.materialIndex ?? first.face.materialIndex) || 0));
      const part = String(operation.part ?? first.face.part ?? "");
      topology.faces.push(
        {
          id: uniqueId("f-bevel-strip", "f-bevel-strip", topology.faces),
          vertices: [first.startInsetId, first.endInsetId, secondEndInsetId, secondStartInsetId],
          part,
          materialIndex,
          smooth: operation.smooth !== false
        },
        {
          id: uniqueId("f-bevel-cap", "f-bevel-cap", topology.faces),
          vertices: [first.startId, secondStartInsetId, first.startInsetId],
          part,
          materialIndex,
          smooth: operation.smoothCaps === true
        },
        {
          id: uniqueId("f-bevel-cap", "f-bevel-cap", topology.faces),
          vertices: [first.endId, first.endInsetId, secondEndInsetId],
          part,
          materialIndex,
          smooth: operation.smoothCaps === true
        }
      );
      topology.edges = topology.edges.filter((edge) => canonicalEdgeKey(...edge.vertices) !== key);
      if (operation.crease != null) {
        const crease = THREE.MathUtils.clamp(Number(operation.crease) || 0, 0, 1);
        topology.edges.push(
          { vertices: [first.startInsetId, first.endInsetId], crease },
          { vertices: [secondStartInsetId, secondEndInsetId], crease }
        );
      }
    }
    return;
  }

  const indexes = buildTopologyIndexes(topology);
  const faceIds = new Set(
    Array.isArray(operation.faceIds) ? operation.faceIds.map(String) : []
  );
  if (faceIds.size === 0) {
    throw new Error("bevelEdges requires faceIds or edges:[[vertexA,vertexB],...].");
  }
  for (const faceId of faceIds) {
    if (!indexes.faceById.has(faceId)) throw new Error(`bevelEdges references unknown face "${faceId}".`);
  }
  insetFaces(topology, { faceIds: [...faceIds], factor: operation.factor ?? operation.amount ?? 0.08, ringPart: operation.part });
  const distance = Number(operation.distance);
  if (Number.isFinite(distance) && Math.abs(distance) > 0) extrudeFaces(topology, { faceIds: [...faceIds], distance, sidePart: operation.part });
}

function setModifier(record, operation) {
  if (!Array.isArray(record.modifiers)) record.modifiers = [];
  const descriptor = cloneJson(operation.modifier || operation.value || {});
  if (!descriptor || typeof descriptor !== "object") throw new Error("setModifier requires modifier object.");
  const id = String(operation.id || descriptor.id || "").trim();
  const index = id ? record.modifiers.findIndex((item) => item?.id === id) : Number.isInteger(operation.index) ? operation.index : -1;
  if (index >= 0 && index < record.modifiers.length) record.modifiers[index] = { ...record.modifiers[index], ...descriptor, ...(id ? { id } : {}) };
  else record.modifiers.push({ ...descriptor, ...(id ? { id } : {}) });
}

function setModifiers(record, operation) {
  const modifiers = operation.modifiers ?? operation.value;
  if (!Array.isArray(modifiers)) throw new Error("setModifiers requires a modifiers array.");
  record.modifiers = cloneJson(modifiers);
}

function reorderModifier(record, operation) {
  if (!Array.isArray(record.modifiers)) record.modifiers = [];
  const from = operation.id
    ? record.modifiers.findIndex((item) => item?.id === operation.id)
    : Math.round(Number(operation.from));
  const to = Math.round(Number(operation.to));
  if (!Number.isInteger(from) || from < 0 || from >= record.modifiers.length || !Number.isInteger(to) || to < 0 || to >= record.modifiers.length) {
    throw new Error("reorderModifier requires valid from/id and to values.");
  }
  const [item] = record.modifiers.splice(from, 1);
  record.modifiers.splice(to, 0, item);
}

function entityMap(list, keyFn = (item) => item.id) {
  return new Map((list || []).map((item) => [keyFn(item), item]));
}

function diffList(before, after, keyFn) {
  const beforeMap = entityMap(before, keyFn);
  const afterMap = entityMap(after, keyFn);
  const added = [];
  const removed = [];
  const changed = [];
  for (const [id, item] of afterMap) {
    if (!beforeMap.has(id)) added.push(cloneJson(item));
    else if (JSON.stringify(beforeMap.get(id)) !== JSON.stringify(item)) changed.push({ before: cloneJson(beforeMap.get(id)), after: cloneJson(item) });
  }
  for (const [id, item] of beforeMap) if (!afterMap.has(id)) removed.push(cloneJson(item));
  return { added, removed, changed };
}

export function createEditableTopologyDiff(before, after, beforeModifiers, afterModifiers) {
  const diff = {
    fromRevision: before.revision,
    toRevision: after.revision,
    vertices: diffList(before.vertices, after.vertices, (item) => item.id),
    faces: diffList(before.faces, after.faces, (item) => item.id),
    edges: diffList(before.edges, after.edges, (item) => canonicalEdgeKey(...item.vertices))
  };
  if (JSON.stringify(beforeModifiers || []) !== JSON.stringify(afterModifiers || [])) {
    diff.modifiers = {
      before: cloneJson(beforeModifiers || []),
      after: cloneJson(afterModifiers || [])
    };
  }
  return diff;
}

export function invertEditableTopologyDiff(diff) {
  const invert = (section) => ({
    added: cloneJson(section.removed),
    removed: cloneJson(section.added),
    changed: section.changed.map((item) => ({ before: cloneJson(item.after), after: cloneJson(item.before) }))
  });
  const inverted = {
    fromRevision: diff.toRevision,
    toRevision: diff.fromRevision,
    vertices: invert(diff.vertices),
    faces: invert(diff.faces),
    edges: invert(diff.edges)
  };
  if (diff.modifiers) {
    inverted.modifiers = {
      before: cloneJson(diff.modifiers.after || []),
      after: cloneJson(diff.modifiers.before || [])
    };
  }
  return inverted;
}

function applyListDiff(list, diff, keyFn) {
  const map = entityMap(list, keyFn);
  for (const item of diff.removed || []) map.delete(keyFn(item));
  for (const item of diff.changed || []) map.set(keyFn(item.after), cloneJson(item.after));
  for (const item of diff.added || []) map.set(keyFn(item), cloneJson(item));
  return [...map.values()];
}

export function applyEditableTopologyDiff(input, diff) {
  const topology = cloneEditableMeshTopology(input);
  topology.vertices = applyListDiff(topology.vertices, diff.vertices || {}, (item) => item.id);
  topology.faces = applyListDiff(topology.faces, diff.faces || {}, (item) => item.id);
  topology.edges = applyListDiff(topology.edges, diff.edges || {}, (item) => canonicalEdgeKey(...item.vertices));
  topology.revision = Number.isSafeInteger(diff.toRevision) ? diff.toRevision : topology.revision + 1;
  return normalizeEditableMeshTopology(topology);
}

export function applyEditableMeshOperations(record, operations = []) {
  const nextRecord = cloneJson(record);
  const beforeTopology = normalizeEditableMeshTopology(nextRecord.topology || {});
  const beforeModifiers = cloneJson(Array.isArray(nextRecord.modifiers) ? nextRecord.modifiers : []);
  let topology = cloneEditableMeshTopology(beforeTopology);
  let appliedExplicitDiff = false;
  for (const raw of Array.isArray(operations) ? operations : []) {
    const operation = raw && typeof raw === "object" ? raw : {};
    const type = String(operation.type || operation.op || "").trim();
    if (type === "addVertex") addVertex(topology, operation);
    else if (type === "setVertex") setVertex(topology, operation);
    else if (type === "removeVertex") removeVertex(topology, operation);
    else if (type === "addFace") addFace(topology, operation);
    else if (type === "setFace") setFace(topology, operation);
    else if (type === "removeFace") removeFace(topology, operation);
    else if (type === "assignPart") assignPart(topology, operation);
    else if (type === "setEdgeCrease") setEdgeCrease(topology, operation);
    else if (type === "extrudeFaces") extrudeFaces(topology, operation);
    else if (type === "insetFaces") insetFaces(topology, operation);
    else if (type === "bevelEdges") bevelEdges(topology, operation);
    else if (type === "bridgeLoops") bridgeLoops(topology, operation);
    else if (type === "loopCut") loopCut(topology, operation);
    else if (type === "mirror") topology = mirrorEditableTopology(topology, operation);
    else if (type === "setModifier") setModifier(nextRecord, operation);
    else if (type === "setModifiers") setModifiers(nextRecord, operation);
    else if (type === "reorderModifier") reorderModifier(nextRecord, operation);
    else if (type === "applyDiff") {
      topology = applyEditableTopologyDiff(topology, operation.diff || {});
      if (operation.diff?.modifiers) nextRecord.modifiers = cloneJson(operation.diff.modifiers.after || []);
      appliedExplicitDiff = true;
    }
    else throw new Error(`Unsupported editable mesh operation \"${type}\".`);
  }
  if (!appliedExplicitDiff) topology.revision = beforeTopology.revision + 1;
  const validation = validateEditableMeshTopology(topology);
  if (!validation.ok) throw new Error(validation.errors[0]?.message || "Mesh operation produced invalid topology.");
  nextRecord.topology = topology;
  nextRecord.modifiers = Array.isArray(nextRecord.modifiers) ? nextRecord.modifiers : [];
  return {
    record: nextRecord,
    topology,
    diff: createEditableTopologyDiff(beforeTopology, topology, beforeModifiers, nextRecord.modifiers),
    validation
  };
}

import * as THREE from "three";

function cloneJson(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function asPosition(value) {
  const source = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? [value.x, value.y, value.z]
      : [];
  const position = [Number(source[0]), Number(source[1]), Number(source[2])];
  return position.every(Number.isFinite) ? position : null;
}

function stableId(value, prefix, index, used) {
  const requested = typeof value === "string" ? value.trim() : "";
  let candidate = requested || `${prefix}-${index + 1}`;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${requested || `${prefix}-${index + 1}`}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

export function normalizeEditableMeshTopology(input = {}, options = {}) {
  const source = input && typeof input === "object" ? input : {};
  const vertexIds = new Set();
  const faceIds = new Set();
  const vertices = [];
  for (let i = 0; i < (Array.isArray(source.vertices) ? source.vertices.length : 0); i += 1) {
    const raw = source.vertices[i];
    const position = asPosition(raw?.position ?? raw);
    if (!position) throw new Error(`editableMesh vertex ${i} has an invalid position.`);
    const id = stableId(raw?.id, "v", i, vertexIds);
    const vertex = { ...cloneJson(raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}), id, position };
    vertices.push(vertex);
  }
  const knownVertices = new Set(vertices.map((vertex) => vertex.id));
  const faces = [];
  for (let i = 0; i < (Array.isArray(source.faces) ? source.faces.length : 0); i += 1) {
    const raw = source.faces[i];
    const ids = Array.isArray(raw?.vertices) ? raw.vertices.map((id) => String(id || "").trim()).filter(Boolean) : [];
    if (ids.length < 3) throw new Error(`editableMesh face ${i} needs at least three vertices.`);
    const missing = ids.find((id) => !knownVertices.has(id));
    if (missing) throw new Error(`editableMesh face ${i} references missing vertex \"${missing}\".`);
    const id = stableId(raw?.id, "f", i, faceIds);
    faces.push({
      ...cloneJson(raw && typeof raw === "object" ? raw : {}),
      id,
      vertices: ids,
      part: typeof raw?.part === "string" ? raw.part : "",
      materialIndex: Math.max(0, Math.round(Number(raw?.materialIndex) || 0)),
      smooth: raw?.smooth !== false
    });
  }
  const edges = [];
  const edgeKeys = new Set();
  for (const raw of Array.isArray(source.edges) ? source.edges : []) {
    const ids = Array.isArray(raw?.vertices) ? raw.vertices.slice(0, 2).map((id) => String(id || "").trim()) : [];
    if (ids.length !== 2 || ids[0] === ids[1] || !ids.every((id) => knownVertices.has(id))) continue;
    const key = canonicalEdgeKey(ids[0], ids[1]);
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push({
      ...cloneJson(raw),
      vertices: ids,
      crease: THREE.MathUtils.clamp(Number(raw?.crease) || 0, 0, 1)
    });
  }
  const revision = Number.isSafeInteger(Number(source.revision)) && Number(source.revision) >= 0
    ? Number(source.revision)
    : Math.max(0, Math.round(Number(options.revision) || 0));
  return { vertices, faces, edges, revision };
}

export function canonicalEdgeKey(a, b) {
  return String(a) < String(b) ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

export function buildTopologyIndexes(topology) {
  const vertexById = new Map((topology?.vertices || []).map((vertex, index) => [vertex.id, { vertex, index }]));
  const faceById = new Map((topology?.faces || []).map((face, index) => [face.id, { face, index }]));
  const edgeFaces = new Map();
  for (const face of topology?.faces || []) {
    for (let i = 0; i < face.vertices.length; i += 1) {
      const a = face.vertices[i];
      const b = face.vertices[(i + 1) % face.vertices.length];
      const key = canonicalEdgeKey(a, b);
      const list = edgeFaces.get(key) || [];
      list.push(face.id);
      edgeFaces.set(key, list);
    }
  }
  const creaseByEdge = new Map((topology?.edges || []).map((edge) => [canonicalEdgeKey(...edge.vertices), Number(edge.crease) || 0]));
  return { vertexById, faceById, edgeFaces, creaseByEdge };
}

function newellNormal(face, vertexById) {
  const normal = new THREE.Vector3();
  for (let i = 0; i < face.vertices.length; i += 1) {
    const current = vertexById.get(face.vertices[i])?.vertex?.position;
    const next = vertexById.get(face.vertices[(i + 1) % face.vertices.length])?.vertex?.position;
    if (!current || !next) continue;
    normal.x += (current[1] - next[1]) * (current[2] + next[2]);
    normal.y += (current[2] - next[2]) * (current[0] + next[0]);
    normal.z += (current[0] - next[0]) * (current[1] + next[1]);
  }
  return normal;
}

function projectFaceTo2D(face, vertexById) {
  const normal = newellNormal(face, vertexById);
  const ax = Math.abs(normal.x);
  const ay = Math.abs(normal.y);
  const az = Math.abs(normal.z);
  const drop = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
  return face.vertices.map((id) => {
    const position = vertexById.get(id).vertex.position;
    if (drop === 0) return new THREE.Vector2(position[1], position[2]);
    if (drop === 1) return new THREE.Vector2(position[0], position[2]);
    return new THREE.Vector2(position[0], position[1]);
  });
}

export function triangulateEditableFace(face, vertexById) {
  if (face.vertices.length === 3) return [[0, 1, 2]];
  const projected = projectFaceTo2D(face, vertexById);
  const triangles = THREE.ShapeUtils.triangulateShape(projected, []);
  if (triangles.length > 0) return triangles;
  const fallback = [];
  for (let i = 1; i < face.vertices.length - 1; i += 1) fallback.push([0, i, i + 1]);
  return fallback;
}

function faceArea(face, vertexById) {
  const triangles = triangulateEditableFace(face, vertexById);
  let area = 0;
  for (const triangle of triangles) {
    const a = new THREE.Vector3(...vertexById.get(face.vertices[triangle[0]]).vertex.position);
    const b = new THREE.Vector3(...vertexById.get(face.vertices[triangle[1]]).vertex.position);
    const c = new THREE.Vector3(...vertexById.get(face.vertices[triangle[2]]).vertex.position);
    area += b.sub(a).cross(c.sub(a)).length() * 0.5;
  }
  return area;
}

function faceBounds(face, vertexById) {
  const box = new THREE.Box3();
  for (const id of face.vertices) {
    box.expandByPoint(new THREE.Vector3(...vertexById.get(id).vertex.position));
  }
  return box;
}

function boxesOverlap(a, b, epsilon = 1e-9) {
  return a.min.x <= b.max.x + epsilon && a.max.x + epsilon >= b.min.x
    && a.min.y <= b.max.y + epsilon && a.max.y + epsilon >= b.min.y
    && a.min.z <= b.max.z + epsilon && a.max.z + epsilon >= b.min.z;
}

function collectSelfIntersectionRisks(topology, vertexById) {
  const entries = topology.faces.map((face) => ({
    face,
    vertices: new Set(face.vertices),
    box: faceBounds(face, vertexById)
  })).sort((a, b) => a.box.min.x - b.box.min.x);
  const warnings = [];
  const active = [];
  for (const current of entries) {
    for (let i = active.length - 1; i >= 0; i -= 1) {
      if (active[i].box.max.x < current.box.min.x - 1e-9) active.splice(i, 1);
    }
    for (const other of active) {
      if ([...current.vertices].some((id) => other.vertices.has(id))) continue;
      if (!boxesOverlap(current.box, other.box)) continue;
      warnings.push({
        code: "W_EDITABLE_MESH_SELF_INTERSECTION_RISK",
        faceIds: [other.face.id, current.face.id],
        message: `Non-adjacent faces ${other.face.id} and ${current.face.id} have overlapping bounds; inspect them for self-intersection.`
      });
    }
    active.push(current);
  }
  return warnings;
}

export function validateEditableMeshTopology(input = {}, options = {}) {
  let topology;
  try {
    topology = normalizeEditableMeshTopology(input);
  } catch (error) {
    return { ok: false, errors: [{ code: "E_EDITABLE_MESH_SCHEMA", message: String(error?.message || error) }], warnings: [], statistics: {} };
  }
  const { vertexById, edgeFaces } = buildTopologyIndexes(topology);
  const errors = [];
  const warnings = [];
  const directedEdges = new Map();
  if (topology.vertices.length < 3) {
    errors.push({ code: "E_EDITABLE_MESH_VERTEX_COUNT", message: "editableMesh needs at least three control vertices." });
  }
  if (topology.faces.length < 1) {
    errors.push({ code: "E_EDITABLE_MESH_FACE_COUNT", message: "editableMesh needs at least one control face." });
  }
  const usedVertices = new Set();
  const faceSignatures = new Map();
  for (const face of topology.faces) {
    const unique = new Set(face.vertices);
    if (unique.size !== face.vertices.length) {
      errors.push({ code: "E_EDITABLE_MESH_FACE_REPEAT", faceId: face.id, message: `Face ${face.id} repeats a vertex.` });
    }
    if (faceArea(face, vertexById) <= 1e-12) {
      errors.push({ code: "E_EDITABLE_MESH_DEGENERATE_FACE", faceId: face.id, message: `Face ${face.id} is degenerate.` });
    }
    face.vertices.forEach((id) => usedVertices.add(id));
    const signature = [...face.vertices].sort().join("\u0000");
    if (faceSignatures.has(signature)) {
      errors.push({ code: "E_EDITABLE_MESH_DUPLICATE_FACE", faceId: face.id, otherFaceId: faceSignatures.get(signature), message: `Face ${face.id} duplicates another face.` });
    } else {
      faceSignatures.set(signature, face.id);
    }
    for (let i = 0; i < face.vertices.length; i += 1) {
      const a = face.vertices[i];
      const b = face.vertices[(i + 1) % face.vertices.length];
      const key = canonicalEdgeKey(a, b);
      const occurrences = directedEdges.get(key) || [];
      occurrences.push({ faceId: face.id, a, b });
      directedEdges.set(key, occurrences);
    }
  }
  for (const [edge, faces] of edgeFaces) {
    if (faces.length > 2) errors.push({ code: "E_EDITABLE_MESH_NON_MANIFOLD_EDGE", edge, faceIds: faces, message: `Edge ${edge.replace("\u0000", " / ")} is shared by ${faces.length} faces.` });
    if (faces.length === 1) warnings.push({ code: "W_EDITABLE_MESH_BOUNDARY_EDGE", edge, faceIds: faces, message: "Boundary edge." });
    const directions = directedEdges.get(edge) || [];
    if (directions.length === 2 && directions[0].a === directions[1].a && directions[0].b === directions[1].b) {
      warnings.push({
        code: "W_EDITABLE_MESH_WINDING",
        edge,
        faceIds: directions.map((entry) => entry.faceId),
        message: `Adjacent faces traverse edge ${edge.replace("\u0000", " / ")} in the same direction; one face may have reversed winding.`
      });
    }
  }
  for (const vertex of topology.vertices) {
    if (!usedVertices.has(vertex.id)) warnings.push({ code: "W_EDITABLE_MESH_DANGLING_VERTEX", vertexId: vertex.id, message: `Vertex ${vertex.id} is not used by any face.` });
  }
  if (options.checkSelfIntersectionRisk === true) {
    warnings.push(...collectSelfIntersectionRisks(topology, vertexById));
  }
  const parts = [...new Set(topology.faces.map((face) => face.part).filter(Boolean))];
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    topology,
    statistics: {
      vertexCount: topology.vertices.length,
      faceCount: topology.faces.length,
      edgeCount: edgeFaces.size,
      triangleCount: topology.faces.reduce((sum, face) => sum + Math.max(1, face.vertices.length - 2), 0),
      triangleFaceCount: topology.faces.filter((face) => face.vertices.length === 3).length,
      quadFaceCount: topology.faces.filter((face) => face.vertices.length === 4).length,
      ngonFaceCount: topology.faces.filter((face) => face.vertices.length > 4).length,
      allControlFacesTriangles: topology.faces.length > 0 && topology.faces.every((face) => face.vertices.length === 3),
      partCount: parts.length,
      parts,
      nonManifoldEdgeCount: errors.filter((item) => item.code === "E_EDITABLE_MESH_NON_MANIFOLD_EDGE").length,
      boundaryEdgeCount: warnings.filter((item) => item.code === "W_EDITABLE_MESH_BOUNDARY_EDGE").length,
      windingWarningCount: warnings.filter((item) => item.code === "W_EDITABLE_MESH_WINDING").length,
      selfIntersectionRiskCount: warnings.filter((item) => item.code === "W_EDITABLE_MESH_SELF_INTERSECTION_RISK").length
    }
  };
}

export function cloneEditableMeshTopology(topology) {
  return normalizeEditableMeshTopology(cloneJson(topology));
}

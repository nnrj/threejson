import * as THREE from "three";
import { cloneEditableMeshTopology, buildTopologyIndexes, canonicalEdgeKey } from "./editableMeshTopology.js";
const cloneJson = (value) => structuredClone(value);
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

function edgeIndexInFace(face, edgeA, edgeB) {
  for (let index = 0; index < face.vertices.length; index += 1) {
    const a = face.vertices[index];
    const b = face.vertices[(index + 1) % face.vertices.length];
    if ((a === edgeA && b === edgeB) || (a === edgeB && b === edgeA)) return index;
  }
  return -1;
}


/** Deterministic manifold edge chamfers, shared by modifiers and runtime commands. */
export function bevelTopologyEdges(input, operation = {}) {
  const topology = cloneEditableMeshTopology(input);
  const indexes = buildTopologyIndexes(topology);
  let edges = Array.isArray(operation.edges) ? operation.edges : [];
  if (!edges.length) {
    const faceIds = new Set((operation.faceIds || []).map(String));
    for (const id of faceIds) if (!indexes.faceById.has(id)) throw new Error(`Unknown bevel face: ${id}.`);
    const parts = new Set(operation.parts || []);
    const selected = new Map();
    for (const face of topology.faces) {
      if (faceIds.size && !faceIds.has(face.id)) continue;
      if (parts.size && !parts.has(face.part)) continue;
      for (let i = 0; i < face.vertices.length; i++) {
        const pair = [face.vertices[i], face.vertices[(i + 1) % face.vertices.length]];
        selected.set(canonicalEdgeKey(...pair), pair);
      }
    }
    edges = [...selected.values()];
  }
    const amount = Number(operation.factor ?? operation.amount ?? 0.08);
    if (!Number.isFinite(amount) || amount <= 0 || amount >= 0.5) throw new Error("Bevel factor must be in (0,0.5).");
    const distance = operation.distance == null ? null : Number(operation.distance);
    if (distance !== null && (!Number.isFinite(distance) || distance <= 0)) throw new Error("Bevel distance must be positive and finite.");
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
        let insetFactor = amount;
        if (distance !== null) {
          const edge = new THREE.Vector3(...end.position).sub(new THREE.Vector3(...start.position)).normalize();
          const inward = center.clone().sub(new THREE.Vector3(...start.position));
          const perpendicular = inward.addScaledVector(edge, -inward.dot(edge)).length();
          insetFactor = distance / perpendicular;
          if (!Number.isFinite(insetFactor) || insetFactor >= 1) throw new Error("Bevel distance exceeds the adjacent face interior.");
        }
        const startInsetId = uniqueId(`${startId}-${face.id}-bevel`, "v-bevel", topology.vertices);
        topology.vertices.push({
          ...cloneJson(start),
          id: startInsetId,
          position: new THREE.Vector3(...start.position).lerp(center, insetFactor).toArray()
        });
        const endInsetId = uniqueId(`${endId}-${face.id}-bevel`, "v-bevel", topology.vertices);
        topology.vertices.push({
          ...cloneJson(end),
          id: endInsetId,
          position: new THREE.Vector3(...end.position).lerp(center, insetFactor).toArray()
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
      if (second.startId !== first.endId) throw new Error("Bevel requires consistent adjacent face winding.");
      const secondStartAtFirstEnd = true;
      const secondEndInsetId = secondStartAtFirstEnd ? second.startInsetId : second.endInsetId;
      const secondStartInsetId = secondStartAtFirstEnd ? second.endInsetId : second.startInsetId;
      const materialIndex = Math.max(0, Math.round(Number(operation.materialIndex ?? first.face.materialIndex) || 0));
      const part = String(operation.part ?? first.face.part ?? "");
      topology.faces.push(
        {
          id: uniqueId("f-bevel-strip", "f-bevel-strip", topology.faces),
          vertices: [first.endInsetId, first.startInsetId, secondStartInsetId, secondEndInsetId],
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
  return topology;
}

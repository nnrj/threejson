/** Runtime builder for AI-friendly stable-ID control meshes. */
import * as THREE from "three";
import { log } from "../../util/logger.js";
import { trackDisposableResource } from "../../handler/trackedResourceRegistry.js";
import { registerObject } from "../../handler/objectRegistry.js";
import { setUserDataObjJson } from "../../handler/objectDescriptorAttach.js";
import { buildBufferMeshMaterials, applyBufferMeshRecord } from "../bufferMeshBuilder.js";
import { validateBufferMeshStats } from "../bufferMeshLimits.js";
import {
  buildTopologyIndexes,
  normalizeEditableMeshTopology,
  triangulateEditableFace,
  validateEditableMeshTopology
} from "./editableMeshTopology.js";
import { applyEditableMeshModifiers } from "./editableMeshModifiers.js";

function normalizeProjection(record = {}) {
  const explicit = record.uvProjection || record.geometry?.uvProjection;
  if (typeof explicit === "string") return { type: explicit };
  if (explicit && typeof explicit === "object") return explicit;
  const modifier = [...(Array.isArray(record.modifiers) ? record.modifiers : [])]
    .reverse()
    .find((item) => /^uv/i.test(String(item?.type || item?.kind || "")));
  return modifier || null;
}

function safeSpan(value) {
  return Math.abs(value) > 1e-12 ? value : 1;
}

function buildProjectedUvs(positions, projection = {}) {
  const box = new THREE.Box3();
  for (const position of positions) box.expandByPoint(new THREE.Vector3(...position));
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const type = String(projection?.type || projection?.kind || "planar").trim().toLowerCase().replace(/^uv[-_]?/, "");
  const axis = String(projection.axis || "y").toLowerCase();
  const uvs = new Float32Array(positions.length * 2);
  for (let i = 0; i < positions.length; i += 1) {
    const p = new THREE.Vector3(...positions[i]);
    let u = 0;
    let v = 0;
    if (type === "spherical" || type === "sphere") {
      p.sub(center).normalize();
      u = 0.5 + Math.atan2(p.z, p.x) / (Math.PI * 2);
      v = 0.5 - Math.asin(THREE.MathUtils.clamp(p.y, -1, 1)) / Math.PI;
    } else if (type === "cylindrical" || type === "cylinder") {
      p.sub(center);
      u = 0.5 + Math.atan2(p.z, p.x) / (Math.PI * 2);
      v = (positions[i][1] - box.min.y) / safeSpan(size.y);
    } else if (type === "box" || type === "triplanar") {
      const normalized = p.clone().sub(center);
      const ax = Math.abs(normalized.x / safeSpan(size.x));
      const ay = Math.abs(normalized.y / safeSpan(size.y));
      const az = Math.abs(normalized.z / safeSpan(size.z));
      if (ax >= ay && ax >= az) {
        u = (positions[i][2] - box.min.z) / safeSpan(size.z);
        v = (positions[i][1] - box.min.y) / safeSpan(size.y);
      } else if (ay >= az) {
        u = (positions[i][0] - box.min.x) / safeSpan(size.x);
        v = (positions[i][2] - box.min.z) / safeSpan(size.z);
      } else {
        u = (positions[i][0] - box.min.x) / safeSpan(size.x);
        v = (positions[i][1] - box.min.y) / safeSpan(size.y);
      }
    } else if (axis === "x") {
      u = (positions[i][2] - box.min.z) / safeSpan(size.z);
      v = (positions[i][1] - box.min.y) / safeSpan(size.y);
    } else if (axis === "z") {
      u = (positions[i][0] - box.min.x) / safeSpan(size.x);
      v = (positions[i][1] - box.min.y) / safeSpan(size.y);
    } else {
      u = (positions[i][0] - box.min.x) / safeSpan(size.x);
      v = (positions[i][2] - box.min.z) / safeSpan(size.z);
    }
    uvs[i * 2] = u * (Number(projection.scaleU) || 1) + (Number(projection.offsetU) || 0);
    uvs[i * 2 + 1] = v * (Number(projection.scaleV) || 1) + (Number(projection.offsetV) || 0);
  }
  return uvs;
}

function buildExplicitVertexAttribute(topology, name, itemSize, fallback = null) {
  const values = [];
  let found = false;
  for (const vertex of topology.vertices) {
    const raw = vertex?.attributes?.[name] ?? vertex?.[name];
    const source = Array.isArray(raw) ? raw : null;
    if (source) found = true;
    for (let i = 0; i < itemSize; i += 1) values.push(Number(source?.[i] ?? fallback?.[i] ?? 0));
  }
  return found && values.every(Number.isFinite) ? new Float32Array(values) : null;
}

/**
 * Evaluate control topology and modifiers into a deterministic BufferGeometry.
 * @param {object} record
 * @param {{meshBudget?: object}} [options]
 */
export function buildEditableMeshGeometry(record = {}, options = {}) {
  let sourceTopology;
  let evaluated;
  const geometry = new THREE.BufferGeometry();
  try {
    sourceTopology = normalizeEditableMeshTopology(record.topology || {});
    const sourceValidation = validateEditableMeshTopology(sourceTopology);
    if (!sourceValidation.ok) {
      const first = sourceValidation.errors[0];
      const error = new Error(first?.message || "Invalid editableMesh topology.");
      error.code = first?.code || "E_EDITABLE_MESH_TOPOLOGY";
      throw error;
    }
    const result = applyEditableMeshModifiers(sourceTopology, record.modifiers || []);
    evaluated = normalizeEditableMeshTopology(result.topology, { revision: sourceTopology.revision });
    const evaluatedValidation = validateEditableMeshTopology(evaluated);
    if (!evaluatedValidation.ok) {
      const first = evaluatedValidation.errors[0];
      const error = new Error(first?.message || "A modifier produced invalid editableMesh topology.");
      error.code = first?.code || "E_EDITABLE_MESH_MODIFIER";
      throw error;
    }

    const { vertexById } = buildTopologyIndexes(evaluated);
    const positions = evaluated.vertices.map((vertex) => vertex.position);
    const positionArray = new Float32Array(positions.length * 3);
    for (let i = 0; i < positions.length; i += 1) positionArray.set(positions[i], i * 3);
    geometry.setAttribute("position", new THREE.BufferAttribute(positionArray, 3));

    const indices = [];
    let groupStart = 0;
    let groupCount = 0;
    let groupMaterial = null;
    const flushGroup = () => {
      if (groupCount > 0) geometry.addGroup(groupStart, groupCount, groupMaterial || 0);
      groupStart += groupCount;
      groupCount = 0;
    };
    for (const face of evaluated.faces) {
      if (groupMaterial !== null && groupMaterial !== face.materialIndex) flushGroup();
      groupMaterial = face.materialIndex;
      const triangles = triangulateEditableFace(face, vertexById);
      for (const triangle of triangles) {
        for (const localIndex of triangle) indices.push(vertexById.get(face.vertices[localIndex]).index);
        groupCount += 3;
      }
    }
    flushGroup();
    const IndexArray = evaluated.vertices.length > 65535 ? Uint32Array : Uint16Array;
    geometry.setIndex(new THREE.BufferAttribute(new IndexArray(indices), 1));

    const explicitNormal = buildExplicitVertexAttribute(evaluated, "normal", 3);
    if (explicitNormal) geometry.setAttribute("normal", new THREE.BufferAttribute(explicitNormal, 3));
    else geometry.computeVertexNormals();
    const explicitUv = buildExplicitVertexAttribute(evaluated, "uv", 2);
    const projection = normalizeProjection(record);
    if (explicitUv) geometry.setAttribute("uv", new THREE.BufferAttribute(explicitUv, 2));
    else if (projection) geometry.setAttribute("uv", new THREE.BufferAttribute(buildProjectedUvs(positions, projection), 2));
    const explicitColor = buildExplicitVertexAttribute(evaluated, "color", 3);
    if (explicitColor) geometry.setAttribute("color", new THREE.BufferAttribute(explicitColor, 3));
    const wantsTangents = record.computeTangents === true || (record.modifiers || []).some((modifier) =>
      /^(?:recalculate|recompute)?tangents?$/i.test(String(modifier?.type || modifier?.kind || "").replace(/[-_\s]/g, ""))
    );
    if (wantsTangents && geometry.index && geometry.getAttribute("normal") && geometry.getAttribute("uv")) {
      geometry.computeTangents();
    }

    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const stats = {
      vertexCount: evaluated.vertices.length,
      triangleCount: indices.length / 3,
      minIndex: 0,
      maxIndex: Math.max(0, evaluated.vertices.length - 1),
      byteLength: positionArray.byteLength + geometry.index.array.byteLength
    };
    const budgetCheck = validateBufferMeshStats(stats, options.meshBudget || record.meshBudget || {});
    if (!budgetCheck.ok) {
      const error = new Error(budgetCheck.message);
      error.code = budgetCheck.code;
      throw error;
    }
    geometry.userData.threeJsonEditableMesh = {
      revision: sourceTopology.revision,
      sourceVertexCount: sourceTopology.vertices.length,
      sourceFaceCount: sourceTopology.faces.length,
      appliedModifiers: result.applied,
      parts: [...new Set(sourceTopology.faces.map((face) => face.part).filter(Boolean))]
    };
    trackDisposableResource(geometry);
    return { geometry, sourceTopology, evaluatedTopology: evaluated, stats, validation: sourceValidation };
  } catch (error) {
    geometry.dispose();
    return { geometry: null, sourceTopology, evaluatedTopology: evaluated, code: error?.code || "E_EDITABLE_MESH_BUILD", error: String(error?.message || error) };
  }
}

export function createEditableMesh(record, parent, ctx = {}) {
  if (!record || !parent) return null;
  const built = buildEditableMeshGeometry(record, {
    meshBudget: ctx?.meshBudget ?? ctx?.options?.meshBudget
  });
  if (!built.geometry) {
    log.warn("[editableMesh]", built.code || "build failed", built.error || "", record?.name || "");
    return null;
  }
  const mesh = new THREE.Mesh(built.geometry, buildBufferMeshMaterials(record));
  trackDisposableResource(mesh);
  applyBufferMeshRecord(mesh, record);
  const descriptor = {
    ...record,
    topology: built.sourceTopology,
    modifiers: Array.isArray(record.modifiers) ? record.modifiers : []
  };
  setUserDataObjJson(mesh, descriptor);
  mesh.userData.threeJsonMeshStats = built.stats;
  parent.add(mesh);
  registerObject(mesh, mesh.userData.objJson, {}, parent);
  return mesh;
}

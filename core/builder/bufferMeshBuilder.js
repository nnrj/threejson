/**
 * Arbitrary triangle mesh BufferGeometry Mesh.
 */
import * as THREE from "three";
import { log } from "../util/logger.js";
import { trackDisposableResource } from "../handler/trackedResourceRegistry.js";
import { registerObject } from "../handler/objectRegistry.js";
import { setUserDataObjJson } from "../handler/objectDescriptorAttach.js";
import { applyVisibilityFromDescriptor } from "../util/util.js";
import { validateBufferMeshStats } from "./bufferMeshLimits.js";
import { applyParallelToOrRotation } from "./shapeTransformUtil.js";

function hasValue(value) {
  return value !== undefined && value !== null;
}

/**
 * @param {unknown} raw
 * @returns {Float32Array|null}
 */
function parsePositions(raw) {
  if (!raw) {
    return null;
  }
  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "number") {
    const arr = raw.map(Number).filter(Number.isFinite);
    return arr.length >= 9 && arr.length % 3 === 0 ? new Float32Array(arr) : null;
  }
  if (!Array.isArray(raw)) {
    return null;
  }
  /** @type {number[]} */
  const flat = [];
  for (let i = 0; i < raw.length; i++) {
    const pt = raw[i];
    if (Array.isArray(pt) && pt.length >= 3) {
      flat.push(Number(pt[0]), Number(pt[1]), Number(pt[2]));
    } else if (pt && typeof pt === "object") {
      flat.push(Number(pt.x), Number(pt.y), Number(pt.z));
    }
  }
  return flat.length >= 9 && flat.length % 3 === 0 ? new Float32Array(flat) : null;
}

/**
 * @param {unknown} raw
 * @returns {Uint32Array|null}
 */
function parseIndices(raw) {
  if (!Array.isArray(raw) || raw.length < 3) {
    return null;
  }
  const arr = raw.map((v) => Math.floor(Number(v))).filter(Number.isFinite);
  return arr.length >= 3 && arr.length % 3 === 0 ? new Uint32Array(arr) : null;
}

function resolveMaterialSide(materialInfo) {
  const side = typeof materialInfo?.side === "string" ? materialInfo.side.trim().toLowerCase() : "";
  if (side === "front") {
    return THREE.FrontSide;
  }
  if (side === "back") {
    return THREE.BackSide;
  }
  if (side === "double") {
    return THREE.DoubleSide;
  }
  return THREE.FrontSide;
}

function buildMeshMaterial(record) {
  const materialInfo = record?.material && typeof record.material === "object" ? record.material : {};
  const type = typeof materialInfo.type === "string" ? materialInfo.type.trim().toLowerCase() : "standard";
  const color = hasValue(materialInfo.color) ? materialInfo.color : "#cccccc";
  const opacity = Number(hasValue(materialInfo.opacity) ? materialInfo.opacity : 1);
  const transparent = Boolean(hasValue(materialInfo.transparent) ? materialInfo.transparent : opacity < 1);
  const side = resolveMaterialSide(materialInfo);
  if (type === "basic") {
    const mat = new THREE.MeshBasicMaterial({ color, transparent, opacity, side });
    trackDisposableResource(mat);
    return mat;
  }
  const mat = new THREE.MeshStandardMaterial({
    color,
    transparent,
    opacity,
    side,
    metalness: Number(hasValue(materialInfo.metalness) ? materialInfo.metalness : 0.1),
    roughness: Number(hasValue(materialInfo.roughness) ? materialInfo.roughness : 0.6)
  });
  trackDisposableResource(mat);
  return mat;
}

/**
 * @param {object} record
 * @returns {{ geometry: THREE.BufferGeometry|null, error?: string, code?: string }}
 */
export function buildBufferMeshGeometry(record) {
  const geoDef = record?.geometry && typeof record.geometry === "object" ? record.geometry : {};
  const positions = parsePositions(geoDef.positions);
  if (!positions) {
    return { geometry: null, code: "E_BUFFER_MESH_MISSING_POSITIONS", error: "missing or invalid positions" };
  }
  const vertexCount = positions.length / 3;
  const indices = parseIndices(geoDef.indices);
  let triangleCount = 0;
  let maxIndex = 0;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  if (indices) {
    for (let i = 0; i < indices.length; i++) {
      maxIndex = Math.max(maxIndex, indices[i]);
    }
    triangleCount = indices.length / 3;
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  } else {
    triangleCount = vertexCount / 3;
    maxIndex = vertexCount - 1;
  }

  const statsCheck = validateBufferMeshStats({ vertexCount, triangleCount, maxIndex });
  if (!statsCheck.ok) {
    geometry.dispose();
    return { geometry: null, code: statsCheck.code, error: statsCheck.message };
  }

  if (Array.isArray(geoDef.normals) && geoDef.normals.length > 0) {
    const normals = parsePositions(geoDef.normals);
    if (normals && normals.length === positions.length) {
      geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    }
  } else {
    geometry.computeVertexNormals();
  }

  if (Array.isArray(geoDef.uvs) && geoDef.uvs.length > 0) {
    const uvsRaw = geoDef.uvs;
    /** @type {number[]} */
    const uvs = [];
    if (typeof uvsRaw[0] === "number") {
      for (let i = 0; i < uvsRaw.length; i++) {
        uvs.push(Number(uvsRaw[i]));
      }
    } else {
      for (let i = 0; i < uvsRaw.length; i++) {
        const uv = uvsRaw[i];
        if (Array.isArray(uv) && uv.length >= 2) {
          uvs.push(Number(uv[0]), Number(uv[1]));
        }
      }
    }
    if (uvs.length === (positions.length / 3) * 2) {
      geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvs), 2));
    }
  }

  trackDisposableResource(geometry);
  return { geometry };
}

/**
 * @param {object} record
 * @param {import("three").Object3D} parent
 * @returns {import("three").Mesh|null}
 */
export function createBufferMesh(record, parent) {
  if (!record || !parent) {
    return null;
  }
  const built = buildBufferMeshGeometry(record);
  if (!built.geometry) {
    log.warn("[bufferMesh]", built.code || "build failed", built.error || "", record?.name || "");
    return null;
  }
  const material = buildMeshMaterial(record);
  const mesh = new THREE.Mesh(built.geometry, material);
  trackDisposableResource(mesh);
  applyParallelToOrRotation(mesh, record);
  applyVisibilityFromDescriptor(mesh, record);
  if (record.name) {
    mesh.name = record.name;
  }
  setUserDataObjJson(mesh, record);
  parent.add(mesh);
  registerObject(mesh, record);
  return mesh;
}

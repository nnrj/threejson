/**
 * Full ThreeJSON BufferGeometry mesh entry.
 *
 * Supports the compact positions/indices/normals/uvs shorthand and the complete attributes,
 * index, groups, drawRange and morphAttributes descriptor. There is intentionally no engine-owned
 * vertex/triangle/byte ceiling; a host may inject an optional meshBudget through the deploy
 * context or build options.
 */
import * as THREE from "three";
import { log } from "../util/logger.js";
import { trackDisposableResource } from "../handler/trackedResourceRegistry.js";
import { registerObject } from "../handler/objectRegistry.js";
import { setUserDataObjJson } from "../handler/objectDescriptorAttach.js";
import { applyVisibilityFromDescriptor } from "../util/util.js";
import { validateBufferMeshStats } from "./bufferMeshLimits.js";
import { applyParallelToOrRotation } from "./shapeTransformUtil.js";
import { createMaterialFromDescriptor } from "./material/materialFactory.js";

const TYPED_ARRAY_TYPES = Object.freeze({
  Float32Array,
  Float64Array,
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array
});

const ATTRIBUTE_SHORTHANDS = Object.freeze({
  position: ["positions"],
  normal: ["normals"],
  tangent: ["tangents"],
  color: ["colors"],
  uv: ["uvs"],
  uv1: ["uv1s"],
  uv2: ["uv2s"],
  skinIndex: ["skinIndices"],
  skinWeight: ["skinWeights"]
});

const DEFAULT_ITEM_SIZES = Object.freeze({
  position: 3,
  normal: 3,
  tangent: 4,
  color: 3,
  uv: 2,
  uv1: 2,
  uv2: 2,
  skinIndex: 4,
  skinWeight: 4
});

function meshError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isTypedArray(value) {
  return ArrayBuffer.isView(value) && !(value instanceof DataView);
}

function flattenNumericArray(value, out = []) {
  if (isTypedArray(value)) {
    for (let i = 0; i < value.length; i += 1) out.push(Number(value[i]));
    return out;
  }
  if (!Array.isArray(value)) return out;
  for (let i = 0; i < value.length; i += 1) {
    const one = value[i];
    if (Array.isArray(one) || isTypedArray(one)) {
      flattenNumericArray(one, out);
    } else if (one && typeof one === "object") {
      for (const key of ["x", "y", "z", "w"]) {
        if (one[key] !== undefined) out.push(Number(one[key]));
      }
    } else {
      out.push(Number(one));
    }
  }
  return out;
}

function decodeBase64Bytes(value) {
  const source = String(value || "");
  const encoded = source.includes(",") ? source.slice(source.indexOf(",") + 1) : source;
  if (!encoded) return new Uint8Array(0);
  if (typeof globalThis.atob === "function") {
    const binary = globalThis.atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  if (globalThis.Buffer?.from) {
    const buffer = globalThis.Buffer.from(encoded, "base64");
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }
  throw meshError("E_BUFFER_MESH_BASE64_UNAVAILABLE", "This runtime cannot decode base64 mesh buffers.");
}

function resolveTypedArrayConstructor(type, fallback = "Float32Array") {
  const normalized = String(type || fallback).replace(/^THREE\./, "");
  const Constructor = TYPED_ARRAY_TYPES[normalized];
  if (!Constructor) {
    throw meshError("E_BUFFER_MESH_ARRAY_TYPE", `Unsupported typed-array type \"${normalized}\".`);
  }
  return Constructor;
}

function resolveReferenceValue(reference, geometryDescriptor, options) {
  if (typeof options?.resolveBufferReference === "function") {
    const value = options.resolveBufferReference(reference, geometryDescriptor);
    if (value && typeof value.then === "function") {
      throw meshError(
        "E_BUFFER_MESH_ASYNC_BUFFER_REF",
        "The synchronous bufferMesh builder received an asynchronous buffer reference. Resolve it before loading or use an async host loader."
      );
    }
    if (value !== undefined && value !== null) return value;
  }
  const buffers = geometryDescriptor?.buffers;
  const key = typeof reference === "string" ? reference : reference?.id || reference?.buffer;
  const resolvedBuffers = geometryDescriptor?.__threeJsonResolvedBuffers;
  if (resolvedBuffers instanceof Map) {
    const direct = resolvedBuffers.get(reference) ?? resolvedBuffers.get(key);
    if (direct !== undefined && direct !== null) return direct;
    const declared = key && buffers && typeof buffers === "object" ? buffers[key] : undefined;
    const declaredUrl = typeof declared === "string" ? declared : declared?.url;
    const resolved = resolvedBuffers.get(declaredUrl);
    if (resolved !== undefined && resolved !== null) return resolved;
  }
  if (key && buffers && typeof buffers === "object" && buffers[key] !== undefined) return buffers[key];
  throw meshError("E_BUFFER_MESH_BUFFER_REF", `Unresolved mesh buffer reference \"${String(key || reference)}\".`);
}

function createTypedArray(rawDescriptor, fallbackType, geometryDescriptor, options = {}) {
  const descriptor = rawDescriptor && typeof rawDescriptor === "object" && !Array.isArray(rawDescriptor) && !isTypedArray(rawDescriptor)
    ? rawDescriptor
    : { array: rawDescriptor };
  const Constructor = resolveTypedArrayConstructor(descriptor.type, fallbackType);
  let source = descriptor.array ?? descriptor.data;
  let referencedDescriptor = null;
  if (source == null && (descriptor.buffer instanceof ArrayBuffer || isTypedArray(descriptor.buffer))) {
    source = descriptor.buffer;
  }
  if (source == null && descriptor.base64 != null) {
    const bytes = decodeBase64Bytes(descriptor.base64);
    const byteOffset = Number(descriptor.byteOffset) || 0;
    const byteLength = descriptor.byteLength == null ? bytes.byteLength - byteOffset : Number(descriptor.byteLength);
    if (byteOffset < 0 || byteLength < 0 || byteOffset + byteLength > bytes.byteLength || byteLength % Constructor.BYTES_PER_ELEMENT !== 0) {
      throw meshError("E_BUFFER_MESH_BINARY_RANGE", "Invalid base64 byteOffset/byteLength for typed array.");
    }
    source = new Constructor(bytes.buffer, bytes.byteOffset + byteOffset, byteLength / Constructor.BYTES_PER_ELEMENT);
  }
  if (source == null && (descriptor.ref != null || descriptor.bufferRef != null || typeof descriptor.buffer === "string")) {
    source = resolveReferenceValue(descriptor.ref ?? descriptor.bufferRef ?? descriptor.buffer, geometryDescriptor, options);
    if (source && typeof source === "object" && !Array.isArray(source) && !isTypedArray(source) && !(source instanceof ArrayBuffer)) {
      referencedDescriptor = source;
      source = referencedDescriptor.array ?? referencedDescriptor.data ?? referencedDescriptor.buffer;
      if (source == null && referencedDescriptor.base64 != null) {
        const bytes = decodeBase64Bytes(referencedDescriptor.base64);
        source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      }
    }
  }
  if (source instanceof ArrayBuffer) {
    const byteOffset = Number(descriptor.byteOffset ?? referencedDescriptor?.byteOffset) || 0;
    const declaredLength = descriptor.length ?? referencedDescriptor?.length;
    const length = declaredLength == null
      ? (source.byteLength - byteOffset) / Constructor.BYTES_PER_ELEMENT
      : Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0 || byteOffset < 0 || byteOffset + length * Constructor.BYTES_PER_ELEMENT > source.byteLength) {
      throw meshError("E_BUFFER_MESH_BINARY_RANGE", "Invalid ArrayBuffer byteOffset/length.");
    }
    return new Constructor(source, byteOffset, length);
  }
  if (isTypedArray(source)) {
    if (source.constructor === Constructor) return source;
    const values = Array.from(source, Number);
    if (!values.every(Number.isFinite)) throw meshError("E_BUFFER_MESH_NON_FINITE", "Mesh attribute contains a non-finite value.");
    return new Constructor(values);
  }
  const values = flattenNumericArray(source);
  if (values.length === 0) throw meshError("E_BUFFER_MESH_EMPTY_ATTRIBUTE", "Mesh attribute array is empty.");
  if (!values.every(Number.isFinite)) throw meshError("E_BUFFER_MESH_NON_FINITE", "Mesh attribute contains a non-finite value.");
  return new Constructor(values);
}

function resolveUsage(value) {
  const key = String(value || "").trim().toLowerCase().replace(/[-_\s]/g, "");
  return {
    static: THREE.StaticDrawUsage,
    staticdraw: THREE.StaticDrawUsage,
    dynamic: THREE.DynamicDrawUsage,
    dynamicdraw: THREE.DynamicDrawUsage,
    stream: THREE.StreamDrawUsage,
    streamdraw: THREE.StreamDrawUsage
  }[key] || THREE.StaticDrawUsage;
}

function buildAttribute(name, descriptor, geometryDescriptor, options, expectedCount = null) {
  const source = descriptor && typeof descriptor === "object" && !Array.isArray(descriptor) && !isTypedArray(descriptor)
    ? descriptor
    : { array: descriptor };
  const itemSize = Math.round(Number(source.itemSize ?? DEFAULT_ITEM_SIZES[name] ?? 1));
  if (!Number.isSafeInteger(itemSize) || itemSize <= 0) {
    throw meshError("E_BUFFER_MESH_ITEM_SIZE", `Attribute \"${name}\" has invalid itemSize.`);
  }
  const fallbackType = name === "skinIndex" ? "Uint16Array" : "Float32Array";
  const array = createTypedArray(source, fallbackType, geometryDescriptor, options);
  if (array.length % itemSize !== 0) {
    throw meshError("E_BUFFER_MESH_ATTRIBUTE_LENGTH", `Attribute \"${name}\" length is not divisible by itemSize ${itemSize}.`);
  }
  const attribute = new THREE.BufferAttribute(array, itemSize, source.normalized === true);
  attribute.name = typeof source.name === "string" ? source.name : "";
  attribute.setUsage(resolveUsage(source.usage));
  if (source.gpuType === "int" || source.gpuType === THREE.IntType) attribute.gpuType = THREE.IntType;
  if (Array.isArray(source.updateRanges)) {
    for (const range of source.updateRanges) {
      const start = Math.max(0, Math.round(Number(range?.start) || 0));
      const count = Math.max(0, Math.round(Number(range?.count) || 0));
      if (count > 0) attribute.addUpdateRange(start, count);
    }
  }
  if (expectedCount != null && attribute.count !== expectedCount) {
    throw meshError(
      "E_BUFFER_MESH_ATTRIBUTE_COUNT",
      `Attribute \"${name}\" count ${attribute.count} does not match position count ${expectedCount}.`
    );
  }
  return attribute;
}

function getShorthandAttribute(geometryDescriptor, name) {
  for (const key of ATTRIBUTE_SHORTHANDS[name] || []) {
    if (geometryDescriptor[key] !== undefined) return geometryDescriptor[key];
  }
  return undefined;
}

function buildIndexAttribute(raw, geometryDescriptor, options) {
  const descriptor = raw && typeof raw === "object" && !Array.isArray(raw) && !isTypedArray(raw)
    ? raw
    : { array: raw };
  let values = descriptor.array ?? descriptor.data;
  if (values == null && descriptor.base64 == null && descriptor.ref == null && descriptor.bufferRef == null && typeof descriptor.buffer !== "string") {
    throw meshError("E_BUFFER_MESH_EMPTY_INDEX", "Mesh index array is empty.");
  }
  if (Array.isArray(values) || isTypedArray(values)) {
    values = flattenNumericArray(values);
    if (!values.every((value) => Number.isSafeInteger(value) && value >= 0)) {
      throw meshError("E_BUFFER_MESH_INDEX_VALUE", "Mesh indices must be non-negative integers.");
    }
  }
  const explicitType = descriptor.type ? String(descriptor.type).replace(/^THREE\./, "") : "";
  let inferredMax = 0;
  if (Array.isArray(values)) {
    for (let i = 0; i < values.length; i += 1) inferredMax = Math.max(inferredMax, values[i]);
  }
  const type = explicitType || (inferredMax > 65535 ? "Uint32Array" : "Uint16Array");
  if (type !== "Uint16Array" && type !== "Uint32Array") {
    throw meshError("E_BUFFER_MESH_INDEX_TYPE", "Mesh index type must be Uint16Array or Uint32Array.");
  }
  if (Array.isArray(values)) {
    const maximum = type === "Uint16Array" ? 65535 : 4294967295;
    if (values.some((value) => value > maximum)) {
      throw meshError(
        "E_BUFFER_MESH_INDEX_TYPE_RANGE",
        `Mesh index exceeds the actual ${type} range; use ${type === "Uint16Array" ? "Uint32Array" : "a valid GPU index"}.`
      );
    }
  }
  const array = createTypedArray({ ...descriptor, array: values }, type, geometryDescriptor, options);
  if (array.length < 3 || array.length % 3 !== 0) {
    throw meshError("E_BUFFER_MESH_INDEX_LENGTH", "Mesh index length must be a positive multiple of 3.");
  }
  return new THREE.BufferAttribute(array, 1);
}

function calculateByteLength(geometry) {
  let bytes = geometry.index?.array?.byteLength || 0;
  for (const attribute of Object.values(geometry.attributes)) bytes += attribute?.array?.byteLength || 0;
  for (const list of Object.values(geometry.morphAttributes)) {
    for (const attribute of list || []) bytes += attribute?.array?.byteLength || 0;
  }
  return bytes;
}

function applyGeometryMetadata(geometry, geometryDescriptor) {
  const groups = Array.isArray(geometryDescriptor.groups) ? geometryDescriptor.groups : [];
  for (const group of groups) {
    const start = Math.max(0, Math.round(Number(group?.start) || 0));
    const count = Math.max(0, Math.round(Number(group?.count) || 0));
    const materialIndex = Math.max(0, Math.round(Number(group?.materialIndex) || 0));
    if (count > 0) geometry.addGroup(start, count, materialIndex);
  }
  const drawRange = geometryDescriptor.drawRange;
  if (drawRange && typeof drawRange === "object") {
    const start = Math.max(0, Math.round(Number(drawRange.start) || 0));
    const count = drawRange.count == null ? Infinity : Math.max(0, Math.round(Number(drawRange.count) || 0));
    geometry.setDrawRange(start, count);
  }
  geometry.morphTargetsRelative = geometryDescriptor.morphTargetsRelative === true;
  if (geometryDescriptor.userData && typeof geometryDescriptor.userData === "object") {
    geometry.userData = { ...geometryDescriptor.userData };
  }
}

/**
 * @param {object} record
 * @param {{ meshBudget?: object, resolveBufferReference?: Function, computeMissingNormals?: boolean }} [options]
 * @returns {{ geometry: THREE.BufferGeometry|null, stats?: object, error?: string, code?: string }}
 */
export function buildBufferMeshGeometry(record, options = {}) {
  const startedAt = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  const geometryDescriptor = record?.geometry && typeof record.geometry === "object" ? record.geometry : {};
  const attributesDescriptor = geometryDescriptor.attributes && typeof geometryDescriptor.attributes === "object"
    ? geometryDescriptor.attributes
    : {};
  const geometry = new THREE.BufferGeometry();
  try {
    const positionSource = attributesDescriptor.position ?? getShorthandAttribute(geometryDescriptor, "position");
    if (positionSource == null) {
      throw meshError("E_BUFFER_MESH_MISSING_POSITIONS", "bufferMesh requires geometry.attributes.position or geometry.positions.");
    }
    const position = buildAttribute("position", positionSource, geometryDescriptor, options);
    if (position.itemSize !== 3 || position.count < 3) {
      throw meshError("E_BUFFER_MESH_POSITION_SHAPE", "Position attribute must use itemSize 3 and contain at least three vertices.");
    }
    geometry.setAttribute("position", position);

    const attributeNames = new Set([
      ...Object.keys(attributesDescriptor),
      ...Object.keys(ATTRIBUTE_SHORTHANDS).filter((name) => getShorthandAttribute(geometryDescriptor, name) !== undefined)
    ]);
    attributeNames.delete("position");
    for (const name of attributeNames) {
      const source = attributesDescriptor[name] ?? getShorthandAttribute(geometryDescriptor, name);
      if (source == null) continue;
      geometry.setAttribute(name, buildAttribute(name, source, geometryDescriptor, options, position.count));
    }

    const rawIndex = geometryDescriptor.index ?? geometryDescriptor.indices;
    if (rawIndex != null) geometry.setIndex(buildIndexAttribute(rawIndex, geometryDescriptor, options));
    if (!geometry.index && position.count % 3 !== 0) {
      throw meshError("E_BUFFER_MESH_NON_INDEXED_TRIANGLES", "A non-indexed mesh position count must be divisible by 3.");
    }

    const morphDescriptor = geometryDescriptor.morphAttributes;
    if (morphDescriptor && typeof morphDescriptor === "object") {
      for (const [name, targets] of Object.entries(morphDescriptor)) {
        if (!Array.isArray(targets)) {
          throw meshError("E_BUFFER_MESH_MORPH_SHAPE", `Morph attribute \"${name}\" must be an array of targets.`);
        }
        geometry.morphAttributes[name] = targets.map((target) =>
          buildAttribute(name, target, geometryDescriptor, options, position.count)
        );
      }
    }
    applyGeometryMetadata(geometry, geometryDescriptor);

    if (!geometry.getAttribute("normal") && options.computeMissingNormals !== false) geometry.computeVertexNormals();
    if (geometryDescriptor.computeTangents === true && geometry.index && geometry.getAttribute("normal") && geometry.getAttribute("uv")) {
      geometry.computeTangents();
    }
    if (geometryDescriptor.computeBoundingBox !== false) geometry.computeBoundingBox();
    if (geometryDescriptor.computeBoundingSphere !== false) geometry.computeBoundingSphere();

    const indexArray = geometry.index?.array || null;
    let minIndex = 0;
    let maxIndex = position.count - 1;
    if (indexArray) {
      minIndex = Infinity;
      maxIndex = -Infinity;
      for (let i = 0; i < indexArray.length; i += 1) {
        const value = Number(indexArray[i]);
        if (value < minIndex) minIndex = value;
        if (value > maxIndex) maxIndex = value;
      }
    }
    const finishedAt = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
    const stats = {
      vertexCount: position.count,
      triangleCount: (indexArray ? indexArray.length : position.count) / 3,
      minIndex,
      maxIndex,
      byteLength: calculateByteLength(geometry),
      buildTimeMs: Math.max(0, finishedAt - startedAt)
    };
    const statsCheck = validateBufferMeshStats(stats, options.meshBudget || record?.meshBudget || {});
    if (!statsCheck.ok) throw meshError(statsCheck.code, statsCheck.message);
    trackDisposableResource(geometry);
    return { geometry, stats };
  } catch (error) {
    geometry.dispose();
    return {
      geometry: null,
      code: error?.code || "E_BUFFER_MESH_BUILD",
      error: String(error?.message || error)
    };
  }
}

/** Build the one or many materials referenced by a buffer/editable mesh descriptor. */
export function buildBufferMeshMaterials(record = {}) {
  const descriptors = Array.isArray(record.materials) && record.materials.length > 0
    ? record.materials
    : [record.material && typeof record.material === "object" ? record.material : {}];
  const materials = descriptors.map((descriptor) => {
    const material = createMaterialFromDescriptor(descriptor, {
      fallbackType: "standard",
      defaultColor: "#cccccc"
    });
    trackDisposableResource(material);
    return material;
  });
  return materials.length === 1 ? materials[0] : materials;
}

/** Apply shared mesh-level fields without rebuilding geometry. */
export function applyBufferMeshRecord(mesh, record = {}) {
  applyParallelToOrRotation(mesh, record);
  applyVisibilityFromDescriptor(mesh, record);
  mesh.castShadow = record.castShadow === true;
  mesh.receiveShadow = record.receiveShadow !== false;
  if (record.name) mesh.name = record.name;
  if (Array.isArray(mesh.morphTargetInfluences)) {
    if (Array.isArray(record.morphInfluences)) {
      for (let i = 0; i < Math.min(record.morphInfluences.length, mesh.morphTargetInfluences.length); i += 1) {
        const value = Number(record.morphInfluences[i]);
        if (Number.isFinite(value)) mesh.morphTargetInfluences[i] = value;
      }
    } else if (record.morphInfluences && typeof record.morphInfluences === "object") {
      for (const [target, rawValue] of Object.entries(record.morphInfluences)) {
        const numericIndex = /^\d+$/.test(target) ? Number(target) : mesh.morphTargetDictionary?.[target];
        const value = Number(rawValue);
        if (Number.isSafeInteger(numericIndex) && numericIndex >= 0 && numericIndex < mesh.morphTargetInfluences.length && Number.isFinite(value)) {
          mesh.morphTargetInfluences[numericIndex] = value;
        }
      }
    }
  }
}

/**
 * @param {object} record
 * @param {import("three").Object3D} parent
 * @param {object} [ctx]
 * @returns {import("three").Mesh|null}
 */
export function createBufferMesh(record, parent, ctx = {}) {
  if (!record || !parent) return null;
  const built = buildBufferMeshGeometry(record, {
    meshBudget: ctx?.meshBudget ?? ctx?.options?.meshBudget,
    resolveBufferReference: ctx?.resolveBufferReference ?? ctx?.options?.resolveBufferReference
  });
  if (!built.geometry) {
    log.warn("[bufferMesh]", built.code || "build failed", built.error || "", record?.name || "");
    return null;
  }
  const mesh = new THREE.Mesh(built.geometry, buildBufferMeshMaterials(record));
  trackDisposableResource(mesh);
  applyBufferMeshRecord(mesh, record);
  setUserDataObjJson(mesh, record);
  mesh.userData.threeJsonMeshStats = built.stats;
  parent.add(mesh);
  registerObject(mesh, record, {}, parent);
  return mesh;
}

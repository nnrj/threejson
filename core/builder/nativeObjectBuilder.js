/**
 * Generic native object: ThreeJSON record → ObjectLoader subgraph / direct build → scene deploy.
 */
import { Color, ObjectLoader, TextureLoader } from "three";
import { log } from "../util/logger.js";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import {
  cacheSharedGeometryInstance,
  cacheSharedMaterialInstance,
  getSharedGeometryInstance,
  resolveLibTokenToShaderSource
} from "../cache/assetRegistry.js";
import { trackDisposableResource } from "../handler/trackedResourceRegistry.js";
import { applyObjectTransform } from "./heatmap/heatmapTexture.js";
import { registerObject } from "../handler/objectRegistry.js";
import { isNativeShapeHeuristicEnabled } from "../handler/nativeParseMode.js";
import { resolveAssetRefsForRecord } from "../util/resolveAssetRefs.js";
import { resolveTextureSource } from "../util/resolveTextureSource.js";
import { LIB_PREFIX } from "../util/resolveTextureSource.js";

/** @type {Record<string, string>} */
const GEOMETRY_HOST_TYPE = {
  BoxGeometry: "Mesh",
  SphereGeometry: "Mesh",
  CylinderGeometry: "Mesh",
  ConeGeometry: "Mesh",
  RingGeometry: "Mesh",
  TorusGeometry: "Mesh",
  TorusKnotGeometry: "Mesh",
  CapsuleGeometry: "Mesh",
  PlaneGeometry: "Mesh",
  CircleGeometry: "Mesh",
  LatheGeometry: "Mesh",
  ExtrudeGeometry: "Mesh",
  ShapeGeometry: "Mesh",
  TubeGeometry: "Mesh",
  BufferGeometry: "Mesh",
  DodecahedronGeometry: "Mesh",
  TetrahedronGeometry: "Mesh",
  OctahedronGeometry: "Mesh",
  IcosahedronGeometry: "Mesh",
  RoundedBoxGeometry: "Mesh",
  LineGeometry: "Line2",
  InstancedBufferGeometry: "InstancedMesh"
};

let _idCounter = 0;

function nextUuid(prefix) {
  _idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${_idCounter}`;
}

function hasFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function hasBoxLikeDimensions(geometry) {
  if (!geometry || typeof geometry !== "object") {
    return false;
  }
  return (
    hasFiniteNumber(geometry.width) ||
    hasFiniteNumber(geometry.height) ||
    hasFiniteNumber(geometry.depth) ||
    hasFiniteNumber(geometry.length)
  );
}

/**
 * @param {object} record
 * @param {object} ctx
 * @returns {object}
 */
function resolveGeometryBlock(record, ctx) {
  const source =
    record?.geometry && typeof record.geometry === "object" && !Array.isArray(record.geometry)
      ? { ...record.geometry }
      : {};
  if (!source.type && isNativeShapeHeuristicEnabled(record, ctx) && hasBoxLikeDimensions(source)) {
    source.type = "BoxGeometry";
    if (!hasFiniteNumber(source.width) && hasFiniteNumber(source.length)) {
      source.width = source.length;
    }
    if (!hasFiniteNumber(source.depth) && hasFiniteNumber(source.length)) {
      source.depth = source.length;
    }
    if (!hasFiniteNumber(source.height)) {
      source.height = 1;
    }
    if (!hasFiniteNumber(source.width)) {
      source.width = 1;
    }
    if (!hasFiniteNumber(source.depth)) {
      source.depth = 1;
    }
  }
  return source;
}

/**
 * @param {object} record
 * @param {object} ctx
 * @returns {string|null}
 */
function resolveThreeType(record, ctx) {
  if (typeof record?.threeType === "string" && record.threeType.trim()) {
    return record.threeType.trim();
  }
  const geometry = resolveGeometryBlock(record, ctx);
  const geoType = typeof geometry.type === "string" ? geometry.type.trim() : "";
  if (geoType && GEOMETRY_HOST_TYPE[geoType]) {
    return GEOMETRY_HOST_TYPE[geoType];
  }
  if (geoType) {
    return "Mesh";
  }
  if (Array.isArray(record?.children) && record.children.length > 0) {
    return "Group";
  }
  return null;
}

/**
 * @param {unknown} value
 * @returns {number|undefined}
 */
function colorToLoaderNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    try {
      return new Color(value.trim()).getHex();
    } catch (_e) {
      return undefined;
    }
  }
  return undefined;
}

/**
 * @param {object} materialJson
 * @param {object[]} materialsOut
 * @returns {string|null}
 */
function buildMaterialEntry(materialJson, materialsOut) {
  if (!materialJson || typeof materialJson !== "object" || Array.isArray(materialJson)) {
    return null;
  }
  const uuid = nextUuid("mat");
  /** @type {Record<string, unknown>} */
  const entry = { uuid };
  const normalizedMaterial = resolveShaderMaterialSource(materialJson);
  for (const key of Object.keys(normalizedMaterial)) {
    if (key === "textureUrl" || key === "textureKind" || key === "textureRepeat") {
      continue;
    }
    if (key === "shaderSource") {
      continue;
    }
    if (key === "color") {
      const c = colorToLoaderNumber(normalizedMaterial.color);
      if (c !== undefined) {
        entry.color = c;
      }
      continue;
    }
    if (key === "map" && typeof normalizedMaterial.map === "string") {
      continue;
    }
    entry[key] = normalizedMaterial[key];
  }
  if (typeof entry.type !== "string" || !entry.type) {
    entry.type = "MeshStandardMaterial";
  }
  materialsOut.push(entry);
  return uuid;
}

/**
 * @param {string|undefined|null} value
 * @returns {string|null}
 */
function parseLibRefToken(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed.toLowerCase().startsWith(LIB_PREFIX)) {
    return null;
  }
  const token = trimmed.slice(LIB_PREFIX.length).trim();
  return token || null;
}

/**
 * @param {string|undefined|null} value
 * @returns {string|null}
 */
function resolveShaderSourceValue(value) {
  if (typeof value !== "string") {
    return null;
  }
  const token = parseLibRefToken(value);
  if (!token) {
    return value;
  }
  const hit = resolveLibTokenToShaderSource(token);
  if (typeof hit?.source === "string" && hit.source.trim()) {
    return hit.source;
  }
  if (typeof hit?.url === "string" && hit.url.trim()) {
    log.warn(
      `[nativeObjectBuilder] shaderSource lib://${token} is a URL reference; native sync path does not support remote fetch yet — use inline source`
    );
    return null;
  }
  return null;
}

/**
 * @param {object} materialJson
 * @returns {object}
 */
function resolveShaderMaterialSource(materialJson) {
  if (!materialJson || typeof materialJson !== "object" || Array.isArray(materialJson)) {
    return materialJson;
  }
  const type = typeof materialJson.type === "string" ? materialJson.type.trim() : "";
  if (type !== "ShaderMaterial") {
    return materialJson;
  }
  const next = { ...materialJson };
  const shaderSource =
    materialJson.shaderSource && typeof materialJson.shaderSource === "object" && !Array.isArray(materialJson.shaderSource)
      ? materialJson.shaderSource
      : null;
  const vertexValue =
    resolveShaderSourceValue(next.vertexShader) ??
    resolveShaderSourceValue(shaderSource?.vertex ?? shaderSource?.vert ?? shaderSource?.vs);
  const fragmentValue =
    resolveShaderSourceValue(next.fragmentShader) ??
    resolveShaderSourceValue(shaderSource?.fragment ?? shaderSource?.frag ?? shaderSource?.fs);

  if (typeof vertexValue === "string" && vertexValue.trim()) {
    next.vertexShader = vertexValue;
  }
  if (typeof fragmentValue === "string" && fragmentValue.trim()) {
    next.fragmentShader = fragmentValue;
  }
  if (!next.vertexShader || !next.fragmentShader) {
    log.warn(
      "[nativeObjectBuilder] ShaderMaterial missing vertexShader/fragmentShader, or lib://shaderSource not resolved:",
      materialJson
    );
  }
  delete next.shaderSource;
  return next;
}

/**
 * @param {object} geometryJson
 * @param {object[]} geometriesOut
 * @returns {string|null}
 */
function buildGeometryEntry(geometryJson, geometriesOut) {
  if (!geometryJson || typeof geometryJson !== "object" || Array.isArray(geometryJson)) {
    return null;
  }
  const type = typeof geometryJson.type === "string" ? geometryJson.type.trim() : "";
  if (!type) {
    return null;
  }
  const uuid = nextUuid("geo");
  /** @type {Record<string, unknown>} */
  const entry = { uuid, type };
  for (const key of Object.keys(geometryJson)) {
    if (key === "type") {
      continue;
    }
    entry[key] = geometryJson[key];
  }
  geometriesOut.push(entry);
  return uuid;
}

/**
 * @param {object} record
 * @param {object[]} geometries
 * @param {object[]} materials
 * @param {object} ctx
 * @returns {object|null}
 */
function buildObjectLoaderNode(record, geometries, materials, ctx) {
  const threeType = resolveThreeType(record, ctx);
  if (!threeType) {
    return null;
  }
  /** @type {Record<string, unknown>} */
  const node = {
    uuid: nextUuid("obj"),
    type: threeType
  };
  if (typeof record.name === "string" && record.name) {
    node.name = record.name;
  }
  if (record.visible === false) {
    node.visible = false;
  }
  if (record.position && typeof record.position === "object") {
    node.position = record.position;
  }
  if (record.rotation && typeof record.rotation === "object") {
    node.rotation = record.rotation;
  }
  if (record.scale && typeof record.scale === "object") {
    node.scale = record.scale;
  }
  const geometry = resolveGeometryBlock(record, ctx);
  const needsGeometry =
    threeType === "Mesh" ||
    threeType === "SkinnedMesh" ||
    threeType === "InstancedMesh" ||
    threeType === "Line" ||
    threeType === "LineSegments" ||
    threeType === "Line2" ||
    threeType === "Points";
  if (needsGeometry && geometry.type) {
    const geoUuid = buildGeometryEntry(geometry, geometries);
    if (geoUuid) {
      node.geometry = geoUuid;
    }
  }
  if (record.material && typeof record.material === "object") {
    const matUuid = buildMaterialEntry(record.material, materials);
    if (matUuid) {
      node.material = matUuid;
    }
  }
  if (threeType === "InstancedMesh" && hasFiniteNumber(Number(record.count))) {
    node.count = Number(record.count);
  }
  const childRecords = Array.isArray(record.children) ? record.children : [];
  if (childRecords.length > 0) {
    /** @type {object[]} */
    const childNodes = [];
    for (let i = 0; i < childRecords.length; i++) {
      const childNode = buildObjectLoaderNode(childRecords[i], geometries, materials, ctx);
      if (childNode) {
        childNodes.push(childNode);
      }
    }
    if (childNodes.length > 0) {
      node.children = childNodes;
    }
  }
  return node;
}

/**
 * @param {object} record
 * @param {object} ctx
 * @returns {object|null}
 */
export function buildObjectLoaderGraphFromRecord(record, ctx = {}) {
  if (!record || typeof record !== "object") {
    return null;
  }
  /** @type {object[]} */
  const geometries = [];
  /** @type {object[]} */
  const materials = [];
  const objectNode = buildObjectLoaderNode(record, geometries, materials, ctx);
  if (!objectNode) {
    return null;
  }
  return {
    metadata: {
      version: 4.6,
      type: "Object",
      generator: "ThreeJSON.nativeObjectBuilder"
    },
    geometries,
    materials,
    object: objectNode
  };
}

/**
 * @param {import("three").Object3D} mesh
 * @param {object|null|undefined} materialJson
 */
function applyTextureUrlToMeshMaterial(mesh, materialJson) {
  if (!mesh?.isMesh || !materialJson || typeof materialJson !== "object") {
    return;
  }
  const url = resolveTextureSource(materialJson);
  if (!url) {
    return;
  }
  const loader = new TextureLoader();
  const texture = loader.load(
    url,
    undefined,
    undefined,
    (err) => log.error("[nativeObjectBuilder] texture load failed:", url, err)
  );
  const assign = (mat) => {
    if (mat) {
      mat.map = texture;
      mat.needsUpdate = true;
    }
  };
  if (Array.isArray(mesh.material)) {
    for (let i = 0; i < mesh.material.length; i++) {
      assign(mesh.material[i]);
    }
  } else {
    assign(mesh.material);
  }
}

/**
 * @param {import("three").Object3D} object3D
 * @param {object} record
 */
function applyTextureUrlsFromRecordTree(object3D, record) {
  if (!object3D || !record) {
    return;
  }
  if (object3D.isMesh) {
    applyTextureUrlToMeshMaterial(object3D, record.material);
  }
  const childRecords = Array.isArray(record.children) ? record.children : [];
  for (let i = 0; i < childRecords.length && i < object3D.children.length; i++) {
    applyTextureUrlsFromRecordTree(object3D.children[i], childRecords[i]);
  }
}

/**
 * @param {import("three").Object3D|import("three").Scene} targetRoot
 * @param {object} record
 * @param {import("three").Object3D} object
 * @returns {boolean}
 */
function finalizeNativeObject(targetRoot, record, object) {
  if (!object) {
    return false;
  }
  trackDisposableResource(object);
  applyObjectTransform(object, record);
  if (record.visible === false) {
    object.visible = false;
  }
  applyTextureUrlsFromRecordTree(object, record);
  targetRoot.add(object);
  registerObject(object, record);
  return true;
}

/**
 * @param {import("three").Object3D|import("three").Scene} targetRoot
 * @param {object} record
 * @param {import("three").BufferGeometry} geometry
 * @returns {boolean}
 */
function deployNativeMeshWithGeometry(targetRoot, record, geometry) {
  const graph = buildObjectLoaderGraphFromRecord(
    { ...record, geometry: undefined },
    {}
  );
  if (!graph) {
    return false;
  }
  delete graph.object.geometry;
  let object;
  try {
    const loader = new ObjectLoader();
    object = loader.parse(graph);
  } catch (error) {
    log.warn("[nativeObjectBuilder] material parse failed:", record?.name || "", error);
    return false;
  }
  if (!object?.isMesh) {
    return false;
  }
  object.geometry = geometry;
  return finalizeNativeObject(targetRoot, record, object);
}

/**
 * @param {import("three").Object3D|import("three").Scene} targetRoot
 * @param {object} record
 * @param {object} ctx
 * @returns {boolean}
 */
function deployNativeLine2Record(targetRoot, record, ctx = {}) {
  const geometryJson = resolveGeometryBlock(record, ctx);
  const positions = Array.isArray(geometryJson.positions) ? geometryJson.positions : null;
  if (!positions || positions.length < 6) {
    log.warn("[nativeObjectBuilder] Line2 requires geometry.positions (at least 2 points):", record?.name || "");
    return false;
  }

  const materialJson = record.material && typeof record.material === "object" ? record.material : {};
  const color = colorToLoaderNumber(materialJson.color) ?? 0xffffff;
  const material = new LineMaterial({
    color,
    linewidth: hasFiniteNumber(materialJson.linewidth) ? materialJson.linewidth : 1,
    transparent: materialJson.transparent === true,
    opacity: hasFiniteNumber(materialJson.opacity) ? materialJson.opacity : 1,
    worldUnits: materialJson.worldUnits === true
  });
  trackDisposableResource(material);
  const resolution = ctx?.viewportSize ?? getViewportSizeFallback();
  material.resolution.set(resolution.width, resolution.height);

  const geometry = new LineGeometry();
  trackDisposableResource(geometry);
  geometry.setPositions(positions);

  const line = new Line2(geometry, material);
  trackDisposableResource(line);
  line.computeLineDistances();
  if (typeof record.name === "string" && record.name) {
    line.name = record.name;
  }
  return finalizeNativeObject(targetRoot, record, line);
}

function getViewportSizeFallback() {
  if (typeof window !== "undefined") {
    return {
      width: window.innerWidth || 1,
      height: window.innerHeight || 1
    };
  }
  return { width: 1, height: 1 };
}

/**
 * @param {object} record
 * @param {object} ctx
 * @returns {object}
 */
function applyGeometryFallback(record, ctx) {
  const fallbackType =
    typeof record?.fallback === "string" ? record.fallback.trim() : "";
  if (!fallbackType) {
    return record;
  }
  const geometry = resolveGeometryBlock(record, ctx);
  const nextGeometry = { ...geometry, type: fallbackType };
  return { ...record, geometry: nextGeometry };
}

/**
 * @param {import("three").Object3D|import("three").Scene} targetRoot
 * @param {object} record
 * @param {object} [ctx]
 * @returns {boolean}
 */
export function deployNativeObjectRecord(targetRoot, record, ctx = {}) {
  if (!targetRoot || !record || typeof record !== "object") {
    return false;
  }

  const resolved = resolveAssetRefsForRecord(record) ?? record;

  if (resolveThreeType(resolved, ctx) === "Line2") {
    return deployNativeLine2Record(targetRoot, resolved, ctx);
  }

  if (
    resolved.__sharePolicyGeometry === "shared" &&
    typeof resolved.__resolvedGeometryRef === "string"
  ) {
    const cached = getSharedGeometryInstance(resolved.__resolvedGeometryRef);
    if (cached) {
      return deployNativeMeshWithGeometry(targetRoot, resolved, cached);
    }
  }

  const graph = buildObjectLoaderGraphFromRecord(resolved, ctx);
  if (!graph) {
    log.warn(
      "[nativeObjectBuilder] cannot parse native record (missing threeType / geometry.type / children):",
      resolved?.name || "",
      resolved?.objType || ""
    );
    return false;
  }

  let object;
  try {
    const loader = new ObjectLoader();
    if (typeof resolved.path === "string" && resolved.path) {
      loader.setPath(resolved.path);
    }
    const rp = typeof resolved.resourcePath === "string" ? resolved.resourcePath.trim() : "";
    if (rp) {
      loader.setResourcePath(rp.endsWith("/") ? rp : `${rp}/`);
    }
    if (typeof resolved.crossOrigin === "string") {
      loader.setCrossOrigin(resolved.crossOrigin);
    }
    object = loader.parse(graph);
  } catch (error) {
    if (typeof resolved.fallback === "string" && resolved.fallback.trim()) {
      log.warn(
        "[nativeObjectBuilder] parse failed, trying fallback geometry:",
        resolved?.name || "",
        resolved.geometry?.type || "",
        "→",
        resolved.fallback
      );
      return deployNativeObjectRecord(targetRoot, applyGeometryFallback(resolved, ctx), ctx);
    }
    log.warn("[nativeObjectBuilder] ObjectLoader.parse failed:", resolved?.name || "", error);
    return false;
  }

  if (!object) {
    return false;
  }

  if (
    resolved.__sharePolicyGeometry === "shared" &&
    typeof resolved.__resolvedGeometryRef === "string" &&
    object.isMesh &&
    object.geometry
  ) {
    cacheSharedGeometryInstance(resolved.__resolvedGeometryRef, object.geometry);
  }
  if (
    resolved.__sharePolicyMaterial === "shared" &&
    typeof resolved.__resolvedMaterialRef === "string" &&
    object.isMesh &&
    object.material
  ) {
    cacheSharedMaterialInstance(resolved.__resolvedMaterialRef, object.material);
  }

  return finalizeNativeObject(targetRoot, resolved, object);
}

export { GEOMETRY_HOST_TYPE, resolveThreeType, resolveGeometryBlock };

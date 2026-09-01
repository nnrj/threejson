import * as THREE from "three";
import { resolveParentThreeJsonId } from "../runtime/sceneObjectCommands.js";
import { normalizeScenePayload } from "../handler/sceneFriendlyNormalizer.js";
import { evaluateNumericExpression } from "../util/numericExpression.js";
import { resolvePosition, resolveRotation, resolveScale } from "../util/vectorValue.js";

/**
 * Compact spatial context for AI scene update (position, geometry summary, scale profile).
 */

const MAX_SPATIAL_OBJECTS = 40;
const MAX_REFERENCE_OBJECTS = 5;
const MIN_PROMPT_TOKEN_LENGTH = 2;

const RELATIVE_POSITION_WORDS = [
  "旁边",
  "邻近",
  "附近",
  "左侧",
  "右侧",
  "左边",
  "右边",
  "对面",
  "next to",
  "near",
  "beside",
  "left of",
  "right of",
  "adjacent"
];

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObjectRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function vectorRecord(value) {
  return { x: value.x, y: value.y, z: value.z };
}

function pointFrom(value) {
  if (Array.isArray(value) && value.length >= 3) {
    const point = value.slice(0, 3).map((one) => Number(one));
    return point.every(Number.isFinite) ? point : null;
  }
  if (isObjectRecord(value)) {
    const point = [Number(value.x), Number(value.y), Number(value.z)];
    return point.every(Number.isFinite) ? point : null;
  }
  return null;
}

function emptyBounds() {
  return {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
    pointCount: 0
  };
}

function includePoint(bounds, point) {
  if (!bounds || !Array.isArray(point) || point.length < 3 || !point.every(Number.isFinite)) return;
  for (let axis = 0; axis < 3; axis += 1) {
    bounds.min[axis] = Math.min(bounds.min[axis], point[axis]);
    bounds.max[axis] = Math.max(bounds.max[axis], point[axis]);
  }
  bounds.pointCount += 1;
}

function finalizeBounds(bounds, source = "descriptor") {
  if (!bounds || bounds.pointCount < 1 || !bounds.min.every(Number.isFinite) || !bounds.max.every(Number.isFinite)) return null;
  return { min: bounds.min, max: bounds.max, source, pointCount: bounds.pointCount };
}

function boundsFromPointCollection(value, source = "descriptor-control") {
  const bounds = emptyBounds();
  const visit = (entry) => {
    const point = pointFrom(entry);
    if (point) {
      includePoint(bounds, point);
      return;
    }
    if (Array.isArray(entry)) {
      for (const child of entry) visit(child);
    }
  };
  visit(value);
  return finalizeBounds(bounds, source);
}

function readBoundsDescriptor(value, source = "descriptor-explicit") {
  if (!isObjectRecord(value)) return null;
  const min = pointFrom(value.min);
  const max = pointFrom(value.max);
  if (!min || !max) return null;
  return {
    min: min.map((one, axis) => Math.min(one, max[axis])),
    max: max.map((one, axis) => Math.max(one, min[axis])),
    source
  };
}

function arrayLikeValues(value) {
  if (ArrayBuffer.isView(value)) return value;
  if (Array.isArray(value)) return value;
  if (isObjectRecord(value)) {
    if (ArrayBuffer.isView(value.array) || Array.isArray(value.array)) return value.array;
    if (ArrayBuffer.isView(value.data) || Array.isArray(value.data)) return value.data;
  }
  return null;
}

function boundsFromFlatPositions(value, itemSize = 3, source = "descriptor-vertices") {
  const values = arrayLikeValues(value);
  const stride = Math.max(3, Math.round(Number(itemSize) || 3));
  if (!values || values.length < 3) return null;
  const bounds = emptyBounds();
  for (let i = 0; i + 2 < values.length; i += stride) {
    const point = [Number(values[i]), Number(values[i + 1]), Number(values[i + 2])];
    if (point.every(Number.isFinite)) includePoint(bounds, point);
  }
  return finalizeBounds(bounds, source);
}

function expandBounds(bounds, amount) {
  if (!bounds || !Number.isFinite(amount) || amount <= 0) return bounds;
  return {
    ...bounds,
    min: bounds.min.map((value) => value - amount),
    max: bounds.max.map((value) => value + amount)
  };
}

function boundsFromPrimitive(descriptor, geometry) {
  const objType = String(descriptor.objType || "").toLowerCase();
  const width = Number(geometry.width);
  const height = Number(geometry.height);
  const depth = Number(geometry.depth);
  if (objType === "box" || objType === "floor" || objType === "wall" || objType === "glass" || Number.isFinite(width) || Number.isFinite(depth)) {
    const half = [Math.abs(Number.isFinite(width) ? width : 0) / 2, Math.abs(Number.isFinite(height) ? height : 0) / 2, Math.abs(Number.isFinite(depth) ? depth : 0) / 2];
    return { min: half.map((value) => -value), max: half, source: "descriptor-primitive" };
  }
  if (objType === "cylinder" || objType === "cone" || geometry.radiusTop != null || geometry.radiusBottom != null) {
    const radius = Math.max(Math.abs(Number(geometry.radiusTop) || 0), Math.abs(Number(geometry.radiusBottom) || 0), Math.abs(Number(geometry.radius) || 0));
    const halfHeight = Math.abs(Number(geometry.height) || 0) / 2;
    return { min: [-radius, -halfHeight, -radius], max: [radius, halfHeight, radius], source: "descriptor-primitive" };
  }
  if (objType === "sphere" || (geometry.radius != null && geometry.width == null && geometry.radiusTop == null)) {
    const radius = Math.abs(Number(geometry.radius) || 0);
    return { min: [-radius, -radius, -radius], max: [radius, radius, radius], source: "descriptor-primitive" };
  }
  if (objType === "capsule") {
    const radius = Math.abs(Number(geometry.radius) || 0);
    const halfHeight = Math.abs(Number(geometry.length ?? geometry.height) || 0) / 2 + radius;
    return { min: [-radius, -halfHeight, -radius], max: [radius, halfHeight, radius], source: "descriptor-primitive" };
  }
  if (objType === "torus") {
    const outer = Math.abs(Number(geometry.radius) || 0) + Math.abs(Number(geometry.tube) || 0);
    const tube = Math.abs(Number(geometry.tube) || 0);
    return { min: [-outer, -tube, -outer], max: [outer, tube, outer], source: "descriptor-primitive" };
  }
  if (objType === "ring") {
    const radius = Math.abs(Number(geometry.outerRadius ?? geometry.radius) || 0);
    return { min: [-radius, -radius, 0], max: [radius, radius, 0], source: "descriptor-primitive" };
  }
  if (objType === "plane") {
    const halfWidth = Math.abs(Number(geometry.width) || 0) / 2;
    const halfHeight = Math.abs(Number(geometry.height) || 0) / 2;
    return { min: [-halfWidth, -halfHeight, 0], max: [halfWidth, halfHeight, 0], source: "descriptor-primitive" };
  }
  return null;
}

function boundsFromParametric(geometry) {
  const expressions = geometry.expressions || geometry.expression;
  if (!isObjectRecord(expressions) || ![expressions.x, expressions.y, expressions.z].every((value) => typeof value === "string")) return null;
  const uRange = Array.isArray(geometry.uRange) ? geometry.uRange : [0, 1];
  const vRange = Array.isArray(geometry.vRange) ? geometry.vRange : [0, 1];
  const bounds = emptyBounds();
  try {
    for (let vi = 0; vi <= 8; vi += 1) {
      for (let ui = 0; ui <= 8; ui += 1) {
        const s = ui / 8;
        const t = vi / 8;
        const u = toNumber(uRange[0]) + (toNumber(uRange[1]) - toNumber(uRange[0])) * s;
        const v = toNumber(vRange[0]) + (toNumber(vRange[1]) - toNumber(vRange[0])) * t;
        includePoint(bounds, [
          evaluateNumericExpression(expressions.x, { u, v, s, t }),
          evaluateNumericExpression(expressions.y, { u, v, s, t }),
          evaluateNumericExpression(expressions.z, { u, v, s, t })
        ]);
      }
    }
  } catch (_error) {
    return null;
  }
  return finalizeBounds(bounds, "descriptor-sampled");
}

function localBoundsFromDescriptor(descriptor) {
  const geometry = isObjectRecord(descriptor.geometry) ? descriptor.geometry : {};
  const explicit = readBoundsDescriptor(geometry.bounds || descriptor.bounds);
  if (explicit) return explicit;
  const objType = String(descriptor.objType || "").toLowerCase();
  if (objType === "editablemesh") {
    return boundsFromPointCollection((descriptor.topology?.vertices || []).map((vertex) => vertex?.position), "descriptor-control-cage");
  }
  if (objType === "buffermesh" || objType === "irregulargeometry" || objType === "irregularplane") {
    const position = geometry.attributes?.position;
    return boundsFromFlatPositions(position?.array ?? position?.data ?? position ?? geometry.positions ?? descriptor.positions, position?.itemSize || 3);
  }
  if (objType === "lathemesh") {
    const profile = Array.isArray(geometry.profile || geometry.points) ? geometry.profile || geometry.points : [];
    const bounds = emptyBounds();
    for (const entry of profile) {
      const radius = Math.abs(Number(Array.isArray(entry) ? entry[0] : entry?.x ?? entry?.radius) || 0);
      const y = Number(Array.isArray(entry) ? entry[1] : entry?.y);
      if (Number.isFinite(y)) {
        includePoint(bounds, [-radius, y, -radius]);
        includePoint(bounds, [radius, y, radius]);
      }
    }
    return finalizeBounds(bounds, "descriptor-profile");
  }
  if (objType === "sweepmesh") {
    const pathBounds = boundsFromPointCollection(geometry.path?.points || geometry.path, "descriptor-path");
    const profile = Array.isArray(geometry.profile) ? geometry.profile : [];
    const radius = profile.reduce((max, entry) => {
      const x = Number(Array.isArray(entry) ? entry[0] : entry?.x);
      const y = Number(Array.isArray(entry) ? entry[1] : entry?.y);
      return Number.isFinite(x) && Number.isFinite(y) ? Math.max(max, Math.hypot(x, y)) : max;
    }, 0);
    return expandBounds(pathBounds, radius);
  }
  if (objType === "parametricsurface") {
    return boundsFromParametric(geometry);
  }
  if (["nurbssurface", "bezierpatch"].includes(objType)) {
    return boundsFromPointCollection(geometry.controlPoints, "descriptor-control-points");
  }
  if (objType === "loftmesh") {
    return boundsFromPointCollection(geometry.sections, "descriptor-sections");
  }
  const points = geometry.points || geometry.vertices || geometry.positions;
  return boundsFromPointCollection(points, "descriptor-points") || boundsFromPrimitive(descriptor, geometry);
}

function descriptorLocalMatrix(descriptor) {
  const position = resolvePosition(descriptor.position);
  const rotation = resolveRotation(descriptor.rotation);
  const scale = resolveScale(descriptor.scale);
  return new THREE.Matrix4().compose(
    new THREE.Vector3(position.x, position.y, position.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation.x, rotation.y, rotation.z)),
    new THREE.Vector3(scale.x, scale.y, scale.z)
  );
}

function transformBounds(bounds, matrix, source = bounds?.source || "descriptor") {
  if (!bounds || !matrix) return bounds || null;
  const result = new THREE.Box3();
  result.makeEmpty();
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) {
        result.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(matrix));
      }
    }
  }
  if (result.isEmpty()) return null;
  return { min: result.min.toArray(), max: result.max.toArray(), source };
}

function boundsFromRuntimeObject(object3D) {
  if (!object3D?.isObject3D) return null;
  object3D.updateWorldMatrix?.(true, false);
  const box = new THREE.Box3().setFromObject(object3D, true);
  if (box.isEmpty() || !box.min.toArray().every(Number.isFinite) || !box.max.toArray().every(Number.isFinite)) return null;
  return { min: box.min.toArray(), max: box.max.toArray(), source: "runtime-evaluated" };
}

function boundsRecord(bounds) {
  if (!bounds) return null;
  return {
    minX: bounds.min[0], maxX: bounds.max[0],
    minY: bounds.min[1], maxY: bounds.max[1],
    minZ: bounds.min[2], maxZ: bounds.max[2]
  };
}

function boundsSize(bounds) {
  if (!bounds) return 0;
  return Math.max(...bounds.max.map((value, axis) => Math.abs(value - bounds.min[axis])));
}

function countPositionVertices(geometry) {
  const position = geometry?.attributes?.position;
  const values = arrayLikeValues(position?.array ?? position?.data ?? position ?? geometry?.positions);
  const itemSize = Math.max(1, Math.round(Number(position?.itemSize) || 3));
  return values ? Math.floor(values.length / itemSize) : null;
}

function countIndices(geometry) {
  const values = arrayLikeValues(geometry?.index?.array ?? geometry?.index?.data ?? geometry?.index ?? geometry?.indices);
  return values ? values.length : null;
}

function summarizeModifierTypes(modifiers) {
  return [...new Set((Array.isArray(modifiers) ? modifiers : []).filter((item) => item?.enabled !== false).map((item) => String(item?.type || "").trim()).filter(Boolean))];
}

/**
 * @param {Record<string, unknown>} descriptor
 * @returns {string}
 */
export function buildGeometrySummary(descriptor, options = {}) {
  const objType = String(descriptor.objType || "").toLowerCase();
  const geometry = isObjectRecord(descriptor.geometry) ? descriptor.geometry : null;
  const runtimeGeometry = options.object3D?.geometry;
  if (objType === "editablemesh") {
    const topology = isObjectRecord(descriptor.topology) ? descriptor.topology : {};
    const vertices = Array.isArray(topology.vertices) ? topology.vertices.length : 0;
    const faces = Array.isArray(topology.faces) ? topology.faces.length : 0;
    const parts = new Set((topology.faces || []).map((face) => face?.part).filter(Boolean)).size;
    const modifiers = summarizeModifierTypes(descriptor.modifiers);
    const evaluatedVertices = runtimeGeometry?.getAttribute?.("position")?.count;
    return `editableMesh control=${vertices}v/${faces}f parts=${parts}${modifiers.length ? ` modifiers=${modifiers.join(",")}` : ""}${Number.isFinite(evaluatedVertices) ? ` evaluated=${evaluatedVertices}v` : ""}`;
  }
  if (objType === "buffermesh") {
    const vertices = runtimeGeometry?.getAttribute?.("position")?.count ?? countPositionVertices(geometry);
    const indexCount = runtimeGeometry?.index?.count ?? countIndices(geometry);
    const triangles = Number.isFinite(indexCount) ? Math.floor(indexCount / 3) : Number.isFinite(vertices) ? Math.floor(vertices / 3) : null;
    const attributes = runtimeGeometry?.attributes
      ? Object.keys(runtimeGeometry.attributes)
      : Object.keys(geometry?.attributes || {});
    return `bufferMesh${Number.isFinite(vertices) ? ` ${vertices}v` : ""}${Number.isFinite(triangles) ? `/${triangles}t` : ""}${attributes.length ? ` attrs=${attributes.join(",")}` : ""}`;
  }
  if (["parametricsurface", "nurbssurface", "bezierpatch", "lathemesh", "loftmesh", "sweepmesh", "implicitsurface"].includes(objType)) {
    const evaluatedVertices = runtimeGeometry?.getAttribute?.("position")?.count;
    const detail = objType === "nurbssurface" || objType === "bezierpatch"
      ? ` controls=${boundsFromPointCollection(geometry?.controlPoints)?.pointCount || "grid"}`
      : objType === "loftmesh"
        ? ` sections=${Array.isArray(geometry?.sections) ? geometry.sections.length : 0}`
        : objType === "sweepmesh"
          ? ` path=${Array.isArray(geometry?.path?.points || geometry?.path) ? (geometry.path?.points || geometry.path).length : 0}`
          : "";
    return `${objType}${detail}${Number.isFinite(evaluatedVertices) ? ` evaluated=${evaluatedVertices}v` : ""}`;
  }
  if (!geometry) {
    return objType ? `${objType} unknown` : "unknown";
  }
  if (objType === "cylinder" || geometry.radiusTop != null || geometry.radiusBottom != null) {
    const r = toNumber(geometry.radiusTop ?? geometry.radiusBottom ?? geometry.radius);
    const h = toNumber(geometry.height);
    return `cylinder r=${r}/h=${h}`;
  }
  if (
    objType === "sphere" ||
    (geometry.radius != null && geometry.width == null && geometry.radiusTop == null)
  ) {
    return `sphere r=${toNumber(geometry.radius)}`;
  }
  if (objType === "box" || geometry.width != null || geometry.depth != null) {
    const w = toNumber(geometry.width);
    const h = toNumber(geometry.height);
    const d = toNumber(geometry.depth);
    return `box ${w}×${h}×${d}`;
  }
  if (geometry.radius != null) {
    return `${objType || "shape"} r=${toNumber(geometry.radius)}`;
  }
  return objType ? `${objType} unknown` : "unknown";
}

/**
 * @param {Record<string, unknown>} descriptor
 * @returns {{ minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number }|null}
 */
export function buildFootprint(descriptor, options = {}) {
  const runtimeBounds = boundsFromRuntimeObject(options.object3D);
  if (runtimeBounds) return boundsRecord(runtimeBounds);
  const worldMatrix = options.worldMatrix || descriptorLocalMatrix(descriptor);
  const descriptorBounds = transformBounds(localBoundsFromDescriptor(descriptor), worldMatrix);
  if (descriptorBounds) return boundsRecord(descriptorBounds);
  const position = new THREE.Vector3().setFromMatrixPosition(worldMatrix);
  return { minX: position.x, maxX: position.x, minY: position.y, maxY: position.y, minZ: position.z, maxZ: position.z };
}

/**
 * @param {Record<string, unknown>} descriptor
 * @returns {object}
 */
export function buildObjectSpatialCard(descriptor, options = {}) {
  const id = typeof descriptor.threeJsonId === "string" ? descriptor.threeJsonId.trim() : "";
  const position = resolvePosition(descriptor.position);
  const rotation = resolveRotation(descriptor.rotation);
  const scale = resolveScale(descriptor.scale);
  const parentThreeJsonId =
    typeof options.parentThreeJsonId === "string" ? options.parentThreeJsonId.trim() : "";
  const object3D = options.object3D;
  const worldMatrix = object3D?.matrixWorld || options.worldMatrix || descriptorLocalMatrix(descriptor);
  const runtimeBounds = boundsFromRuntimeObject(object3D);
  const descriptorBounds = runtimeBounds || transformBounds(localBoundsFromDescriptor(descriptor), worldMatrix);
  const worldPositionVector = object3D?.isObject3D
    ? object3D.getWorldPosition(new THREE.Vector3())
    : new THREE.Vector3().setFromMatrixPosition(worldMatrix);
  const footprint = descriptorBounds ? boundsRecord(descriptorBounds) : buildFootprint(descriptor, { worldMatrix });
  return {
    threeJsonId: id,
    name: typeof descriptor.name === "string" ? descriptor.name : "",
    objType: typeof descriptor.objType === "string" ? descriptor.objType : "",
    ...(parentThreeJsonId ? { parentThreeJsonId } : {}),
    position,
    ...(parentThreeJsonId ? { worldPosition: vectorRecord(worldPositionVector) } : {}),
    rotation,
    scale,
    geometrySummary: buildGeometrySummary(descriptor, { object3D }),
    maxExtent: descriptorBounds ? boundsSize(descriptorBounds) : characteristicSizeFromDescriptor(descriptor, { worldMatrix }),
    footprint,
    ...(descriptorBounds ? { boundsSource: descriptorBounds.source } : {})
  };
}

/**
 * @param {Record<string, unknown>} descriptor
 * @returns {number}
 */
export function characteristicSizeFromDescriptor(descriptor, options = {}) {
  const bounds = transformBounds(localBoundsFromDescriptor(descriptor), options.worldMatrix || descriptorLocalMatrix(descriptor));
  return boundsSize(bounds);
}

/**
 * @param {Array<object>} cards
 * @param {{ truncated?: boolean, totalCount?: number }} [meta]
 * @returns {object}
 */
export function buildSceneScaleProfile(cards, meta = {}) {
  const list = Array.isArray(cards) ? cards : [];
  const sizes = [];
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < list.length; i += 1) {
    const card = list[i];
    if (typeof card.maxExtent === "number" && card.maxExtent > 0) {
      sizes.push(card.maxExtent);
    } else {
      const summary = String(card.geometrySummary || "");
      const boxMatch = summary.match(/box\s+([\d.]+)[×x]([\d.]+)[×x]([\d.]+)/i);
      if (boxMatch) {
        sizes.push(Math.max(Number(boxMatch[1]), Number(boxMatch[2]), Number(boxMatch[3])));
      } else {
        const sphereMatch = summary.match(/r=([\d.]+)/);
        if (sphereMatch) {
          sizes.push(Number(sphereMatch[1]) * 2);
        }
      }
    }
    const fp = card.footprint;
    if (fp && typeof fp === "object") {
      minX = Math.min(minX, toNumber(fp.minX));
      minY = Math.min(minY, toNumber(fp.minY));
      minZ = Math.min(minZ, toNumber(fp.minZ));
      maxX = Math.max(maxX, toNumber(fp.maxX));
      maxY = Math.max(maxY, toNumber(fp.maxY));
      maxZ = Math.max(maxZ, toNumber(fp.maxZ));
    }
  }

  sizes.sort((a, b) => a - b);
  const characteristicSize =
    sizes.length > 0 ? sizes[Math.floor(sizes.length / 2)] : 0;
  const minSize = sizes.length > 0 ? sizes[0] : 0;
  const maxSize = sizes.length > 0 ? sizes[sizes.length - 1] : 0;
  const typicalPartRange =
    sizes.length > 0 ? `${Math.round(minSize)}–${Math.round(maxSize)}` : "unknown";

  const profile = {
    objectCount: meta.totalCount ?? list.length,
    sceneBounds:
      Number.isFinite(minX) && Number.isFinite(maxX)
        ? {
            min: { x: minX, y: minY, z: minZ },
            max: { x: maxX, y: maxY, z: maxZ }
          }
        : null,
    characteristicSize: Math.round(characteristicSize * 10) / 10,
    typicalPartRange,
    note:
      "Default inference only — follow the modification request when it explicitly specifies size, position, or no changes."
  };
  if (meta.truncated) {
    profile.truncated = true;
    profile.includedObjectCount = list.length;
  }
  return profile;
}

/**
 * @param {import("../command/types.js").CommandContext} ctx
 * @returns {{ cards: object[], descriptorById: Map<string, object> }}
 */
export function buildObjectSpatialCardsFromScene(ctx) {
  const cards = [];
  const descriptorById = new Map();
  const seen = new Set();
  const scene = ctx?.scene;
  if (!scene?.isScene) {
    return { cards, descriptorById };
  }
  scene.traverse((node) => {
    const descriptor = node?.userData?.objJson;
    if (!isObjectRecord(descriptor)) {
      return;
    }
    const id = typeof descriptor.threeJsonId === "string" ? descriptor.threeJsonId.trim() : "";
    if (!id || seen.has(id)) {
      return;
    }
    seen.add(id);
    descriptorById.set(id, descriptor);
    const parentThreeJsonId = resolveParentThreeJsonId(node);
    cards.push(buildObjectSpatialCard(descriptor, { parentThreeJsonId, object3D: node }));
  });
  cards.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const totalCount = cards.length;
  if (cards.length > MAX_SPATIAL_OBJECTS) {
    return {
      cards: cards.slice(0, MAX_SPATIAL_OBJECTS),
      descriptorById,
      truncated: true,
      totalCount
    };
  }
  return { cards, descriptorById, totalCount };
}

/**
 * JSON-only variant of {@link buildObjectSpatialCardsFromScene}: walks a (friendly or standard)
 * scene JSON payload's canonical `objectList` (via `normalizeScenePayload`) instead of a live
 * Three.js scene graph. Used when only a cached/off-canvas scene JSON is available (e.g. a prior
 * chat turn's result), so no throwaway runtime needs to be instantiated just to compute spatial context.
 * @param {object} sceneJsonPayload
 * @returns {{ cards: object[], descriptorById: Map<string, object>, truncated?: boolean, totalCount?: number }}
 */
export function buildObjectSpatialCardsFromSceneJson(sceneJsonPayload) {
  const cards = [];
  const descriptorById = new Map();
  const seen = new Set();
  if (!isObjectRecord(sceneJsonPayload)) {
    return { cards, descriptorById };
  }

  let normalized;
  try {
    normalized = normalizeScenePayload(sceneJsonPayload);
  } catch (_error) {
    return { cards, descriptorById };
  }
  const objectList = Array.isArray(normalized?.objectList) ? normalized.objectList : [];

  function walk(records, parentThreeJsonId, parentWorldMatrix) {
    for (let i = 0; i < records.length; i += 1) {
      const descriptor = records[i];
      if (!isObjectRecord(descriptor)) {
        continue;
      }
      const worldMatrix = parentWorldMatrix.clone().multiply(descriptorLocalMatrix(descriptor));
      const id = typeof descriptor.threeJsonId === "string" ? descriptor.threeJsonId.trim() : "";
      if (id && !seen.has(id)) {
        seen.add(id);
        descriptorById.set(id, descriptor);
        cards.push(buildObjectSpatialCard(descriptor, { parentThreeJsonId, worldMatrix }));
      }
      if (Array.isArray(descriptor.subScene) && descriptor.subScene.length > 0) {
        walk(descriptor.subScene, id || parentThreeJsonId, worldMatrix);
      }
    }
  }
  walk(objectList, "", new THREE.Matrix4());

  cards.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const totalCount = cards.length;
  if (cards.length > MAX_SPATIAL_OBJECTS) {
    return {
      cards: cards.slice(0, MAX_SPATIAL_OBJECTS),
      descriptorById,
      truncated: true,
      totalCount
    };
  }
  return { cards, descriptorById, totalCount };
}

/**
 * Tokens from the user prompt for generic name overlap (no domain keyword list).
 * ASCII: alphanumeric/underscore runs; CJK: contiguous Han sequences.
 * @param {string} prompt
 * @returns {string[]}
 */
export function extractPromptTokens(prompt) {
  const text = String(prompt || "");
  const tokens = new Set();
  const ascii = text.match(/[a-zA-Z0-9_]+/g) || [];
  for (let i = 0; i < ascii.length; i += 1) {
    const token = ascii[i].toLowerCase();
    if (token.length >= MIN_PROMPT_TOKEN_LENGTH) {
      tokens.add(token);
    }
  }
  const cjk = text.match(/[一-鿿]+/g) || [];
  for (let i = 0; i < cjk.length; i += 1) {
    const token = cjk[i];
    if (token.length >= MIN_PROMPT_TOKEN_LENGTH) {
      tokens.add(token);
    }
  }
  return [...tokens];
}

/**
 * @param {string} name
 * @param {string[]} tokens
 * @returns {boolean}
 */
function objectNameOverlapsPromptTokens(name, tokens) {
  const n = String(name || "").toLowerCase();
  if (!n || !Array.isArray(tokens) || tokens.length === 0) {
    return false;
  }
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) {
      continue;
    }
    if (token.charCodeAt(0) > 127) {
      if (n.includes(token) || String(name || "").includes(token)) {
        return true;
      }
    } else if (n.includes(token)) {
      return true;
    }
  }
  return false;
}

/**
 * @param {Record<string, unknown>} descriptor
 * @returns {object}
 */
export function buildCompactReferenceDescriptor(descriptor) {
  const spatial = buildObjectSpatialCard(descriptor);
  const objType = String(descriptor.objType || "").toLowerCase();
  const geometry = isObjectRecord(descriptor.geometry) ? descriptor.geometry : null;
  const denseGeometry = objType === "editablemesh"
    || objType === "buffermesh"
    || ["parametricsurface", "nurbssurface", "bezierpatch", "lathemesh", "loftmesh", "sweepmesh", "implicitsurface", "irregulargeometry", "irregularplane"].includes(objType)
    || Boolean(geometry?.attributes?.position || geometry?.positions || geometry?.controlPoints || geometry?.sections || geometry?.path);
  const compact = {
    threeJsonId: descriptor.threeJsonId,
    name: descriptor.name,
    objType: descriptor.objType,
    position: spatial.position,
    rotation: spatial.rotation,
    scale: spatial.scale,
    geometrySummary: spatial.geometrySummary,
    maxExtent: spatial.maxExtent,
    footprint: spatial.footprint,
    ...(denseGeometry ? {} : { geometry: descriptor.geometry })
  };
  if (objType === "editablemesh") {
    const topology = isObjectRecord(descriptor.topology) ? descriptor.topology : {};
    compact.controlTopology = {
      revision: Math.max(0, Math.round(Number(topology.revision) || 0)),
      vertexCount: Array.isArray(topology.vertices) ? topology.vertices.length : 0,
      faceCount: Array.isArray(topology.faces) ? topology.faces.length : 0,
      parts: [...new Set((topology.faces || []).map((face) => face?.part).filter(Boolean))]
    };
    compact.modifiers = Array.isArray(descriptor.modifiers)
      ? descriptor.modifiers.map((modifier) => ({
          id: modifier?.id,
          type: modifier?.type,
          enabled: modifier?.enabled,
          levels: modifier?.levels,
          iterations: modifier?.iterations,
          factor: modifier?.factor
        }))
      : [];
  } else if (objType === "buffermesh") {
    compact.meshRevision = Math.max(0, Math.round(Number(descriptor.meshRevision) || 0));
  }
  if (isObjectRecord(descriptor.material)) {
    const material = descriptor.material;
    compact.material = {
      type: material.type,
      color: material.color,
      opacity: material.opacity
    };
  }
  if (Array.isArray(descriptor.materials)) {
    compact.materials = descriptor.materials.map((material) => ({
      type: material?.type,
      color: material?.color,
      opacity: material?.opacity
    }));
  }
  return compact;
}

/**
 * Reference objects for richer geometry/material context.
 * - Relative-placement prompts: prefer current selection when set.
 * - Otherwise: objects whose name shares a token with the prompt (no domain keyword list).
 * Cross-language (e.g. 中文提示 + English object names) is left to the LLM via Object spatial summary.
 * @param {string} prompt
 * @param {Array<object>} cards
 * @param {Map<string, object>} descriptorById
 * @param {{ selectionId?: string|null, selectionDescriptor?: object|null }} [options]
 * @returns {object[]}
 */
export function pickReferenceObjects(prompt, cards, descriptorById, options = {}) {
  const list = Array.isArray(cards) ? cards : [];
  const selectionId = typeof options.selectionId === "string" ? options.selectionId.trim() : "";
  const selectionDescriptor = isObjectRecord(options.selectionDescriptor)
    ? options.selectionDescriptor
    : null;

  if (selectionId && selectionDescriptor && promptHasRelativePlacement(prompt)) {
    return [buildCompactReferenceDescriptor(selectionDescriptor)];
  }

  const tokens = extractPromptTokens(prompt);
  if (tokens.length === 0 || list.length === 0) {
    return [];
  }

  const matched = [];
  const seen = new Set();
  for (let i = 0; i < list.length; i += 1) {
    const card = list[i];
    const name = String(card.name || "");
    if (!objectNameOverlapsPromptTokens(name, tokens) || !card.threeJsonId || seen.has(card.threeJsonId)) {
      continue;
    }
    seen.add(card.threeJsonId);
    const full = descriptorById?.get(card.threeJsonId);
    matched.push(full ? {
      ...buildCompactReferenceDescriptor(full),
      ...(card.parentThreeJsonId ? { parentThreeJsonId: card.parentThreeJsonId } : {}),
      ...(card.worldPosition ? { worldPosition: card.worldPosition } : {}),
      position: card.position,
      rotation: card.rotation,
      scale: card.scale,
      maxExtent: card.maxExtent,
      footprint: card.footprint,
      ...(card.boundsSource ? { boundsSource: card.boundsSource } : {})
    } : card);
    if (matched.length >= MAX_REFERENCE_OBJECTS) {
      break;
    }
  }
  return matched;
}

/**
 * @param {string} prompt
 * @returns {boolean}
 */
export function promptHasRelativePlacement(prompt) {
  const text = String(prompt || "").toLowerCase();
  return RELATIVE_POSITION_WORDS.some((word) => text.includes(word.toLowerCase()));
}

/**
 * @param {object[]} referenceObjects
 * @param {object} [scaleProfile]
 * @returns {string}
 */
export function buildPlacementHints(prompt, referenceObjects, scaleProfile = null) {
  if (!promptHasRelativePlacement(prompt)) {
    return "";
  }
  const range =
    scaleProfile?.typicalPartRange && scaleProfile.typicalPartRange !== "unknown"
      ? scaleProfile.typicalPartRange
      : null;
  const rangeSuffix = range
    ? ` with part sizes similar to scene (~${range})`
    : "";
  const overrideNote =
    " unless the modification request specifies otherwise.";

  const refs = Array.isArray(referenceObjects) ? referenceObjects : [];
  if (refs.length > 0) {
    const parts = [];
    let unionMinX = Infinity;
    let unionMaxX = -Infinity;
    for (let i = 0; i < refs.length; i += 1) {
      const ref = refs[i];
      const fp = ref.footprint || buildFootprint(ref);
      if (!fp) {
        continue;
      }
      unionMinX = Math.min(unionMinX, toNumber(fp.minX));
      unionMaxX = Math.max(unionMaxX, toNumber(fp.maxX));
      const label = ref.name || ref.threeJsonId || "reference";
      parts.push(`${label} spans x≈[${toNumber(fp.minX).toFixed(1)},${toNumber(fp.maxX).toFixed(1)}]`);
    }
    if (Number.isFinite(unionMaxX)) {
      const offsetX = unionMaxX + Math.max(10, (unionMaxX - unionMinX) * 0.5);
      return `${parts.join("; ")}. Suggested: place new content near x≈${offsetX.toFixed(0)}${rangeSuffix}${overrideNote}`;
    }
  }

  const bounds = scaleProfile?.sceneBounds;
  if (bounds?.min && bounds?.max) {
    const minX = toNumber(bounds.min.x);
    const maxX = toNumber(bounds.max.x);
    const offsetX = maxX + Math.max(10, (maxX - minX) * 0.1);
    return `Scene spans x≈[${minX.toFixed(1)},${maxX.toFixed(1)}]. Suggested: offset new content beyond existing bounds near x≈${offsetX.toFixed(0)}${rangeSuffix}${overrideNote}`;
  }

  return "";
}

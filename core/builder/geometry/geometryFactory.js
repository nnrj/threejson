import * as THREE from "three";

const factories = new Map();

function valueOr(value, fallback) {
  return value !== undefined && value !== null ? value : fallback;
}

export function normalizeGeometryType(value) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return raw.endsWith("geometry") ? raw.slice(0, -8) : raw;
}

export function registerGeometryFactory(type, factory) {
  const id = normalizeGeometryType(type);
  if (!id || typeof factory !== "function") {
    throw new Error("[geometryFactory] type and factory are required");
  }
  factories.set(id, factory);
}

export function unregisterGeometryFactory(type) {
  return factories.delete(normalizeGeometryType(type));
}

export function getGeometryFactory(type) {
  return factories.get(normalizeGeometryType(type)) ?? null;
}

export function resolveGeometryType(descriptor = {}, fallback = "box") {
  const candidates = [
    descriptor.instanceGeometry,
    descriptor.primitive,
    descriptor.geometry?.primitive,
    descriptor.geometry?.type,
    descriptor.objType
  ];
  for (const value of candidates) {
    const type = normalizeGeometryType(value);
    if (type && type !== "instanced") return type;
  }
  return normalizeGeometryType(fallback) || "box";
}

export function createGeometryFromDescriptor(descriptor = {}, options = {}) {
  const type = normalizeGeometryType(options.type) || resolveGeometryType(descriptor, options.fallbackType);
  const factory = getGeometryFactory(type);
  if (!factory) {
    const error = new Error(`ThreeJSON geometry type is not registered: ${type}`);
    error.code = "E_GEOMETRY_TYPE_UNAVAILABLE";
    error.geometryType = type;
    throw error;
  }
  const geometryDescriptor = descriptor.geometry && typeof descriptor.geometry === "object"
    ? descriptor.geometry
    : descriptor;
  const geometry = factory(geometryDescriptor, descriptor, options);
  if (!geometry?.isBufferGeometry) {
    throw new Error(`[geometryFactory] ${type} factory returned no THREE.BufferGeometry`);
  }
  geometry.userData = { ...(geometry.userData || {}), threeJsonGeometryType: type };
  return geometry;
}

function registerBuiltins() {
  registerGeometryFactory("box", (g) => new THREE.BoxGeometry(
    valueOr(g.width, 1), valueOr(g.height, 1), valueOr(g.depth, 1),
    valueOr(g.widthSegments, 1), valueOr(g.heightSegments, 1), valueOr(g.depthSegments, 1)
  ));
  registerGeometryFactory("sphere", (g) => new THREE.SphereGeometry(
    valueOr(g.radius, 1), valueOr(g.widthSegments, 32), valueOr(g.heightSegments, 16),
    valueOr(g.phiStart, 0), valueOr(g.phiLength, Math.PI * 2),
    valueOr(g.thetaStart, 0), valueOr(g.thetaLength, Math.PI)
  ));
  registerGeometryFactory("cylinder", (g) => new THREE.CylinderGeometry(
    valueOr(g.radiusTop, valueOr(g.radius, 1)), valueOr(g.radiusBottom, valueOr(g.radius, 1)),
    valueOr(g.height, valueOr(g.length, 1)), valueOr(g.radialSegments, 32),
    valueOr(g.heightSegments, 1), valueOr(g.openEnded, false),
    valueOr(g.thetaStart, 0), valueOr(g.thetaLength, Math.PI * 2)
  ));
  registerGeometryFactory("cone", (g) => new THREE.ConeGeometry(
    valueOr(g.radius, 1), valueOr(g.height, valueOr(g.length, 1)),
    valueOr(g.radialSegments, 32), valueOr(g.heightSegments, 1),
    valueOr(g.openEnded, false), valueOr(g.thetaStart, 0), valueOr(g.thetaLength, Math.PI * 2)
  ));
  registerGeometryFactory("ring", (g) => new THREE.RingGeometry(
    valueOr(g.innerRadius, 0.5), valueOr(g.outerRadius, 1),
    valueOr(g.thetaSegments, 32), valueOr(g.phiSegments, 1),
    valueOr(g.thetaStart, 0), valueOr(g.thetaLength, Math.PI * 2)
  ));
  registerGeometryFactory("torus", (g) => new THREE.TorusGeometry(
    valueOr(g.radius, 1), valueOr(g.tube, 0.4), valueOr(g.radialSegments, 16),
    valueOr(g.tubularSegments, 48), valueOr(g.arc, Math.PI * 2)
  ));
  registerGeometryFactory("capsule", (g) => new THREE.CapsuleGeometry(
    valueOr(g.radius, 0.5), valueOr(g.length, 1),
    valueOr(g.capSegments, 4), valueOr(g.radialSegments, 8)
  ));
  registerGeometryFactory("plane", (g) => new THREE.PlaneGeometry(
    valueOr(g.width, 1), valueOr(g.height, 1),
    valueOr(g.widthSegments, 1), valueOr(g.heightSegments, 1)
  ));
  registerGeometryFactory("circle", (g) => new THREE.CircleGeometry(
    valueOr(g.radius, 1), valueOr(g.segments, 32),
    valueOr(g.thetaStart, 0), valueOr(g.thetaLength, Math.PI * 2)
  ));
}

registerBuiltins();

export function _resetGeometryFactoriesForTests() {
  factories.clear();
  registerBuiltins();
}


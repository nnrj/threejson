import * as THREE from "three";
import { sampleCurveDescriptor } from "../curve/curveFactory.js";

const optionalSamplers = new Map();

function normalizeType(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function createSeededRandom(seed = 1) {
  let state = Math.trunc(Number(seed) || 1) >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function registerParticleSourceSampler(type, sampler) {
  const id = normalizeType(type);
  if (!id || typeof sampler !== "function") throw new Error("[particleSource] type and sampler are required");
  optionalSamplers.set(id, sampler);
}

export function unregisterParticleSourceSampler(type) {
  return optionalSamplers.delete(normalizeType(type));
}

export function getParticleSourceSampler(type) {
  return optionalSamplers.get(normalizeType(type)) ?? null;
}

function write(out, index, x, y, z) {
  const offset = index * 3;
  out[offset] = x;
  out[offset + 1] = y;
  out[offset + 2] = z;
}

function unitVector(random) {
  const y = random() * 2 - 1;
  const angle = random() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  return { x: r * Math.cos(angle), y, z: r * Math.sin(angle) };
}

function normalizePoint(value) {
  if (Array.isArray(value)) return new THREE.Vector3(finite(value[0], 0), finite(value[1], 0), finite(value[2], 0));
  return new THREE.Vector3(finite(value?.x, 0), finite(value?.y, 0), finite(value?.z, 0));
}

function samplePolyline(points, count, random, curve = false) {
  const vectors = points.map(normalizePoint);
  const out = new Float32Array(count * 3);
  if (vectors.length === 1) {
    for (let i = 0; i < count; i++) write(out, i, vectors[0].x, vectors[0].y, vectors[0].z);
    return out;
  }
  if (curve) {
    const curveObject = new THREE.CatmullRomCurve3(vectors, false, "centripetal");
    for (let i = 0; i < count; i++) {
      const point = curveObject.getPoint(count <= 1 ? 0 : i / (count - 1));
      write(out, i, point.x, point.y, point.z);
    }
    return out;
  }
  const lengths = [];
  let total = 0;
  for (let i = 1; i < vectors.length; i++) {
    total += vectors[i - 1].distanceTo(vectors[i]);
    lengths.push(total);
  }
  for (let i = 0; i < count; i++) {
    const distance = random() * Math.max(total, 1e-9);
    let segment = lengths.findIndex((value) => distance <= value);
    if (segment < 0) segment = lengths.length - 1;
    const startDistance = segment === 0 ? 0 : lengths[segment - 1];
    const span = Math.max(1e-9, lengths[segment] - startDistance);
    const point = vectors[segment].clone().lerp(vectors[segment + 1], (distance - startDistance) / span);
    write(out, i, point.x, point.y, point.z);
  }
  return out;
}

function sampleMeshGeometry(source, count, random, options) {
  const object = source.object || options.resolveMesh?.(source.threeJsonId ?? source.objectId);
  let meshObject = object?.geometry?.isBufferGeometry ? object : null;
  if (!meshObject && object?.traverse) {
    object.traverse((child) => {
      if (meshObject || !child?.geometry?.isBufferGeometry) return;
      if (!source.meshName || child.name === source.meshName) meshObject = child;
    });
  }
  const geometry = source.geometry?.isBufferGeometry ? source.geometry : meshObject?.geometry;
  const position = geometry?.getAttribute?.("position");
  if (!position) throw new Error("[particleSource] meshSurface requires a BufferGeometry or resolvable mesh id");
  let sourceToTarget = null;
  if (meshObject && String(source.space || "world").trim().toLowerCase() !== "local") {
    meshObject.updateWorldMatrix?.(true, false);
    sourceToTarget = meshObject.matrixWorld.clone();
    if (options.targetMatrixWorld?.isMatrix4) {
      sourceToTarget.premultiply(options.targetMatrixWorld.clone().invert());
    }
  }
  const index = geometry.index;
  const triangleCount = index ? index.count / 3 : position.count / 3;
  const areas = new Float64Array(triangleCount);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let total = 0;
  const readVertex = (target, vertexIndex) => target.fromBufferAttribute(position, vertexIndex);
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const ia = index ? index.getX(triangle * 3) : triangle * 3;
    const ib = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1;
    const ic = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2;
    readVertex(a, ia); readVertex(b, ib); readVertex(c, ic);
    total += b.clone().sub(a).cross(c.clone().sub(a)).length() * 0.5;
    areas[triangle] = total;
  }
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const targetArea = random() * total;
    let lo = 0; let hi = triangleCount - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (areas[mid] < targetArea) lo = mid + 1; else hi = mid; }
    const ia = index ? index.getX(lo * 3) : lo * 3;
    const ib = index ? index.getX(lo * 3 + 1) : lo * 3 + 1;
    const ic = index ? index.getX(lo * 3 + 2) : lo * 3 + 2;
    readVertex(a, ia); readVertex(b, ib); readVertex(c, ic);
    let u = random(); let v = random();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const point = a.clone().add(b.clone().sub(a).multiplyScalar(u)).add(c.clone().sub(a).multiplyScalar(v));
    if (sourceToTarget) point.applyMatrix4(sourceToTarget);
    write(out, i, point.x, point.y, point.z);
  }
  return out;
}

/** World transform of an emitter descriptor before its runtime Object3D exists. */
export function buildParticleEmitterWorldMatrix(record = {}, parent = null) {
  parent?.updateWorldMatrix?.(true, false);
  const position = normalizePoint(record.position);
  const rotation = record.rotation || {};
  const scale = record.scale || {};
  const local = new THREE.Matrix4().compose(
    position,
    new THREE.Quaternion().setFromEuler(new THREE.Euler(
      finite(rotation.x, 0),
      finite(rotation.y, 0),
      finite(rotation.z, 0),
      "XYZ"
    )),
    new THREE.Vector3(finite(scale.x, 1), finite(scale.y, 1), finite(scale.z, 1))
  );
  return parent?.matrixWorld?.isMatrix4 ? parent.matrixWorld.clone().multiply(local) : local;
}

function sampleBuiltin(source, count, random, options) {
  const type = normalizeType(source.type) || "box";
  if (type === "positions") {
    const points = Array.isArray(source.positions) ? source.positions : [];
    if (!points.length) throw new Error("[particleSource] positions source is empty");
    const out = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const point = normalizePoint(points[i % points.length]);
      write(out, i, point.x, point.y, point.z);
    }
    return out;
  }
  if (type === "line" || type === "curve") {
    const curveDefinition = source.path && typeof source.path === "object" ? source.path : source;
    const points = Array.isArray(curveDefinition.points) ? curveDefinition.points : [];
    if (type === "line") {
      if (points.length < 2) throw new Error("[particleSource] line requires at least two points");
      return samplePolyline(points, count, random, false);
    }
    return sampleCurveDescriptor(curveDefinition, count, THREE, { spaced: source.spaced !== false });
  }
  if (type === "meshsurface") return sampleMeshGeometry(source, count, random, options);

  if (!["box", "sphere", "shell", "disc", "cone"].includes(type)) {
    throw Object.assign(new Error(`[particleSource] source type is not registered: ${type}`), {
      code: "E_PARTICLE_SOURCE_UNAVAILABLE",
      sourceType: type
    });
  }

  const out = new Float32Array(count * 3);
  const width = finite(source.width, 100);
  const height = finite(source.height, 100);
  const depth = finite(source.depth, 100);
  const radius = Math.max(0, finite(source.radius, Math.max(width, height, depth) / 2));
  for (let i = 0; i < count; i++) {
    if (type === "sphere" || type === "shell") {
      const direction = unitVector(random);
      const inner = type === "shell"
        ? Math.max(0, radius - Math.max(0, finite(source.thickness, radius * 0.1)))
        : Math.max(0, finite(source.innerRadius, 0));
      const sampledRadius = Math.cbrt(inner ** 3 + random() * Math.max(0, radius ** 3 - inner ** 3));
      write(out, i, direction.x * sampledRadius, direction.y * sampledRadius, direction.z * sampledRadius);
    } else if (type === "disc") {
      const sampledRadius = Math.sqrt(random()) * radius;
      const angle = random() * Math.PI * 2;
      write(out, i, Math.cos(angle) * sampledRadius, 0, Math.sin(angle) * sampledRadius);
    } else if (type === "cone") {
      const y = random() * height;
      const localRadius = Math.sqrt(random()) * radius * (y / Math.max(height, 1e-9));
      const angle = random() * Math.PI * 2;
      write(out, i, Math.cos(angle) * localRadius, y - height / 2, Math.sin(angle) * localRadius);
    } else {
      write(out, i, (random() - 0.5) * width, (random() - 0.5) * height, (random() - 0.5) * depth);
    }
  }
  return out;
}

export function sampleParticleSourcePositions(source = {}, count, options = {}) {
  const random = options.random || createSeededRandom(options.seed);
  const type = normalizeType(source.type) || "box";
  const optional = optionalSamplers.get(type);
  if (optional) return optional(source, count, { ...options, random });
  return sampleBuiltin(source, count, random, options);
}

export function _clearOptionalParticleSourceSamplersForTests() {
  optionalSamplers.clear();
}

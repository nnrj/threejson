/**
 * particleEmitter simulation=gpuCompute: GPUComputationRenderer updates position texture; Points + ShaderMaterial sample and render.
 */
import * as THREE from "three";
import { log } from "../../util/logger.js";
import { GPUComputationRenderer } from "three/examples/jsm/misc/GPUComputationRenderer.js";
import { trackDisposableResource } from "../../handler/trackedResourceRegistry.js";
import { registerObject } from "../../handler/objectRegistry.js";
import { setUserDataObjJson } from "../../handler/objectDescriptorAttach.js";
import { applyVisibilityFromDescriptor } from "../../util/util.js";
import { resolvePointsBlending } from "../pointsBuilder.js";
import { PARTICLE_EMITTER_DEFAULT_OPACITY } from "../../theme/runtimeVisualDefaults.js";
import { resolveDriftVelocityFromRecord, resolveParticleTextureSize } from "./particleComputeUtil.js";

export { resolveParticleTextureSize } from "./particleComputeUtil.js";

/** @type {WeakMap<import("three").Points, object>} */
const gpuStateByPoints = new WeakMap();

/** @type {Set<import("three").Points>} */
const gpuMotionTargets = new Set();

const DEFAULT_POSITION_COMPUTE_SHADER = /* glsl */ `
uniform float delta;
uniform vec3 velocity;
uniform vec3 boundMin;
uniform vec3 boundMax;

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 particle = texture2D(texturePosition, uv);
  if (particle.w < 0.5) {
    gl_FragColor = particle;
    return;
  }
  vec3 pos = particle.xyz + velocity * delta;
  if (pos.x < boundMin.x) pos.x = boundMax.x;
  if (pos.x > boundMax.x) pos.x = boundMin.x;
  if (pos.y < boundMin.y) pos.y = boundMax.y;
  if (pos.y > boundMax.y) pos.y = boundMin.y;
  if (pos.z < boundMin.z) pos.z = boundMax.z;
  if (pos.z > boundMax.z) pos.z = boundMin.z;
  gl_FragColor = vec4(pos, particle.w);
}
`;

const PARTICLE_VERT = /* glsl */ `
uniform sampler2D texturePosition;
uniform float size;
uniform bool sizeAttenuation;

attribute vec2 reference;

void main() {
  vec3 particlePosition = texture2D(texturePosition, reference).xyz;
  vec4 mvPosition = modelViewMatrix * vec4(particlePosition, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  if (sizeAttenuation) {
    gl_PointSize = size * (300.0 / max(-mvPosition.z, 1.0));
  } else {
    gl_PointSize = size;
  }
}
`;

const PARTICLE_FRAG = /* glsl */ `
uniform vec3 color;
uniform float opacity;

void main() {
  vec2 centered = gl_PointCoord - vec2(0.5);
  float dist = length(centered);
  if (dist > 0.5) {
    discard;
  }
  float alpha = opacity * (1.0 - smoothstep(0.35, 0.5, dist));
  gl_FragColor = vec4(color, alpha);
}
`;

function hasFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function valueOr(value, fallback) {
  return value !== undefined && value !== null ? value : fallback;
}

/**
 * @param {object} record
 * @returns {{ width: number, height: number, depth: number }}
 */
function resolveBounds(record) {
  const geometry = record?.geometry && typeof record.geometry === "object" ? record.geometry : {};
  const bounds = record?.bounds && typeof record.bounds === "object" ? record.bounds : geometry;
  return {
    width: Number(valueOr(bounds.width, 100)),
    height: Number(valueOr(bounds.height, 100)),
    depth: Number(valueOr(bounds.depth, 100))
  };
}

/**
 * @param {object} record
 * @returns {THREE.Vector3}
 */
function resolveVelocityVector(record) {
  const fromMotion = resolveDriftVelocityFromRecord(record);
  if (fromMotion) {
    return new THREE.Vector3(fromMotion.x, fromMotion.y, fromMotion.z);
  }
  const emitter = record?.emitter && typeof record.emitter === "object" ? record.emitter : {};
  const compute = record?.compute && typeof record.compute === "object" ? record.compute : {};
  const velocity = compute.velocity ?? emitter.velocity ?? record.velocity ?? { x: 0, y: -1, z: 0 };
  const direction = new THREE.Vector3(
    Number(valueOr(velocity.x, 0)),
    Number(valueOr(velocity.y, -1)),
    Number(valueOr(velocity.z, 0))
  );
  if (direction.lengthSq() <= 1e-8) {
    direction.set(0, -1, 0);
  } else {
    direction.normalize();
  }
  const speed = hasFiniteNumber(compute.speed)
    ? Number(compute.speed)
    : hasFiniteNumber(emitter.speed)
      ? Number(emitter.speed)
      : hasFiniteNumber(record.speed)
        ? Number(record.speed)
        : 1.5;
  return direction.multiplyScalar(speed);
}

/**
 * @param {THREE.DataTexture} texture
 * @param {number} count
 * @param {{ width: number, height: number, depth: number }} bounds
 * @param {number} textureWidth
 * @param {number} textureHeight
 */
function fillInitialPositionTexture(texture, count, bounds, textureWidth, textureHeight) {
  const data = texture.image.data;
  const halfW = bounds.width / 2;
  const halfH = bounds.height / 2;
  const halfD = bounds.depth / 2;
  const capacity = textureWidth * textureHeight;
  for (let i = 0; i < capacity; i += 1) {
    const o = i * 4;
    if (i < count) {
      data[o] = (Math.random() * 2 - 1) * halfW;
      data[o + 1] = (Math.random() * 2 - 1) * halfH;
      data[o + 2] = (Math.random() * 2 - 1) * halfD;
      data[o + 3] = 1;
    } else {
      data[o] = 0;
      data[o + 1] = 0;
      data[o + 2] = 0;
      data[o + 3] = 0;
    }
  }
  texture.needsUpdate = true;
}

/**
 * @param {number} count
 * @param {number} textureWidth
 * @param {number} textureHeight
 * @returns {THREE.BufferGeometry}
 */
function buildReferenceGeometry(count, textureWidth, textureHeight) {
  const positions = new Float32Array(count * 3);
  const references = new Float32Array(count * 2);
  for (let i = 0; i < count; i += 1) {
    const x = i % textureWidth;
    const y = Math.floor(i / textureWidth);
    references[i * 2] = (x + 0.5) / textureWidth;
    references[i * 2 + 1] = (y + 0.5) / textureHeight;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("reference", new THREE.BufferAttribute(references, 2));
  trackDisposableResource(geometry);
  return geometry;
}

/**
 * @param {object} record
 * @returns {THREE.ShaderMaterial}
 */
function buildParticleShaderMaterial(record) {
  const materialInfo = record?.material && typeof record.material === "object" ? record.material : {};
  const color = new THREE.Color(valueOr(materialInfo.color, "#ffffff"));
  const opacity = Number(valueOr(materialInfo.opacity, PARTICLE_EMITTER_DEFAULT_OPACITY));
  const size = Number(valueOr(materialInfo.size, 2));
  const transparent = valueOr(materialInfo.transparent, true) !== false;
  const depthWrite = valueOr(materialInfo.depthWrite, false);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      texturePosition: { value: null },
      size: { value: size },
      sizeAttenuation: { value: valueOr(materialInfo.sizeAttenuation, true) !== false },
      color: { value: color },
      opacity: { value: opacity }
    },
    vertexShader: PARTICLE_VERT,
    fragmentShader: PARTICLE_FRAG,
    transparent,
    depthWrite,
    blending: resolvePointsBlending(materialInfo.blending)
  });
  trackDisposableResource(material);
  return material;
}

function applyObjectTransform(object3D, record = {}) {
  const position = record.position && typeof record.position === "object" ? record.position : {};
  const rotation = record.rotation && typeof record.rotation === "object" ? record.rotation : {};
  const scale = record.scale && typeof record.scale === "object" ? record.scale : {};
  object3D.position.set(
    Number(valueOr(position.x, 0)),
    Number(valueOr(position.y, 0)),
    Number(valueOr(position.z, 0))
  );
  object3D.rotation.set(
    Number(valueOr(rotation.rotationX, 0)),
    Number(valueOr(rotation.rotationY, 0)),
    Number(valueOr(rotation.rotationZ, 0))
  );
  object3D.scale.set(
    Number(valueOr(scale.scaleX, 1)),
    Number(valueOr(scale.scaleY, 1)),
    Number(valueOr(scale.scaleZ, 1))
  );
  applyVisibilityFromDescriptor(object3D, record);
}

/**
 * @param {import("three").Points} points
 */
export function disposeParticleGpuCompute(points) {
  if (!points) {
    return;
  }
  const state = gpuStateByPoints.get(points);
  if (!state) {
    return;
  }
  if (state.onRemoved) {
    points.removeEventListener("removed", state.onRemoved);
  }
  state.gpuCompute?.dispose?.();
  gpuStateByPoints.delete(points);
  gpuMotionTargets.delete(points);
}

/**
 * @param {number} deltaSeconds
 */
export function updateParticleGpuCompute(deltaSeconds) {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0 || gpuMotionTargets.size === 0) {
    return;
  }
  for (const points of gpuMotionTargets) {
    if (!points || !points.parent) {
      disposeParticleGpuCompute(points);
      continue;
    }
    const state = gpuStateByPoints.get(points);
    if (!state?.gpuCompute || !state.posVar) {
      disposeParticleGpuCompute(points);
      continue;
    }
    state.posVar.material.uniforms.delta.value = deltaSeconds;
    state.gpuCompute.compute();
    const texture = state.gpuCompute.getCurrentRenderTarget(state.posVar).texture;
    if (points.material?.uniforms?.texturePosition) {
      points.material.uniforms.texturePosition.value = texture;
    }
  }
}

/**
 * @param {object} record
 * @param {import("three").Scene} scene
 * @param {import("three").WebGLRenderer} renderer
 * @param {object} [ctx={}]
 * @returns {import("three").Points|null}
 */
export function deployParticleGpuEmitter(record, scene, renderer, ctx = {}) {
  if (!record || !scene || !renderer) {
    return null;
  }
  if (!renderer.capabilities?.isWebGL2) {
    return null;
  }

  const count = Math.min(Math.max(Math.floor(Number(valueOr(record.count, 1000))), 1), 500000);
  const compute = record.compute && typeof record.compute === "object" ? record.compute : {};
  const { width: textureWidth, height: textureHeight } = resolveParticleTextureSize(count, compute);
  const bounds = resolveBounds(record);
  const velocity = resolveVelocityVector(record);

  let gpuCompute;
  try {
    gpuCompute = new GPUComputationRenderer(textureWidth, textureHeight, renderer);
  } catch (error) {
    log.warn("[particleEmitter] GPUComputationRenderer creation failed:", error);
    return null;
  }
  trackDisposableResource(gpuCompute);

  const pos0 = gpuCompute.createTexture();
  fillInitialPositionTexture(pos0, count, bounds, textureWidth, textureHeight);

  const fragmentShader =
    typeof compute.fragmentShader === "string" && compute.fragmentShader.trim()
      ? compute.fragmentShader
      : DEFAULT_POSITION_COMPUTE_SHADER;

  const posVar = gpuCompute.addVariable("texturePosition", fragmentShader, pos0);
  gpuCompute.setVariableDependencies(posVar, [posVar]);

  const half = new THREE.Vector3(bounds.width / 2, bounds.height / 2, bounds.depth / 2);
  posVar.material.uniforms.delta = { value: 0 };
  posVar.material.uniforms.velocity = { value: velocity.clone() };
  posVar.material.uniforms.boundMin = { value: half.clone().multiplyScalar(-1) };
  posVar.material.uniforms.boundMax = { value: half.clone() };

  if (compute.uniforms && typeof compute.uniforms === "object" && !Array.isArray(compute.uniforms)) {
    for (const key of Object.keys(compute.uniforms)) {
      if (key in posVar.material.uniforms) {
        continue;
      }
      posVar.material.uniforms[key] = { value: compute.uniforms[key] };
    }
  }

  const initError = gpuCompute.init();
  if (initError) {
    log.warn("[particleEmitter] gpuCompute init failed:", initError);
    gpuCompute.dispose?.();
    return null;
  }

  const geometry = buildReferenceGeometry(count, textureWidth, textureHeight);
  const material = buildParticleShaderMaterial(record);
  material.uniforms.texturePosition.value = gpuCompute.getCurrentRenderTarget(posVar).texture;

  const points = new THREE.Points(geometry, material);
  trackDisposableResource(points);
  points.frustumCulled = false;
  points.name = typeof record.name === "string" && record.name.length ? record.name : "particle-emitter-gpu";

  const payload = {
    ...record,
    objType: "particleEmitter",
    simulation: "gpuCompute",
    count,
    bounds,
    compute,
    userData: {
      ...(record.userData && typeof record.userData === "object" ? record.userData : {}),
      particleEmitter: {
        simulation: "gpuCompute",
        requestedSimulation: "gpuCompute",
        textureWidth,
        textureHeight
      }
    }
  };
  setUserDataObjJson(points, payload);
  applyObjectTransform(points, record);
  scene.add(points);

  const state = {
    gpuCompute,
    posVar,
    onRemoved: () => {
      disposeParticleGpuCompute(points);
    }
  };
  points.addEventListener("removed", state.onRemoved);
  gpuStateByPoints.set(points, state);
  gpuMotionTargets.add(points);

  return registerObject(points, payload);
}

/** For unit tests only */
export function _resetParticleGpuComputeForTests() {
  for (const points of gpuMotionTargets) {
    disposeParticleGpuCompute(points);
  }
  gpuMotionTargets.clear();
}

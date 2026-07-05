/**
 * Procedural sky GLSL (Three.js Sky approach; domain-maintained preset).
 */
import * as THREE from "three";
import { registerShaderPreset } from "../../../../core/builder/shader/shaderPresetRegistry.js";
import {
  parseSkyCycleConfig,
  skyStateToUniforms,
  updateSkyCycleUniforms
} from "../skyTimeOfDay.js";

const VERT = /* glsl */ `
out vec3 vWorldPosition;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 sunDirection;
uniform vec3 zenithColor;
uniform vec3 horizonColor;
uniform float sunIntensity;

in vec3 vWorldPosition;

out vec4 fragColor;

void main() {
  vec3 direction = normalize(vWorldPosition - cameraPosition);
  float upAmount = direction.y * 0.5 + 0.5;
  vec3 sky = mix(horizonColor, zenithColor, pow(clamp(upAmount, 0.0, 1.0), 0.65));
  float sunDot = max(dot(direction, normalize(sunDirection)), 0.0);
  float sunDisk = pow(sunDot, 256.0) * sunIntensity;
  float sunGlow = pow(sunDot, 8.0) * sunIntensity * 0.35;
  sky += vec3(1.0, 0.92, 0.75) * (sunDisk + sunGlow);
  fragColor = vec4(sky, 1.0);
}
`;

/**
 * @param {Record<string, unknown>} uniforms
 * @returns {THREE.ShaderMaterial}
 */
function createAtmosphereMaterial(uniforms = {}) {
  const sun = parseVec3(uniforms.sunDirection, [0.3, 0.85, 0.2]);
  const zenith = new THREE.Color(
    typeof uniforms.zenithColor === "string" ? uniforms.zenithColor : "#1a4a7a"
  );
  const horizon = new THREE.Color(
    typeof uniforms.horizonColor === "string" ? uniforms.horizonColor : "#7eb8ff"
  );
  const sunIntensity = Number.isFinite(Number(uniforms.sunIntensity))
    ? Number(uniforms.sunIntensity)
    : 1.2;
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      sunDirection: { value: sun.clone().normalize() },
      zenithColor: { value: zenith },
      horizonColor: { value: horizon },
      sunIntensity: { value: sunIntensity },
      time: { value: 0 },
      deltaTime: { value: 0 },
      globalTime: { value: 0 }
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false
  });
}

/**
 * @param {unknown} value
 * @param {number[]} fallback
 * @returns {THREE.Vector3}
 */
function parseVec3(value, fallback) {
  if (Array.isArray(value) && value.length >= 3) {
    return new THREE.Vector3(Number(value[0]), Number(value[1]), Number(value[2]));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return new THREE.Vector3(
      Number(value.x ?? fallback[0]),
      Number(value.y ?? fallback[1]),
      Number(value.z ?? fallback[2])
    );
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

export function registerAtmosphereShaderPresets() {
  registerShaderPreset("atmosphere", {
    schema: {
      sunDirection: "vec3",
      zenithColor: "color",
      horizonColor: "color",
      sunIntensity: "number"
    },
    defaultUniforms: {
      sunDirection: [0.3, 0.85, 0.2],
      zenithColor: "#1a4a7a",
      horizonColor: "#7eb8ff",
      sunIntensity: 1.2
    },
    createMaterial: createAtmosphereMaterial
  });

  registerShaderPreset("sunset", {
    schema: {
      sunDirection: "vec3",
      zenithColor: "color",
      horizonColor: "color",
      sunIntensity: "number"
    },
    defaultUniforms: {
      sunDirection: [0.65, 0.12, 0.25],
      zenithColor: "#2a1a4a",
      horizonColor: "#ff8c42",
      sunIntensity: 1.8
    },
    createMaterial: createAtmosphereMaterial
  });

  registerShaderPreset("skyCycle", {
    schema: {
      timeOfDay: "number",
      autoCycle: "boolean",
      cycleDuration: "number",
      syncBackground: "boolean",
      sunDirection: "vec3",
      zenithColor: "color",
      horizonColor: "color",
      sunIntensity: "number"
    },
    defaultUniforms: {
      timeOfDay: 12,
      autoCycle: false,
      cycleDuration: 600,
      syncBackground: false
    },
    createMaterial(uniforms = {}) {
      const cycle = parseSkyCycleConfig(uniforms);
      const initial = skyStateToUniforms(cycle.timeOfDay, cycle.keyframes);
      return createAtmosphereMaterial(initial);
    },
    updateUniforms: updateSkyCycleUniforms
  });
}

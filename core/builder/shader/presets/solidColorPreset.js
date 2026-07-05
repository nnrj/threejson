/**
 * Test/placeholder preset: solid-color ShaderMaterial (Phase 0 registry + deploy path validation).
 */
import * as THREE from "three";
import { registerShaderPreset } from "../shaderPresetRegistry.js";

const VERT = /* glsl */ `
out vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 color;
uniform float opacity;

in vec2 vUv;

out vec4 fragColor;

void main() {
  fragColor = vec4(color, opacity);
}
`;

/**
 * @param {Record<string, unknown>} uniforms
 * @returns {THREE.ShaderMaterial}
 */
function createSolidColorMaterial(uniforms = {}) {
  const color = new THREE.Color(
    typeof uniforms.color === "string" ? uniforms.color : "#4488ff"
  );
  const opacity = Number.isFinite(Number(uniforms.opacity)) ? Number(uniforms.opacity) : 1;
  const transparent = uniforms.transparent === true || opacity < 1;
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      color: { value: color },
      opacity: { value: opacity },
      time: { value: 0 },
      deltaTime: { value: 0 },
      globalTime: { value: 0 }
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent,
    depthWrite: !transparent,
    side: THREE.DoubleSide
  });
}

export function registerSolidColorPreset() {
  registerShaderPreset("solidColor", {
    schema: {
      color: "color",
      opacity: "number",
      transparent: "boolean"
    },
    defaultUniforms: {
      color: "#4488ff",
      opacity: 1,
      transparent: false
    },
    createMaterial: createSolidColorMaterial
  });
}

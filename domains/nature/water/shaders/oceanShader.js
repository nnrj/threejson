/**
 * Ocean surface GLSL: low (lightweight) and medium/high/ultra (Gerstner + Fresnel + optional plane reflection).
 */
import * as THREE from "three";
import { registerShaderPreset } from "../../../../core/builder/shader/shaderPresetRegistry.js";
import { parseWaterQuality, WATER_QUALITY_TIER } from "../waterQuality.js";

const VERT_LOW = /* glsl */ `
out vec2 vUv;
out float vWave;

uniform float time;
uniform float waveScale;
uniform float waveSpeed;
uniform float waveHeight;

void main() {
  vUv = uv;
  vec3 pos = position;
  float wave = sin(pos.x * waveScale + time * waveSpeed) * waveHeight
    + sin(pos.y * waveScale * 0.85 - time * waveSpeed * 0.73) * waveHeight * 0.6;
  pos.z += wave;
  vWave = wave;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const FRAG_LOW = /* glsl */ `
uniform vec3 waterColor;
uniform vec3 foamColor;
uniform float opacity;

in vec2 vUv;
in float vWave;

out vec4 fragColor;

void main() {
  float crest = smoothstep(0.0, 0.08, vWave);
  vec3 col = mix(waterColor, foamColor, crest * 0.45);
  float shimmer = 0.04 * sin(vUv.x * 40.0 + vUv.y * 30.0);
  col += shimmer;
  fragColor = vec4(col, opacity);
}
`;

const VERT_PRO = /* glsl */ `
out vec2 vUv;
out vec3 vWorldPos;
out vec3 vNormal;

uniform float time;
uniform float waveScale;
uniform float waveSpeed;
uniform float waveHeight;
uniform int waveCount;

vec3 gerstner(vec2 xz, float amp, float freq, vec2 dir, float speed, float steep) {
  float phase = dot(dir, xz) * freq + time * speed;
  float sinP = sin(phase);
  float cosP = cos(phase);
  float q = steep / max(freq * amp * 6.0, 0.001);
  return vec3(
    q * amp * dir.x * cosP,
    amp * sinP,
    q * amp * dir.y * cosP
  );
}

void main() {
  vUv = uv;
  vec3 pos = position;
  vec2 horiz = pos.xy;

  vec3 disp = vec3(0.0);
  if (waveCount > 0) {
    disp += gerstner(horiz, waveHeight, waveScale, normalize(vec2(1.0, 0.35)), waveSpeed, 0.45);
  }
  if (waveCount > 1) {
    disp += gerstner(horiz, waveHeight * 0.65, waveScale * 1.35, normalize(vec2(-0.25, 1.0)), waveSpeed * 0.85, 0.35);
  }
  if (waveCount > 2) {
    disp += gerstner(horiz, waveHeight * 0.4, waveScale * 2.1, normalize(vec2(0.7, -0.5)), waveSpeed * 1.15, 0.25);
  }
  if (waveCount > 3) {
    disp += gerstner(horiz, waveHeight * 0.22, waveScale * 3.2, normalize(vec2(-0.6, -0.8)), waveSpeed * 0.65, 0.18);
  }

  pos.x += disp.x;
  pos.y += disp.z;
  pos.z += disp.y;
  vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;

  float eps = 0.35;
  vec3 dispC = vec3(0.0);
  vec3 dispX = vec3(0.0);
  vec3 dispY = vec3(0.0);
  if (waveCount > 0) {
    dispC += gerstner(horiz, waveHeight, waveScale, normalize(vec2(1.0, 0.35)), waveSpeed, 0.45);
    dispX += gerstner(horiz + vec2(eps, 0.0), waveHeight, waveScale, normalize(vec2(1.0, 0.35)), waveSpeed, 0.45);
    dispY += gerstner(horiz + vec2(0.0, eps), waveHeight, waveScale, normalize(vec2(1.0, 0.35)), waveSpeed, 0.45);
  }
  if (waveCount > 1) {
    dispC += gerstner(horiz, waveHeight * 0.65, waveScale * 1.35, normalize(vec2(-0.25, 1.0)), waveSpeed * 0.85, 0.35);
    dispX += gerstner(horiz + vec2(eps, 0.0), waveHeight * 0.65, waveScale * 1.35, normalize(vec2(-0.25, 1.0)), waveSpeed * 0.85, 0.35);
    dispY += gerstner(horiz + vec2(0.0, eps), waveHeight * 0.65, waveScale * 1.35, normalize(vec2(-0.25, 1.0)), waveSpeed * 0.85, 0.35);
  }
  if (waveCount > 2) {
    dispC += gerstner(horiz, waveHeight * 0.4, waveScale * 2.1, normalize(vec2(0.7, -0.5)), waveSpeed * 1.15, 0.25);
    dispX += gerstner(horiz + vec2(eps, 0.0), waveHeight * 0.4, waveScale * 2.1, normalize(vec2(0.7, -0.5)), waveSpeed * 1.15, 0.25);
    dispY += gerstner(horiz + vec2(0.0, eps), waveHeight * 0.4, waveScale * 2.1, normalize(vec2(0.7, -0.5)), waveSpeed * 1.15, 0.25);
  }
  if (waveCount > 3) {
    dispC += gerstner(horiz, waveHeight * 0.22, waveScale * 3.2, normalize(vec2(-0.6, -0.8)), waveSpeed * 0.65, 0.18);
    dispX += gerstner(horiz + vec2(eps, 0.0), waveHeight * 0.22, waveScale * 3.2, normalize(vec2(-0.6, -0.8)), waveSpeed * 0.65, 0.18);
    dispY += gerstner(horiz + vec2(0.0, eps), waveHeight * 0.22, waveScale * 3.2, normalize(vec2(-0.6, -0.8)), waveSpeed * 0.65, 0.18);
  }

  vec3 tangentX = vec3(eps, dispX.z - dispC.z, dispX.y - dispC.y);
  vec3 tangentY = vec3(dispY.z - dispC.z, eps, dispY.y - dispC.y);
  vNormal = normalize(cross(tangentY, tangentX));

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const FRAG_PRO = /* glsl */ `
uniform vec3 waterColor;
uniform vec3 foamColor;
uniform vec3 sunColor;
uniform vec3 sunDirection;
uniform vec3 horizonColor;
uniform vec3 zenithColor;
uniform float opacity;
uniform float time;
uniform float distortionScale;
uniform float fresnelStrength;
uniform float specularPower;
uniform int normalDetail;
uniform float hasMirror;
uniform float waterSize;

uniform sampler2D mirrorSampler;
uniform mat4 textureMatrix;
uniform vec3 eye;

in vec2 vUv;
in vec3 vWorldPos;
in vec3 vNormal;

out vec4 fragColor;

vec3 proceduralNormal(vec2 xz, float t, int detail) {
  vec3 n = vNormal;
  if (detail < 1) {
    return normalize(n);
  }
  float f1 = sin(xz.x * 0.45 + t * 0.7) * cos(xz.y * 0.38 - t * 0.55);
  float f2 = sin(xz.x * 1.2 - t * 0.35) * sin(xz.y * 0.95 + t * 0.42);
  vec3 bump = vec3(f1 + f2 * 0.5, 0.0, f2 - f1 * 0.35) * 0.18;
  if (detail > 2) {
    float f3 = sin(xz.x * 2.8 + t) * cos(xz.y * 2.5 - t * 0.8);
    bump += vec3(f3, 0.0, -f3 * 0.6) * 0.08;
  }
  if (detail > 3) {
    float f4 = sin(dot(xz, vec2(0.07, 0.05)) * 18.0 + t * 1.6);
    bump += vec3(f4 * 0.4, 0.0, f4 * 0.25) * 0.05;
  }
  return normalize(n + bump);
}

vec3 sampleFakeSky(vec3 reflectDir) {
  float up = clamp(reflectDir.y * 0.5 + 0.5, 0.0, 1.0);
  return mix(horizonColor, zenithColor, pow(up, 0.75));
}

void main() {
  vec3 worldNormal = proceduralNormal(vWorldPos.xz * waterSize, time, normalDetail);
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 lightDir = normalize(sunDirection);

  float ndotl = max(dot(worldNormal, lightDir), 0.0);
  float fresnel = fresnelStrength * pow(1.0 - max(dot(viewDir, worldNormal), 0.0), 3.5);
  vec3 reflectDir = reflect(-viewDir, worldNormal);

  vec3 reflection = sampleFakeSky(reflectDir);
  if (hasMirror > 0.5) {
    vec4 mirrorCoord = textureMatrix * vec4(vWorldPos, 1.0);
    vec2 uv = mirrorCoord.xy / max(mirrorCoord.w, 0.0001);
    vec2 distortion = worldNormal.xz * distortionScale * 0.0015;
    vec3 mirrorSample = texture(mirrorSampler, uv + distortion).rgb;
    reflection = mix(reflection, mirrorSample, 0.92);
  }

  vec3 scatter = waterColor * (0.35 + ndotl * 0.45);
  vec3 spec = sunColor * pow(max(dot(reflectDir, lightDir), 0.0), specularPower) * 0.85;

  float crest = smoothstep(0.02, 0.22, worldNormal.y - vNormal.y + 0.08);
  vec3 foam = mix(scatter, foamColor, crest * 0.35);

  vec3 base = mix(foam, reflection, fresnel);
  vec3 col = base + spec + sunColor * ndotl * 0.12;

  fragColor = vec4(col, opacity);
}
`;

/**
 * @param {Record<string, unknown>} uniforms
 * @returns {THREE.ShaderMaterial}
 */
function createOceanMaterialLow(uniforms = {}) {
  const waterColor = new THREE.Color(
    typeof uniforms.waterColor === "string" ? uniforms.waterColor : "#0a3d62"
  );
  const foamColor = new THREE.Color(
    typeof uniforms.foamColor === "string" ? uniforms.foamColor : "#74b9ff"
  );
  const opacity = Number.isFinite(Number(uniforms.opacity)) ? Number(uniforms.opacity) : 0.92;
  const waveScale = Number.isFinite(Number(uniforms.waveScale)) ? Number(uniforms.waveScale) : 0.35;
  const waveSpeed = Number.isFinite(Number(uniforms.waveSpeed)) ? Number(uniforms.waveSpeed) : 1.2;
  const waveHeight = Number.isFinite(Number(uniforms.waveHeight)) ? Number(uniforms.waveHeight) : 0.35;
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      waterColor: { value: waterColor },
      foamColor: { value: foamColor },
      opacity: { value: opacity },
      waveScale: { value: waveScale },
      waveSpeed: { value: waveSpeed },
      waveHeight: { value: waveHeight },
      time: { value: 0 },
      deltaTime: { value: 0 },
      globalTime: { value: 0 }
    },
    vertexShader: VERT_LOW,
    fragmentShader: FRAG_LOW,
    transparent: opacity < 1,
    depthWrite: opacity >= 1,
    side: THREE.DoubleSide
  });
}

/**
 * @param {Record<string, unknown>} uniforms
 * @param {object} profile
 * @returns {THREE.ShaderMaterial}
 */
function createOceanMaterialPro(uniforms = {}, profile) {
  const waterColor = new THREE.Color(
    typeof uniforms.waterColor === "string" ? uniforms.waterColor : "#0a3d62"
  );
  const foamColor = new THREE.Color(
    typeof uniforms.foamColor === "string" ? uniforms.foamColor : "#a8dadc"
  );
  const sunColor = new THREE.Color(
    typeof uniforms.sunColor === "string" ? uniforms.sunColor : "#fff4e0"
  );
  const horizonColor = new THREE.Color(
    typeof uniforms.horizonColor === "string" ? uniforms.horizonColor : "#5dade2"
  );
  const zenithColor = new THREE.Color(
    typeof uniforms.zenithColor === "string" ? uniforms.zenithColor : "#1a5276"
  );
  const sunDirection = Array.isArray(uniforms.sunDirection)
    ? new THREE.Vector3(...uniforms.sunDirection.map(Number))
    : new THREE.Vector3(0.45, 0.82, 0.35);
  sunDirection.normalize();

  const opacity = Number.isFinite(Number(uniforms.opacity)) ? Number(uniforms.opacity) : 0.94;
  const waveScale = Number.isFinite(Number(uniforms.waveScale)) ? Number(uniforms.waveScale) : 0.28;
  const waveSpeed = Number.isFinite(Number(uniforms.waveSpeed)) ? Number(uniforms.waveSpeed) : 1.2;
  const waveHeight = Number.isFinite(Number(uniforms.waveHeight)) ? Number(uniforms.waveHeight) : 0.38;
  const distortionScale = Number.isFinite(Number(uniforms.distortionScale))
    ? Number(uniforms.distortionScale)
    : profile.distortionScale;
  const fresnelStrength = Number.isFinite(Number(uniforms.fresnelStrength))
    ? Number(uniforms.fresnelStrength)
    : profile.fresnelStrength;
  const specularPower = Number.isFinite(Number(uniforms.specularPower))
    ? Number(uniforms.specularPower)
    : profile.specularPower;
  const waterSize = Number.isFinite(Number(uniforms.waterSize)) ? Number(uniforms.waterSize) : 0.015;

  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      waterColor: { value: waterColor },
      foamColor: { value: foamColor },
      sunColor: { value: sunColor },
      sunDirection: { value: sunDirection },
      horizonColor: { value: horizonColor },
      zenithColor: { value: zenithColor },
      opacity: { value: opacity },
      waveScale: { value: waveScale },
      waveSpeed: { value: waveSpeed },
      waveHeight: { value: waveHeight },
      time: { value: 0 },
      deltaTime: { value: 0 },
      globalTime: { value: 0 },
      waveCount: { value: profile.waveLayers },
      normalDetail: { value: profile.normalOctaves },
      distortionScale: { value: distortionScale },
      fresnelStrength: { value: fresnelStrength },
      specularPower: { value: specularPower },
      waterSize: { value: waterSize },
      hasMirror: { value: profile.useMirror ? 1 : 0 },
      mirrorSampler: { value: null },
      textureMatrix: { value: new THREE.Matrix4() },
      eye: { value: new THREE.Vector3() }
    },
    vertexShader: VERT_PRO,
    fragmentShader: FRAG_PRO,
    transparent: opacity < 1,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  material.userData.waterQualityTier = profile.tier;
  material.userData.waterUseMirror = profile.useMirror;
  material.userData.waterMirrorResolution = profile.mirrorResolution;
  return material;
}

/**
 * @param {Record<string, unknown>} uniforms
 * @returns {THREE.ShaderMaterial}
 */
function createOceanMaterial(uniforms = {}) {
  const { profile } = parseWaterQuality({ uniforms, quality: uniforms.quality });
  if (profile.tier <= WATER_QUALITY_TIER.low) {
    return createOceanMaterialLow(uniforms);
  }
  return createOceanMaterialPro(uniforms, profile);
}

export function registerOceanShaderPresets() {
  registerShaderPreset("ocean", {
    schema: {
      quality: "string",
      waterColor: "color",
      foamColor: "color",
      sunColor: "color",
      horizonColor: "color",
      zenithColor: "color",
      sunDirection: "vec3",
      opacity: "number",
      waveScale: "number",
      waveSpeed: "number",
      waveHeight: "number",
      distortionScale: "number",
      fresnelStrength: "number",
      specularPower: "number",
      waterSize: "number",
      mirrorResolution: "number"
    },
    defaultUniforms: {
      quality: "medium",
      waterColor: "#0a3d62",
      foamColor: "#a8dadc",
      sunColor: "#fff4e0",
      horizonColor: "#5dade2",
      zenithColor: "#1a5276",
      sunDirection: [0.45, 0.82, 0.35],
      opacity: 0.94,
      waveScale: 0.28,
      waveSpeed: 1.2,
      waveHeight: 0.38,
      distortionScale: 2.4,
      fresnelStrength: 0.55,
      specularPower: 96,
      waterSize: 0.015,
      mirrorResolution: 512
    },
    createMaterial: createOceanMaterial,
    updateUniforms(material, ctx) {
      if (material.uniforms.waveSpeed && Number.isFinite(Number(ctx?.descriptorWaveSpeed))) {
        material.uniforms.waveSpeed.value = Number(ctx.descriptorWaveSpeed);
      }
    },
    dispose(material) {
      material?.userData?.waterMirrorDispose?.();
    }
  });
}

export { createOceanMaterial, createOceanMaterialLow, createOceanMaterialPro };

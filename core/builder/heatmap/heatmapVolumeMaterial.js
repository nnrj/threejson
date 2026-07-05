/**
 * Volume heatmap material: ray-AABB intersection in local box space, step along ray sampling sampler3D.
 * Pairs with BoxGeometry(width, height, depth) (local -half..+half).
 */

/** Under WebGL2, three prefixes ShaderMaterial with #version, precision, uniform mat4 …, attribute/in position. Do not redeclare. */
const VERT = /* glsl */ `
out vec3 vWorldPos;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp sampler3D;

uniform highp sampler3D mapVol;
uniform mat4 volumeInverseWorld;
uniform float steps;
uniform float alphaGain;
uniform float globalOpacity;
uniform vec3 halfSize;
uniform vec3 heatmapCamWorld;

in vec3 vWorldPos;

out vec4 fragColor;

vec2 hitSlab(vec3 origin, vec3 dir, vec3 bmin, vec3 bmax) {
  vec3 invDir = 1.0 / (dir + vec3(1e-20));
  vec3 t0 = (bmin - origin) * invDir;
  vec3 t1 = (bmax - origin) * invDir;
  vec3 tsmall = min(t0, t1);
  vec3 tbig = max(t0, t1);
  float tMin = max(max(tsmall.x, tsmall.y), tsmall.z);
  float tMax = min(min(tbig.x, tbig.y), tbig.z);
  return vec2(tMin, tMax);
}

void main() {
  vec3 worldDir = normalize(vWorldPos - heatmapCamWorld);

  vec3 rayOriginLoc = (volumeInverseWorld * vec4(heatmapCamWorld, 1.0)).xyz;
  vec3 rayDirLoc = normalize((volumeInverseWorld * vec4(worldDir, 0.0)).xyz);

  vec3 bmin = -halfSize;
  vec3 bmax = halfSize;

  vec2 tt = hitSlab(rayOriginLoc, rayDirLoc, bmin, bmax);
  float tNear = max(tt.x, 0.0);
  float tFar = min(tt.y, 1e12);

  if (tFar <= tNear) {
    discard;
  }

  float nStepsF = clamp(steps, 4.0, 256.0);
  int iMax = int(nStepsF);
  float segLen = (tFar - tNear) / nStepsF;
  float t = tNear + segLen * 0.5;

  float accA = 0.0;
  vec3 rgbAcc = vec3(0.0);

  for (int i = 0; i < 256; i++) {
    if (i >= iMax || accA > 0.97) break;

    vec3 pos = rayOriginLoc + rayDirLoc * t;
    vec3 uvw = (pos + halfSize) / (halfSize * 2.0);

    if (uvw.x >= 0.0 && uvw.x <= 1.0 && uvw.y >= 0.0 && uvw.y <= 1.0 && uvw.z >= 0.0 && uvw.z <= 1.0) {
      vec4 c = texture(mapVol, uvw);
      float dens = max(c.r, max(c.g, c.b));
      if (dens > 0.002) {
        float a = 1.0 - exp(-dens * alphaGain * globalOpacity * segLen * 14.0);
        a = clamp(a, 0.0, 1.0);
        rgbAcc += (1.0 - accA) * a * c.rgb;
        accA += (1.0 - accA) * a;
      }
    }

    t += segLen;
  }

  if (accA < 0.001) {
    discard;
  }

  fragColor = vec4(rgbAcc, accA);
}
`;

/**
 * @param {typeof import('three')} THREE
 * @param {import('three').Data3DTexture} map3d
 * @param {{ width: number, height: number, depth: number }} boxSize Full BoxGeometry size (world units)
 * @param {object} [opts]
 * @param {number} [opts.steps=96]
 * @param {number} [opts.alphaGain=1]
 * @param {number} [opts.opacity=1]
 * @param {number} [opts.side]
 * @param {boolean} [opts.depthWrite=false]
 * @param {boolean} [opts.transparent=true]
 */
export function createHeatmapVolumeMaterial(THREE, map3d, boxSize, opts = {}) {
    const steps = Math.max(4, Math.min(256, opts.steps ?? 96));
    const alphaGain = opts.alphaGain != null ? opts.alphaGain : 1;
    const opacity = opts.opacity != null ? opts.opacity : 1;
    const side = opts.side != null ? opts.side : THREE.DoubleSide;

    const transparent = opts.transparent !== false;
    const mat = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: {
            mapVol: { value: map3d },
            volumeInverseWorld: { value: new THREE.Matrix4() },
            heatmapCamWorld: { value: new THREE.Vector3() },
            steps: { value: steps },
            alphaGain: { value: alphaGain },
            globalOpacity: { value: opacity },
            halfSize: {
                value: new THREE.Vector3(
                    Number(boxSize.width) * 0.5,
                    Number(boxSize.height) * 0.5,
                    Number(boxSize.depth) * 0.5
                )
            }
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent,
        depthWrite: opts.depthWrite === true,
        side
    });
    if (transparent && side === THREE.DoubleSide) {
        mat.forceSinglePass = true;
    }
    return mat;
}

/**
 * Refresh volume ray transform each frame (call after mesh.updateMatrixWorld).
 * @param {import('three').ShaderMaterial} material
 * @param {import('three').Mesh} mesh
 */
export function updateHeatmapVolumeUniforms(material, mesh, camera) {
    const inv = material.uniforms.volumeInverseWorld?.value;
    if (inv) {
        _invMatCopyFromMeshWorld(mesh.matrixWorld, inv);
    }
    const cp = material.uniforms.heatmapCamWorld?.value;
    if (cp && camera?.getWorldPosition) {
        camera.getWorldPosition(cp);
    }
}

function _invMatCopyFromMeshWorld(matrixWorld, invTarget) {
    invTarget.copy(matrixWorld).invert();
}

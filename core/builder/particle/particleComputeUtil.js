/**
 * Particle V2 WebGL-compute layout utilities (no Three.js side effects).
 */

/**
 * @param {number} count
 * @param {object} [compute]
 * @returns {{ width: number, height: number }}
 */
export function resolveParticleTextureSize(count, compute = {}) {
  const explicitWidth = Number(compute.textureWidth ?? compute.width);
  const explicitHeight = Number(compute.textureHeight ?? compute.height);
  if (Number.isFinite(explicitWidth) && explicitWidth > 0 && Number.isFinite(explicitHeight) && explicitHeight > 0) {
    return {
      width: Math.floor(explicitWidth),
      height: Math.floor(explicitHeight)
    };
  }
  const textureSize = Number(compute.textureSize);
  if (Number.isFinite(textureSize) && textureSize > 0) {
    const side = Math.max(2, Math.floor(textureSize));
    return { width: side, height: side };
  }
  const side = Math.max(2, Math.ceil(Math.sqrt(Math.max(count, 1))));
  const pow2 = 2 ** Math.ceil(Math.log2(side));
  return { width: pow2, height: pow2 };
}

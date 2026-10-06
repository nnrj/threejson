/** Author-facing render paths address runtime material state, never the saved
 * Particle V2 descriptor. A global opacity multiplies the per-particle curve.
 * Share the same value with ordinary material.opacity tracks and shader reads.
 */
export function bindParticleRenderState(object, descriptor) {
  const material = object.material;
  material.opacity = descriptor.render.opacity;
  Object.defineProperty(object, "render", { value: material, configurable: true });
  if (material.isShaderMaterial) {
    material.uniforms.opacity = {
      get value() { return material.opacity; },
      set value(value) { material.opacity = value; }
    };
  }
  return object;
}

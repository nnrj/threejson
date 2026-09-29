// Texture-local hooks avoid global timers/registries and keep codecs out of core.
const controllers = new WeakMap();
export function registerMediaTextureTimeline(texture, controller) {
  controllers.set(texture, controller);
  texture.addEventListener("dispose", () => { controller.dispose?.(); controllers.delete(texture); });
  return texture;
}
export function getSceneMediaTextureControllers(scene) {
  const found = new Set();
  const visit = (value) => { const controller = value?.isTexture && controllers.get(value); if (controller) found.add(controller); };
  scene.traverse((object) => {
    for (const material of [].concat(object.material || [])) {
      Object.values(material).forEach(visit);
      Object.values(material.uniforms || {}).forEach((uniform) => visit(uniform.value));
    }
  });
  visit(scene.background); visit(scene.environment);
  return [...found];
}

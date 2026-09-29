import { requestTexture, whenTextureReady } from "../../resource/textureRequest.js";
import { trackDisposableResource } from "../../handler/trackedResourceRegistry.js";

/** A pending sprite stays visible to resource barriers without showing a black placeholder. */
export function bindParticleSpriteResource(points, source, runtimeScope) {
  if (typeof source !== "string" || !source.trim()) return;
  const material = points.material, texture = requestTexture(source, { runtimeScope });
  trackDisposableResource(texture);
  material.uniforms.spriteMap.value = texture;
  let disposed = false;
  const release = () => { disposed = true; texture.dispose(); };
  material.addEventListener("dispose", release);
  whenTextureReady(texture).then(() => {
    if (!disposed) material.uniforms.useSpriteMap.value = true;
  }).catch(() => { /* Resource diagnostics retain the error; ordinary scenes keep untextured dots. */ });
}

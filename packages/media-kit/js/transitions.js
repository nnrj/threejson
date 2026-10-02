const clamp = value => Math.max(0, Math.min(1, value));
export function transitionProgress(clip) {
  return clip.transitionIn ? clamp(clip.localTime / clip.transitionIn.duration) : 1;
}
export function transitionNoise(index, seed = 1) {
  let x = Math.imul(index + 1, 374761393) ^ (seed | 0); x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967295;
}
/** Optional 2D compositor workspaces: no extra WebGL context or decoder. */
export function createMediaTransitions(makeCanvas, width, height) {
  let layer, mask, maskContext, pixels, field, seed;
  function prepare() {
    if (!layer) { layer = makeCanvas(); layer.width = width; layer.height = height; }
    return layer;
  }
  return {
    layer() { return prepare(); },
    draw(context, source, clip) {
      const progress = transitionProgress(clip), transition = clip.transitionIn;
      if (progress <= 0) return;
      if (!transition || progress >= 1) { context.drawImage(source, 0, 0, width, height); return; }
      if (transition.type === "wipe") {
        context.save(); context.beginPath();
        if (transition.direction === "right") context.rect(width * (1 - progress), 0, width * progress, height);
        else if (transition.direction === "up") context.rect(0, height * (1 - progress), width, height * progress);
        else if (transition.direction === "down") context.rect(0, 0, width, height * progress);
        else context.rect(0, 0, width * progress, height);
        context.clip(); context.drawImage(source, 0, 0, width, height); context.restore(); return;
      }
      if (!mask) { mask = makeCanvas(); mask.width = width; mask.height = height; maskContext = mask.getContext("2d"); pixels = maskContext.createImageData(width, height); field = new Float32Array(width * height); }
      if (seed !== (transition.seed ?? 1)) { seed = transition.seed ?? 1; for (let i = 0; i < field.length; i++) field[i] = transitionNoise(i, seed); }
      const softness = transition.softness ?? .08;
      for (let i = 0; i < field.length; i++) {
        const a = softness ? clamp((progress * (1 + softness) - field[i]) / softness) : progress >= field[i] ? 1 : 0;
        pixels.data[i * 4 + 3] = Math.round(a * a * (3 - 2 * a) * 255);
      }
      maskContext.putImageData(pixels, 0, 0);
      const ctx = prepare().getContext("2d");
      // source is already the layer containing scene + captions.
      ctx.save(); ctx.globalCompositeOperation = "destination-in"; ctx.drawImage(mask, 0, 0); ctx.restore();
      context.drawImage(layer, 0, 0, width, height);
    },
    dispose() { if (layer) layer.width = layer.height = 1; if (mask) mask.width = mask.height = 1; layer = mask = maskContext = pixels = field = null; }
  };
}

import { attachSceneTimeline, getActiveClips, getTimelineDuration } from "threejson/timeline";
import { openMediaDocument } from "./documents.js";

const makeCanvas = (options) => options.createCanvas?.() || globalThis.document?.createElement("canvas");
const dimensions = (value, label) => { if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive integer.`); return value; };

/** One deterministic frame producer shared by still, GIF and video output. */
export async function createMediaProject(input, options = {}) {
  const source = await openMediaDocument(input, options), document = source.document;
  const width = dimensions(options.width ?? document.output?.width ?? 1920, "width"), height = dimensions(options.height ?? document.output?.height ?? 1080, "height");
  const canvas = options.canvas || makeCanvas(options);
  if (!canvas) { source.dispose(); throw new Error("A canvas or browser canvas factory is required."); }
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d", { alpha: options.alpha === true, willReadFrequently: options.readPixels === true });
  if (!context) { source.dispose(); throw new Error("Canvas 2D compositor is unavailable."); }
  const timeline = document.timeline || {}, composition = document.documentType === "composition";
  const duration = options.duration ?? options.end ?? getTimelineDuration(timeline);
  const instances = new Map(), sceneCache = new Map(), renderers = new Map();
  let disposed = false;
  async function sceneFor(clip) {
    const key = typeof clip.source === "string" ? clip.source : clip.id;
    if (!sceneCache.has(key)) sceneCache.set(key, composition ? await source.loadScene(clip.source) : document);
    return sceneCache.get(key);
  }
  async function instantiate(clip) {
    const scene = await sceneFor(clip);
    if (scene.documentType === "composition") throw new Error("Nested composition needs flattening before playback; use scene clips.");
    const owner = source.ownerOf(scene), descriptor = await owner.materialize(scene);
    // Legacy scene audio may be triggered by load events/autoplay. Offline output
    // has a single explicit mixer; never let a hidden renderer play to speakers.
    const mute = (value) => { if (!value || typeof value !== "object") return; if (value.objType === "audio" || value.audioType) value.autoplay = false; if (Array.isArray(value.audioList)) value.audioList.forEach((item) => { item.autoplay = false; }); for (const child of Object.values(value)) if (typeof child === "object") mute(child); };
    mute(descriptor);
    const backend = descriptor.sceneConfig?.renderer?.backend || "webgl";
    const poolKey = JSON.stringify({ renderer: descriptor.sceneConfig?.renderer || {}, backend });
    const pooled = renderers.get(poolKey);
    const sceneCanvas = pooled?.domElement || makeCanvas(options);
    sceneCanvas.width = width; sceneCanvas.height = height;
    descriptor.sceneConfig ??= {};
    if (options.alpha === true) descriptor.sceneConfig.renderer = { ...descriptor.sceneConfig.renderer, alpha: true };
    descriptor.sceneConfig.controls = { enabled: false, type: "none" };
    descriptor.sceneConfig.renderLoop = { ...descriptor.sceneConfig.renderLoop, autoResize: false, firstAutoResize: false, autoStart: false, updateAnimations: false };
    descriptor.sceneConfig.intro = { enabled: false };
    const factory = options.createScene || (await import("threejson/runtime")).createJsonScene;
    const runtime = await factory(descriptor, {
      ...options.runtimeOptions, canvas: sceneCanvas, viewportSize: { width, height }, timeline: false,
      audioPlaybackPolicy: { paused: true, masterVolume: 0 },
      renderer: backend === "webgl" ? pooled : undefined, ownsRenderer: !pooled || backend !== "webgl",
      resolveResourceUrl: owner.resolveAsset,
      assetsBase: owner.baseUrl ? new URL(".", owner.baseUrl).href : undefined
    });
    try {
    options.signal?.throwIfAborted();
    if (disposed) throw new DOMException("Media project has been disposed.", "AbortError");
    runtime.stop?.();
    if (runtime.runtimeContext) runtime.runtimeContext.resolveAssetUrl = owner.resolveAsset;
    runtime.renderer.setPixelRatio(1); runtime.renderer.setSize(width, height, false);
    runtime.composer?.setPixelRatio?.(1); runtime.composer?.setSize?.(width, height);
    await attachSceneTimeline(runtime, { ...scene.timeline, duration: Math.max(scene.timeline?.duration || 0, (clip.sourceStart || 0) + clip.duration * (clip.rate ?? 1)) }, { autoPlay: false, signal: options.signal });
    options.signal?.throwIfAborted();
    if (disposed) throw new DOMException("Media project has been disposed.", "AbortError");
    if (runtime.setRendererOwnership) {
      runtime.setRendererOwnership(false);
      if (!pooled || backend !== "webgl") renderers.set(backend === "webgl" ? poolKey : clip.id, runtime.renderer);
    }
    const result = { runtime, scene };
    instances.set(clip.id, result);
    return result;
    } catch (error) { runtime.dispose(); throw error; }
  }
  const drawCaptions = (items, time, authoredOutput = document.output) => {
    for (const item of items || []) if (item.enabled !== false && time >= (item.start || 0) && time < (item.start || 0) + (item.duration ?? duration)) {
      const scale = height / (authoredOutput?.height || 1080), fontSize = item.fontSize ? item.fontSize * scale : height * .04;
      context.save(); context.font = `${fontSize}px ${item.fontFamily || "sans-serif"}`;
      context.textAlign = item.align || "center"; context.textBaseline = "middle";
      context.fillStyle = item.color || "#ffffff"; context.strokeStyle = item.outlineColor || "#000000"; context.lineWidth = (item.outlineWidth ?? 3) * scale;
      const lines = String(item.text || "").split("\n"), lineHeight = fontSize * 1.3;
      for (let i = 0; i < lines.length; i++) { const x = (item.x ?? .5) * width, y = (item.y ?? .9) * height + (i - (lines.length - 1)/2)*lineHeight; if (context.lineWidth) context.strokeText(lines[i], x, y, width * .94); context.fillText(lines[i], x, y, width * .94); }
      context.restore();
    }
  };
  const api = {
    canvas, document, duration, width, height, resolveAsset: source.resolveAsset,
    async renderAt(time) {
      if (disposed) throw new Error("Media project has been disposed.");
      options.signal?.throwIfAborted();
      if (!Number.isFinite(time) || time < 0) throw new RangeError("Render time must be finite and nonnegative.");
      const clips = composition ? getActiveClips(timeline, time) : [{ id: "$scene", source: document, sourceTime: time, duration: Math.max(duration, time), opacity: 1 }];
      const active = new Set(clips.map((clip) => clip.id));
      for (const [id, instance] of instances) if (!active.has(id)) { instance.runtime.dispose(); instances.delete(id); }
      context.clearRect(0, 0, width, height);
      if (options.alpha !== true) { context.fillStyle = document.output?.background || "#000000"; context.fillRect(0, 0, width, height); }
      for (const clip of clips) {
        const instance = instances.get(clip.id) || await instantiate(clip);
        await instance.runtime.timeline.renderAt(clip.sourceTime);
        options.signal?.throwIfAborted();
        if (instance.runtime.renderer.getContext?.().isContextLost?.()) throw Object.assign(new Error("Rendering context was lost."), { code: "MEDIA_CONTEXT_LOST" });
        context.save(); context.globalAlpha = clip.opacity;
        context.drawImage(instance.runtime.renderer.domElement, 0, 0, width, height);
        drawCaptions(instance.scene.timeline?.captions, clip.sourceTime, instance.scene.output);
        context.restore();
      }
      if (composition) drawCaptions(timeline.captions, time);
      // Reuse compatible renderers across adjacent clips, but do not retain one
      // GPU context per distinct historical configuration for the entire film.
      const usedRenderers = new Set([...instances.values()].map(instance => instance.runtime.renderer));
      for (const [key, renderer] of renderers) if (!usedRenderers.has(renderer)) {
        renderer.dispose(); renderer.forceContextLoss?.(); renderers.delete(key);
      }
      return canvas;
    },
    async getAudioClips() {
      const clips = [...(timeline.audio || []), ...(options.audioClips || [])].filter((clip) => clip.enabled !== false).map((clip) => ({ ...clip }));
      if (composition) for (const clip of timeline.clips || []) {
        if (clip.enabled === false) continue;
        const scene = await sceneFor(clip), rate = clip.rate ?? 1, sourceStart = clip.sourceStart || 0;
        for (const audio of scene.timeline?.audio || []) {
          if (audio.enabled === false) continue;
          const sourceEnd = sourceStart + clip.duration * rate;
          const audioStart = audio.start || 0, audioEnd = audio.duration === undefined ? sourceEnd : audioStart + audio.duration;
          const begin = Math.max(sourceStart, audioStart), end = Math.min(sourceEnd, audioEnd);
          if (end > begin) clips.push({ ...audio, url: audio.url ? await source.ownerOf(scene).resolveAsset(audio.url) : undefined, id: `${clip.id}/${audio.id}`, start: (clip.start || 0) + (begin-sourceStart)/rate, duration: (end-begin)/rate, sourceStart: (audio.sourceStart || 0)+(begin-audioStart)*(audio.rate??1), rate: rate*(audio.rate??1), fadeIn: (audio.fadeIn || 0)/rate, fadeOut: (audio.fadeOut || 0)/rate });
        }
      }
      return clips;
    },
    dispose() {
      if (disposed) return; disposed = true;
      for (const instance of instances.values()) instance.runtime.dispose(); instances.clear();
      for (const renderer of new Set(renderers.values())) { renderer.dispose(); renderer.forceContextLoss?.(); } renderers.clear();
      source.dispose(); sceneCache.clear();
    }
  };
  return api;
}

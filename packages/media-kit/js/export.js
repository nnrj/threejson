import { createMediaProject } from "./project.js";

const abort = (options) => options.signal?.throwIfAborted();
const yieldTask = () => new Promise((resolve) => setTimeout(resolve, 0));
export function resolveFrameRange(project, options = {}) {
  const start = options.start ?? 0, end = options.end ?? project.duration, fps = options.fps ?? project.document.output?.fps ?? 30;
  if (!(Number.isFinite(start) && start >= 0 && Number.isFinite(end) && end > start && Number.isFinite(fps) && fps > 0)) throw new RangeError("Specify a finite positive duration/end and fps for animated output.");
  const frames = Math.ceil((end-start)*fps);
  if (!Number.isSafeInteger(frames)) throw new RangeError("Frame count exceeds JavaScript's exact integer range.");
  return { start, end, fps, frames, duration: end-start };
}
async function withProject(input, options, run) {
  abort(options);
  const provided = typeof input?.renderAt === "function", project = provided ? input : await createMediaProject(input, options);
  try { return await run(project); } finally { if (!provided) project.dispose(); }
}
export async function renderImage(input, options = {}) {
  return withProject(input, options, async (project) => {
    const type = options.type ?? "image/png";
    if (!["image/png", "image/jpeg", "image/webp"].includes(type)) throw new Error(`Unsupported image MIME: ${type}`);
    await project.renderAt(options.time ?? 0); abort(options);
    const blob = project.canvas.convertToBlob ? await project.canvas.convertToBlob({ type, quality: options.quality }) : await new Promise((resolve, reject) => project.canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Canvas encoding failed (possibly cross-origin pixels).")), type, options.quality));
    if (blob.type !== type) throw Object.assign(new Error(`This browser cannot encode ${type}; received ${blob.type}.`), { code: "MEDIA_CODEC_UNAVAILABLE" });
    return { blob, mimeType: type, width: project.width, height: project.height, time: options.time ?? 0 };
  });
}

export async function getMediaCapabilities(options = {}) {
  const m = options.codecs || await import("mediabunny"), width = options.width ?? 1920, height = options.height ?? 1080;
  const [avc, vp9, aac, opus] = await Promise.all([m.canEncodeVideo("avc", { width, height }), m.canEncodeVideo("vp9", { width, height }), m.canEncodeAudio("aac", { sampleRate: 48000, numberOfChannels: 2 }), m.canEncodeAudio("opus", { sampleRate: 48000, numberOfChannels: 2 })]);
  return { images: ["image/png"], gif: true, video: { mp4: { video: avc, audio: aac }, webm: { video: vp9, audio: opus } }, localSpeech: false, note: "Speech requires an explicitly registered, verified audio producer." };
}

export async function prepareProjectAudio(project, options = {}) {
  const audio = await project.getAudioClips?.() || [];
  if (!audio.length || options.audio === false) return null;
  const kit = await import("@threejson/audio-kit"), cache = new Map();
  const clips = [];
  for (const clip of audio) {
    abort(options);
    const key = clip.url || JSON.stringify(clip.recipe);
    if (!clip.pcm && !clip.recipe && !clip.url) throw new Error(`Audio clip ${clip.id} needs url, pcm or recipe.`);
    let source = clip.pcm ? { pcm: clip.pcm } : cache.get(key);
    if (!source) {
      source = clip.recipe?.kind === "score" && !clip.recipe.producer
        ? { renderer: kit.createScoreRenderer(clip.recipe.score, clip.recipe.options) }
        : { pcm: clip.recipe ? await kit.produceAudio(clip.recipe, options) : await (options.decodeAudio || kit.decodeAudio)(await project.resolveAsset(clip.url), options) };
      cache.set(key, source);
    }
    const sourceDuration = source.renderer?.duration ?? kit.pcmDuration(source.pcm);
    const duration = clip.duration ?? (sourceDuration - (clip.sourceStart || 0)) / (clip.rate ?? 1);
    clips.push({ ...clip, ...source, duration });
  }
  const mixer = kit.createPcmMixer(clips, { sampleRate: options.sampleRate ?? 48000 });
  return { ...mixer, duration: Math.max(...clips.map((clip) => (clip.start || 0) + clip.duration)) };
}

export async function renderVideo(input, options = {}) {
  return withProject(input, options, async (project) => {
    const m = options.codecs || await import("mediabunny"), format = options.format ?? "mp4";
    if (!["mp4", "webm"].includes(format)) throw new Error("Video format must be mp4 or webm.");
    const range = resolveFrameRange(project, options), videoCodec = format === "mp4" ? "avc" : "vp9", audioCodec = format === "mp4" ? "aac" : "opus";
    const hasAudio = options.audio !== false && (await project.getAudioClips?.() || []).length > 0;
    if (!await m.canEncodeVideo(videoCodec, { width: project.width, height: project.height }) || hasAudio && !await m.canEncodeAudio(audioCodec, { sampleRate: options.sampleRate ?? 48000, numberOfChannels: 2 })) throw Object.assign(new Error(`Required ${format} codecs are unavailable. Explicitly select another supported format.`), { code: "MEDIA_CODEC_UNAVAILABLE" });
    const target = options.target || (options.writable ? new m.StreamTarget(options.writable) : new m.BufferTarget());
    const output = new m.Output({ format: format === "mp4" ? new m.Mp4OutputFormat({ fastStart: "reserve" }) : new m.WebMOutputFormat(), target });
    const video = new m.CanvasSource(project.canvas, { codec: videoCodec, bitrate: options.videoBitrate ?? 6_000_000 });
    const sound = hasAudio ? new m.AudioBufferSource({ codec: audioCodec, bitrate: options.audioBitrate ?? 192_000 }) : null;
    output.addVideoTrack(video, { frameRate: range.fps, maximumPacketCount: range.frames + 2 });
    if (sound) output.addAudioTrack(sound, { maximumPacketCount: Math.ceil(range.duration * 200) + 16 });
    let completed = false;
    try {
      const mixer = hasAudio ? await prepareProjectAudio(project, options) : null;
      if (mixer && options.end === undefined && mixer.duration > project.duration + 1e-6 && options.trimAudio !== true) throw new Error("Audio exceeds the timeline duration. Extend the timeline or explicitly set trimAudio/end.");
      await output.start();
      let audioFrame = 0;
      for (let index = 0; index < range.frames; index++) {
        abort(options);
        const time = range.start + index/range.fps, frameDuration = Math.min(1/range.fps, range.end-time);
        await project.renderAt(time); abort(options);
        // Interleave bounded audio blocks with video; await encoder backpressure.
        if (mixer) {
          const endFrame = Math.round(Math.min((index+1)/range.fps, range.duration)*mixer.sampleRate);
          const count = endFrame-audioFrame;
          if (count > 0) {
            const pcm = mixer.render(Math.round(range.start*mixer.sampleRate)+audioFrame, count);
            const buffer = new AudioBuffer({ length: count, sampleRate: mixer.sampleRate, numberOfChannels: pcm.channels.length });
            pcm.channels.forEach((channel,i) => buffer.copyToChannel(channel,i));
            await sound.add(buffer); audioFrame = endFrame;
          }
        }
        await video.add(index/range.fps, frameDuration);
        options.onProgress?.({ stage: "encoding", frame: index+1, frames: range.frames, progress: (index+1)/range.frames, time });
        if (index % 8 === 0) await yieldTask();
      }
      video.close(); sound?.close(); abort(options); await output.finalize(); completed = true;
      const mimeType = format === "mp4" ? "video/mp4" : "video/webm";
      return { blob: target.buffer ? new Blob([target.buffer], { type: mimeType }) : null, mimeType, duration: range.duration, frames: range.frames, width: project.width, height: project.height };
    } finally { if (!completed) await output.cancel().catch(() => {}); }
  });
}

/** GIF is quantized/no-audio. Quantization can be supplied by a worker encoder. */
export async function renderGif(input, options = {}) {
  return withProject(input, { ...options, readPixels: true }, async (project) => {
    const range = resolveFrameRange(project, options);
    if (range.fps > 100) throw new RangeError("GIF uses centisecond delays and cannot represent >100 distinct fps. Use video.");
    const encoder = await (await import("./gifEncoder.js")).createGifEncoder(options), context = project.canvas.getContext("2d", { willReadFrequently: true });
    try {
    for (let index = 0; index < range.frames; index++) {
      abort(options); await project.renderAt(range.start + index/range.fps); abort(options);
      const rgba = context.getImageData(0, 0, project.width, project.height).data;
      const end = Math.min((index+1)/range.fps, range.duration), begin = index/range.fps;
      const delay = Math.max(1, Math.round(end*100)-Math.round(begin*100))*10;
      await encoder.frame(rgba, project.width, project.height, { delay, repeat: options.repeat ?? 0 });
      options.onProgress?.({ stage: "encoding", frame: index+1, frames: range.frames, progress: (index+1)/range.frames });
      await yieldTask();
    }
    return { blob: new Blob([await encoder.finish()], { type: "image/gif" }), mimeType: "image/gif", duration: range.duration, frames: range.frames, audio: false };
    } finally { encoder.dispose(); }
  });
}

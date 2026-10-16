import { createMediaProject } from "./project.js";
import { sampleTimelineTrack } from "threejson/timeline";
import { createOutputTransaction, emptyOutput } from "./outputTransaction.js";
import { laneEnabled } from "./editing.js";

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
  const provided = typeof input?.renderAt === "function";
  if (provided && input.previewPerformance && input.previewPerformance !== "full") throw Object.assign(new Error("Export requires the source document or a full-quality media project, not a reduced preview."), { code: "PREVIEW_PROJECT_NOT_EXPORTABLE" });
  const project = provided ? input : await createMediaProject(input, { ...options, preloadNext: false, previewPerformance: false });
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
  for (const authored of audio) {
    const override = options.audioClipOverrides?.[authored.id];
    const clip = { ...authored };
    for (const key of ["loop", "padSilence"]) if (override?.[key] !== undefined) {
      if (typeof override[key] !== "boolean") throw new TypeError(`Audio override ${key} must be boolean.`);
      clip[key] = override[key];
    }
    abort(options);
    const key = clip.url || JSON.stringify(clip.recipe);
    if (!clip.pcm && !clip.recipe && !clip.url) throw new Error(`Audio clip ${clip.id} needs url, pcm or recipe.`);
    let source = clip.pcm ? { pcm: clip.pcm } : cache.get(key);
    if (!source) {
      source = clip.recipe?.kind === "score" && !clip.recipe.producer
        ? { renderer: kit.createScoreRenderer(clip.recipe.score, clip.recipe.options) }
          : { pcm: clip.recipe ? await kit.produceAudio(clip.recipe, options) : await (options.decodeAudio || kit.decodeAudio)(await project.resolveAsset(clip.url, { kind: "audio" }), options) };
      cache.set(key, source);
    }
    const sourceDuration = source.renderer?.duration ?? kit.pcmDuration(source.pcm);
    const duration = clip.duration ?? (sourceDuration - (clip.sourceStart || 0)) / (clip.rate ?? 1);
    const automation = {};
    for (const property of ["gain", "pan"]) {
      const tracks = (clip.automation?.tracks || []).filter(t => t.property === property);
      if (tracks.length) automation[`${property}At`] = time => {
        const sourceTime = (time - (clip.automation.start || 0)) * (clip.automation.rate ?? 1) + (clip.automation.sourceStart || 0);
        let value = clip[property] ?? (property === "gain" ? 1 : 0);
        for (const track of tracks) value = sampleTimelineTrack(track, sourceTime) ?? value;
        return value;
      };
    }
    for (const track of clip.automation?.tracks || []) if (!["gain", "pan"].includes(track.property)) throw new Error(`Unsupported audio automation: ${track.property}. Use gain or pan.`);
    clips.push({ ...clip, ...source, ...automation, duration });
  }
  const mixer = kit.createPcmMixer(clips, { sampleRate: options.sampleRate ?? 48000 });
  return { ...mixer, duration: Math.max(...clips.map((clip) => (clip.start || 0) + clip.duration)) };
}

const progressNotifier = options => (stage, data = {}) => options.onProgress?.({ stage, frame: 0, frames: 0, progress: 0, ...data });

async function prepareVideoProject(project, options, notify) {
    const m = options.codecs || await import("mediabunny"), format = options.format ?? "mp4";
    if (!["mp4", "webm"].includes(format)) throw new Error("Video format must be mp4 or webm.");
    const range = resolveFrameRange(project, options), videoCodec = format === "mp4" ? "avc" : "vp9", audioCodec = format === "mp4" ? "aac" : "opus";
    const hasAudio = options.audio !== false && (await project.getAudioClips?.() || []).length > 0;
    if (!await m.canEncodeVideo(videoCodec, { width: project.width, height: project.height }) || (hasAudio || options.expectAudio) && !await m.canEncodeAudio(audioCodec, { sampleRate: options.sampleRate ?? 48000, numberOfChannels: 2 })) throw Object.assign(new Error(`Required ${format} codecs are unavailable. Explicitly select another supported format.`), { code: "MEDIA_CODEC_UNAVAILABLE" });
    if ([options.target, options.writable, options.openWritable].filter(Boolean).length > 1) throw new TypeError("Choose only one media output destination.");
    notify("audio", { frames: range.frames });
    const mixer = hasAudio ? await prepareProjectAudio(project, options) : null;
    if (mixer && options.end === undefined && mixer.duration > project.duration + 1e-6 && options.trimAudio !== true) throw new Error("Audio exceeds the timeline duration. Extend the timeline or explicitly set trimAudio/end.");
    // Prepare each included shot before touching the output file. This detects
    // invalid late shots without retaining all their runtimes or encoding minutes
    // of video first. It is an executability check, not visual quality approval.
    const timeline = project.document.timeline || {};
    const times = new Set([range.start]);
    if (project.document.documentType === "composition") for (const clip of timeline.clips || []) {
      const start = clip.start || 0;
      if (laneEnabled(timeline, clip) && start < range.end && start + clip.duration > range.start) times.add(Math.max(range.start, start));
    }
    let checked = 0;
    for (const time of [...times].sort((a, b) => a - b)) {
      abort(options); notify("rendering", { frames: range.frames, time, checked, checks: times.size });
      await project.renderAt(time); abort(options);
      checked++;
    }
    if (times.size > 1) { await project.renderAt(range.start); abort(options); }
    return { m, format, range, videoCodec, audioCodec, hasAudio, mixer, checks: times.size };
}

/** Validate the whole export range before a host starts costly speech or asks
 * for a destination. Opens no output stream and never encodes video. Not a
 * cacheable quality approval: renderVideo rechecks the actual export input. */
export async function preflightMediaExport(input, options = {}) {
  const notify = progressNotifier(options); notify("preparing");
  return withProject(input, options, async project => {
    const { range, checks } = await prepareVideoProject(project, options, notify);
    return { ...range, checks };
  });
}

export async function renderVideo(input, options = {}) {
  const notify = progressNotifier(options);
  notify("preparing");
  let transaction, output, completed = false;
  try { return await withProject(input, options, async (project) => {
    const { m, format, range, videoCodec, audioCodec, hasAudio, mixer } = await prepareVideoProject(project, options, notify);
    // File selection is a host concern. Defer opening/truncating its writable
    // until audio, codecs, and shot resources have passed preflight.
    const writable = options.writable || await options.openWritable?.();
    if (writable) transaction = createOutputTransaction(writable);
    abort(options);
    const target = options.target || (transaction ? new m.StreamTarget(transaction.stream) : new m.BufferTarget());
    output = new m.Output({ format: format === "mp4" ? new m.Mp4OutputFormat({ fastStart: "reserve" }) : new m.WebMOutputFormat(), target });
    const video = new m.CanvasSource(project.canvas, { codec: videoCodec, bitrate: options.videoBitrate ?? 6_000_000 });
    const sound = hasAudio ? new m.AudioBufferSource({ codec: audioCodec, bitrate: options.audioBitrate ?? 192_000 }) : null;
    output.addVideoTrack(video, { frameRate: range.fps, maximumPacketCount: range.frames + 2 });
    if (sound) output.addAudioTrack(sound, { maximumPacketCount: Math.ceil(range.duration * 200) + 16 });
    await output.start();
    let audioFrame = 0;
    for (let index = 0; index < range.frames; index++) {
      abort(options);
      const time = range.start + index/range.fps, frameDuration = Math.min(1/range.fps, range.end-time);
      if (index > 0) await project.renderAt(time); abort(options);
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
    video.close(); sound?.close(); abort(options);
    notify("finalizing", { frame: range.frames, frames: range.frames, progress: 1 });
    await output.finalize(); abort(options);
    const mimeType = format === "mp4" ? "video/mp4" : "video/webm";
    const blob = target.buffer ? new Blob([target.buffer], { type: mimeType }) : null;
    if ((!transaction && !options.target && !blob?.size) || blob?.size === 0) throw emptyOutput();
    if (transaction) {
      notify("saving", { frame: range.frames, frames: range.frames, progress: 1, bytesWritten: transaction.bytesWritten });
      abort(options); await transaction.commit();
    }
    completed = true;
    notify("complete", { frame: range.frames, frames: range.frames, progress: 1, bytesWritten: transaction?.bytesWritten ?? blob?.size });
    return { blob, bytesWritten: transaction?.bytesWritten ?? blob?.size, mimeType, duration: range.duration, frames: range.frames, width: project.width, height: project.height };
  }); } catch (error) {
    if (!completed) {
      await output?.cancel().catch(() => {});
      if (transaction) await transaction.abort(error).catch(() => {});
      else if (options.writable) await options.writable.abort(error).catch(() => {});
    }
    throw error;
  }
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

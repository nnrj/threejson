// Optional browser codecs. No decoder is loaded by ordinary scene playback.
async function openInput(blobOrUrl, options = {}) {
  options.signal?.throwIfAborted();
  const m = options.codecs || await import("mediabunny");
  const input = new m.Input({ source: blobOrUrl instanceof Blob ? new m.BlobSource(blobOrUrl) : new m.UrlSource(blobOrUrl), formats: m.ALL_FORMATS });
  const abort = () => input.dispose();
  options.signal?.addEventListener("abort", abort, { once: true });
  return { m, input, dispose() { options.signal?.removeEventListener("abort", abort); input.dispose(); } };
}

export async function probeMediaAsset(blob, options = {}) {
  if (blob.type.startsWith("image/")) {
    const bitmap = await createImageBitmap(blob);
    try { return { kind: "image", width: bitmap.width, height: bitmap.height }; } finally { bitmap.close(); }
  }
  const owner = await openInput(blob, options);
  try {
    const video = await owner.input.getPrimaryVideoTrack(), audio = await owner.input.getPrimaryAudioTrack();
    if (!video && !audio) throw new Error("No supported audio/video track was found.");
    if (video && !await video.canDecode() || audio && !await audio.canDecode()) throw Object.assign(new Error("This browser cannot decode this media codec. Convert the source file or use another browser."), { code: "MEDIA_CODEC_UNAVAILABLE" });
    return { kind: video ? "video" : "audio", duration: await owner.input.computeDuration(), hasAudio: Boolean(audio), ...(video ? { width: video.displayWidth, height: video.displayHeight } : {}) };
  } finally { owner.dispose(); }
}

export async function createMediaAssetRenderer(asset, options) {
  const url = await options.resolveAsset(asset.url, { kind: asset.kind });
  let bitmap, owner, sink;
  try {
    if (asset.kind === "image") {
      const response = await fetch(url, { signal: options.signal });
      if (!response.ok) throw new Error(`Image HTTP ${response.status}`);
      bitmap = await createImageBitmap(await response.blob());
    } else {
      owner = await openInput(url, options);
      const track = await owner.input.getPrimaryVideoTrack();
      if (!track || !await track.canDecode()) throw new Error("Video decoder is unavailable for this clip.");
      sink = new owner.m.CanvasSink(track, { width: options.width, height: options.height, fit: options.fit === "stretch" ? "fill" : options.fit || "contain", poolSize: 2 });
    }
    return {
      async frame(time) { options.signal?.throwIfAborted(); return bitmap || (await sink.getCanvas(time))?.canvas; },
      dispose() { bitmap?.close(); owner?.dispose(); }
    };
  } catch (error) { bitmap?.close(); owner?.dispose(); throw error; }
}

/** Decode imported video audio once, then persist WAV as an ordinary audio asset.
 * Bounded allocation is deliberate: the browser editor is not an unbounded DAW.
 */
export async function extractMediaAudio(blob, options = {}) {
  const owner = await openInput(blob, options);
  try {
    const track = await owner.input.getPrimaryAudioTrack();
    if (!track) return null;
    if (!await track.canDecode()) throw new Error("This browser cannot decode the audio track.");
    const duration = await owner.input.computeDuration([track]), sink = new owner.m.AudioBufferSink(track);
    let pcm;
    for await (const value of sink.buffers()) {
      options.signal?.throwIfAborted();
      const buffer = value.buffer;
      if (!pcm) {
        const frames = Math.ceil(duration * buffer.sampleRate);
        if (!Number.isSafeInteger(frames) || frames * Math.min(2, buffer.numberOfChannels) * 4 > (options.maxPcmBytes ?? 256 * 1024 * 1024)) throw new Error("Audio is too long for browser editing memory. Import a shorter segment.");
        pcm = { sampleRate: buffer.sampleRate, channels: Array.from({ length: Math.min(2, buffer.numberOfChannels) }, () => new Float32Array(frames)) };
      }
      if (buffer.sampleRate !== pcm.sampleRate) throw new Error("Changing audio sample rates within a file are not supported.");
      const offset = Math.round(value.timestamp * pcm.sampleRate), begin = Math.max(0, -offset), target = Math.max(0, offset);
      for (let c = 0; c < pcm.channels.length; c++) {
        const count = Math.min(buffer.length - begin, pcm.channels[c].length - target);
        if (count > 0) pcm.channels[c].set(buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1)).subarray(begin, begin + count), target);
      }
    }
    if (!pcm) return null;
    const { encodeWav } = await import("@threejson/audio-kit");
    return { blob: new Blob([encodeWav(pcm)], { type: "audio/wav" }), duration };
  } finally { owner.dispose(); }
}

export function drawMediaAsset(context, frame, width, height, fit = "contain") {
  if (!frame) return;
  const w = frame.width, h = frame.height;
  if (fit === "stretch" || !(w && h)) return context.drawImage(frame, 0, 0, width, height);
  const scale = fit === "cover" ? Math.max(width / w, height / h) : Math.min(width / w, height / h);
  context.drawImage(frame, (width - w * scale) / 2, (height - h * scale) / 2, w * scale, h * scale);
}

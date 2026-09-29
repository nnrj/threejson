export function validatePcm(pcm) {
  if (!Number.isInteger(pcm?.sampleRate) || pcm.sampleRate <= 0 || !Array.isArray(pcm.channels) || !pcm.channels.length || !pcm.channels.every((channel) => channel instanceof Float32Array && channel.length === pcm.channels[0].length)) throw new TypeError("PCM requires a sample rate and equal-length Float32Array channels.");
  return pcm;
}
export function pcmDuration(pcm) { validatePcm(pcm); return pcm.channels[0].length / pcm.sampleRate; }
function audioSource(clip) {
  if (!clip.renderer) { validatePcm(clip.pcm); return { ...clip.pcm, duration: pcmDuration(clip.pcm) }; }
  const renderer = clip.renderer;
  if (typeof renderer.render !== "function" || !Number.isFinite(renderer.duration) || renderer.duration <= 0 || !Number.isInteger(renderer.sampleRate) || renderer.sampleRate <= 0 || !Number.isInteger(renderer.channels) || renderer.channels < 1) throw new TypeError("Audio renderer needs duration, sampleRate, channels and render(startFrame, frameCount).");
  return renderer;
}
export function encodeWav(pcm) {
  validatePcm(pcm);
  const channels = pcm.channels.length, frames = pcm.channels[0].length, length = frames * channels * 2;
  if (length + 36 > 0xffffffff) throw new RangeError("PCM exceeds RIFF/WAV size; use a streaming codec/container.");
  const buffer = new ArrayBuffer(44 + length), view = new DataView(buffer);
  const str = (offset, value) => { for (let i=0;i<value.length;i++) view.setUint8(offset+i,value.charCodeAt(i)); };
  str(0,"RIFF"); view.setUint32(4,36+length,true); str(8,"WAVE"); str(12,"fmt "); view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,channels,true); view.setUint32(24,pcm.sampleRate,true); view.setUint32(28,pcm.sampleRate*channels*2,true); view.setUint16(32,channels*2,true); view.setUint16(34,16,true); str(36,"data"); view.setUint32(40,length,true);
  for (let i=0;i<frames;i++) for(let c=0;c<channels;c++) { const value = Math.max(-1,Math.min(1,pcm.channels[c][i])); view.setInt16(44+(i*channels+c)*2,Math.round(value*(value<0?32768:32767)),true); }
  return new Uint8Array(buffer);
}

/** Block renderer: memory stays bounded when producing long video soundtracks. */
export function createPcmMixer(clips, options = {}) {
  const sampleRate = options.sampleRate ?? 48000, channels = options.channels ?? 2;
  if (!Number.isInteger(sampleRate) || sampleRate <= 0 || !Number.isInteger(channels) || channels < 1) throw new RangeError("Invalid output PCM configuration.");
  const sources = clips.map(audioSource);
  for (let index = 0; index < clips.length; index++) {
    const clip = clips[index], source = sources[index];
    if (!source.duration) throw new Error("Audio source is empty.");
    for (const key of ["duration", "fadeIn", "fadeOut", "gain"]) if (clip[key] !== undefined && (!Number.isFinite(clip[key]) || clip[key] < 0)) throw new Error(`Invalid audio ${key}.`);
    if (clip.pan !== undefined && (!Number.isFinite(clip.pan) || Math.abs(clip.pan) > 1)) throw new Error("Audio pan must be between -1 and 1.");
    if (!(Number.isFinite(clip.rate ?? 1) && (clip.rate ?? 1) > 0) || !Number.isFinite(clip.start ?? 0) || (clip.start ?? 0) < 0 || !Number.isFinite(clip.sourceStart ?? 0) || (clip.sourceStart ?? 0) < 0) throw new Error("Invalid audio clip timing.");
    if (clip.sourceStart >= source.duration) throw new Error("Audio trim begins beyond the source.");
    const available = (source.duration - (clip.sourceStart || 0)) / (clip.rate ?? 1);
    if (clip.duration > available + 1e-6 && !clip.loop && clip.padSilence !== true) throw new Error(`Audio clip ${clip.id || ""} exceeds source duration; enable loop or explicit silence padding.`);
  }
  return {
    sampleRate, channels,
    render(startFrame, frameCount) {
      if (!Number.isInteger(startFrame) || startFrame < 0 || !Number.isInteger(frameCount) || frameCount < 0) throw new RangeError("PCM frames must be nonnegative integers.");
      const output = Array.from({ length: channels }, () => new Float32Array(frameCount));
      for (let index = 0; index < clips.length; index++) {
        const clip = clips[index], pcm = sources[index], rate = clip.rate ?? 1, trim = clip.sourceStart ?? 0, start = clip.start ?? 0;
        const available = pcm.duration - trim, length = Math.ceil(pcm.duration * pcm.sampleRate), pageSize = 4096, pages = new Map();
        const sample = (channel, frame) => {
          if (!clip.renderer) return pcm.channels[Math.min(channel, pcm.channels.length - 1)][frame];
          const page = Math.floor(frame / pageSize);
          if (!pages.has(page)) {
            if (pages.size >= 2) pages.delete(pages.keys().next().value);
            const block = validatePcm(pcm.render(page * pageSize, Math.min(pageSize, length - page * pageSize)));
            if (block.sampleRate !== pcm.sampleRate) throw new Error("Audio renderer changed sample rate.");
            pages.set(page, block);
          }
          const block = pages.get(page); return block.channels[Math.min(channel, block.channels.length - 1)][frame % pageSize];
        };
        const duration = clip.duration ?? available / rate;
        const first = Math.max(0, Math.ceil(start * sampleRate) - startFrame), last = Math.min(frameCount, Math.ceil((start + duration) * sampleRate) - startFrame);
        const pan = Math.max(-1, Math.min(1, clip.pan ?? 0)), gain = clip.gain ?? 1;
        for (let i = first; i < last; i++) {
          const time = (startFrame + i) / sampleRate - start;
          let sourceTime = time * rate;
          if (clip.loop) sourceTime %= available;
          if (sourceTime >= available) continue;
          const index = (trim + sourceTime) * pcm.sampleRate, a = Math.min(length - 1, Math.floor(index)), b = Math.min(length - 1, a + 1), fraction = index - a;
          const fade = Math.max(0, Math.min(1, clip.fadeIn > 0 ? time / clip.fadeIn : 1, clip.fadeOut > 0 ? (duration - time) / clip.fadeOut : 1));
          for (let c = 0; c < channels; c++) {
            const balance = channels === 2 ? (c === 0 ? Math.min(1, 1-pan) : Math.min(1, 1+pan)) : 1;
            const sa = sample(c, a), sb = sample(c, b);
            output[c][i] += (sa + (sb-sa)*fraction) * gain * fade * balance;
          }
        }
      }
      return { sampleRate, channels: output };
    }
  };
}

export async function decodeAudio(input, options = {}) {
  const AudioContextClass = options.AudioContext || globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextClass) throw Object.assign(new Error("Audio decoding requires a browser decoder or a host adapter."), { code: "AUDIO_DECODER_UNAVAILABLE" });
  let bytes;
  if (typeof input === "string" || input instanceof URL) { const response = await (options.fetch || fetch)(input, { signal: options.signal, credentials: "omit" }); if (!response.ok) throw new Error(`Audio HTTP ${response.status}`); bytes = await response.arrayBuffer(); }
  else if (input instanceof Blob) bytes = await input.arrayBuffer();
  else bytes = input instanceof ArrayBuffer ? input.slice(0) : input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  options.signal?.throwIfAborted();
  const context = new AudioContextClass();
  try { const buffer = await context.decodeAudioData(bytes); return { sampleRate: buffer.sampleRate, channels: Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i).slice()) }; }
  finally { await context.close(); }
}

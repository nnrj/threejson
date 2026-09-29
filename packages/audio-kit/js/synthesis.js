import { compileScore } from "./score.js";
import { validatePcm } from "./pcm.js";

const instruments = new Map();
export function registerScoreInstrument(id, render) { if (!id || typeof render !== "function") throw new TypeError("Instrument needs an ID and renderer."); instruments.set(id, render); return () => { if (instruments.get(id) === render) instruments.delete(id); }; }
export function createScoreRenderer(score, options = {}) {
  const plan = score.events ? score : compileScore(score), sampleRate = options.sampleRate ?? 48000;
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw new RangeError("Invalid sample rate.");
  if (![options.release ?? .08, options.gain ?? .15].every((value) => Number.isFinite(value) && value >= 0)) throw new RangeError("Synthesis release and gain must be finite and nonnegative.");
  const custom = new Map();
  for (const event of plan.events) {
    if (!["sine", "triangle", "soft-piano", "bell", "noise"].includes(event.instrument) && !instruments.has(event.instrument)) throw new Error(`Unknown score instrument: ${event.instrument}`);
    if (instruments.has(event.instrument)) custom.set(event.instrument, instruments.get(event.instrument));
  }
  return {
    duration: plan.duration + (options.release ?? .08), sampleRate, channels: 2,
    render(startFrame, frameCount) {
      if (!Number.isSafeInteger(startFrame) || startFrame < 0 || !Number.isSafeInteger(frameCount) || frameCount < 0) throw new RangeError("Invalid synthesis frame range.");
      const channels = [new Float32Array(frameCount), new Float32Array(frameCount)];
      for (const event of plan.events) {
        const release = options.release ?? .08, end = event.start + event.duration + release;
        const first = Math.max(0, Math.ceil(event.start * sampleRate) - startFrame), last = Math.min(frameCount, Math.ceil(end * sampleRate) - startFrame);
        const frequency = 440 * 2 ** ((event.pitch - 69) / 12), pan = Math.max(-1, Math.min(1, event.pan));
        for (let i = first; i < last; i++) {
          const t = (startFrame + i) / sampleRate - event.start, phase = 2 * Math.PI * frequency * t;
          const envelope = Math.max(0, Math.min(1, t / .005, (event.duration + release - t) / Math.max(release, 1e-9)));
          let value;
          if (custom.has(event.instrument)) value = custom.get(event.instrument)({ event, time: t, phase, frequency, sampleRate });
          else if (event.instrument === "triangle") value = Math.asin(Math.sin(phase)) * 2 / Math.PI;
          else if (event.instrument === "soft-piano") value = (Math.sin(phase) + .3*Math.sin(phase*2) + .12*Math.sin(phase*3)) * Math.exp(-t*2);
          else if (event.instrument === "bell") value = (Math.sin(phase) + .3*Math.sin(phase*2.76)) * Math.exp(-t*4);
          else if (event.instrument === "noise") { const n = Math.sin((startFrame+i+event.pitch*101)*12.9898)*43758.5453; value = ((n-Math.floor(n))*2-1)*Math.exp(-t*12); }
          else value = Math.sin(phase);
          if (!Number.isFinite(value)) throw new Error(`Instrument ${event.instrument} produced a non-finite sample.`);
          value *= envelope * event.velocity * event.gain * (options.gain ?? .15);
          channels[0][i] += value * Math.min(1, 1-pan); channels[1][i] += value * Math.min(1, 1+pan);
        }
      }
      return { sampleRate, channels };
    }
  };
}
export function synthesizeScore(score, options = {}) { const renderer = createScoreRenderer(score, options); return renderer.render(0, Math.ceil(renderer.duration * renderer.sampleRate)); }

const producers = new Map();
/** Hosts may supply local WASM TTS, SoundFont workers or remote synthesis. */
export function registerAudioProducer(id, producer) {
  if (!id || typeof producer?.synthesize !== "function") throw new TypeError("Audio producer needs synthesize().");
  producers.set(id, producer); return () => { if (producers.get(id) === producer) producers.delete(id); };
}
export function getAudioProducers() { return [...producers].map(([id, item]) => ({ id, ...item.capabilities })); }
export async function produceAudio(recipe, context = {}) {
  context.signal?.throwIfAborted();
  if (recipe.kind === "score" && !recipe.producer) return synthesizeScore(recipe.score, recipe.options);
  const producer = producers.get(recipe.producer);
  if (!producer) throw Object.assign(new Error(`Audio producer is not installed: ${recipe.producer}`), { code: "AUDIO_PRODUCER_UNAVAILABLE" });
  const pcm = await producer.synthesize(recipe, context); context.signal?.throwIfAborted(); return validatePcm(pcm);
}

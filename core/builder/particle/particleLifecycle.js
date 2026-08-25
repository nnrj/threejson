import { ParticleDescriptorError } from "./particleV2Descriptor.js";

const DEFAULT_MAX_KEYFRAMES = 8;

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * Normalize a serialized particle lifecycle curve into deterministic, ordered
 * keyframes. Primitive arrays use evenly spaced times; object arrays preserve
 * explicit `t` values. The limit matches the bounded shader representation.
 */
export function normalizeParticleLifecycleFrames(value, fallback, options = {}) {
  const maxKeyframes = Math.max(2, Math.floor(finite(options.maxKeyframes, DEFAULT_MAX_KEYFRAMES)));
  const list = Array.isArray(value) ? value : [];
  if (list.length > maxKeyframes) {
    throw new ParticleDescriptorError(
      `Particle lifecycle curve has ${list.length} keyframes; the shared backend limit is ${maxKeyframes}`,
      "E_PARTICLE_LIFECYCLE_KEYFRAME_LIMIT",
      { keyframeCount: list.length, maxKeyframes }
    );
  }
  if (list.length === 0) {
    return [{ t: 0, value: fallback }, { t: 1, value: fallback }];
  }

  let frames;
  if (list.every((entry) => typeof entry === "number" || typeof entry === "string")) {
    frames = list.map((entry, index) => ({
      t: list.length === 1 ? 0 : index / (list.length - 1),
      value: entry
    }));
  } else {
    frames = list.map((entry, index) => ({
      t: Math.max(0, Math.min(1, finite(entry?.t, index / Math.max(1, list.length - 1)))),
      value: entry?.value ?? fallback
    })).sort((a, b) => a.t - b.t);
  }

  if (frames.length === 1) frames.push({ t: 1, value: frames[0].value });
  return frames;
}

export function sampleParticleLifecycleSegment(frames, progress) {
  const t = Math.max(0, Math.min(1, finite(progress, 0)));
  let upper = frames.findIndex((frame) => frame.t >= t);
  if (upper <= 0) return [frames[0], frames[0], 0];
  if (upper < 0) return [frames.at(-1), frames.at(-1), 0];
  const a = frames[upper - 1];
  const b = frames[upper];
  return [a, b, (t - a.t) / Math.max(1e-9, b.t - a.t)];
}

export const PARTICLE_SHADER_KEYFRAME_LIMIT = DEFAULT_MAX_KEYFRAMES;

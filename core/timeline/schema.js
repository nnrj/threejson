import { validateTimelineSignal } from "./signals.js";
export function timelineError(code, message, details = {}) { return Object.assign(new Error(message), { code, ...details }); }
const fail = (message, details) => { throw timelineError("INVALID_TIMELINE", message, details); };
export function finiteTime(value, name = "time") {
  if (!Number.isFinite(value) || value < 0) fail(`${name} must be a finite nonnegative number.`);
  return value;
}

/** Seconds throughout, independently of the requested output frame rate. */
export function validateTimeline(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Timeline must be an object.");
  if (input.version !== undefined && input.version !== 1) fail("Unsupported timeline version.");
  const result = structuredClone(input), ids = new Set();
  const claim = (item, type) => {
    if (!item || typeof item.id !== "string" || !item.id.trim() || ids.has(item.id)) fail(`${type} needs a unique id.`, { id: item?.id });
    ids.add(item.id);
  };
  if (result.duration !== undefined) finiteTime(result.duration, "duration");
  if (result.simulationStep !== undefined && !(Number.isFinite(result.simulationStep) && result.simulationStep > 0)) fail("simulationStep must be positive.");
  for (const key of ["tracks", "audio", "captions", "clips", "effects"]) {
    if (result[key] !== undefined && !Array.isArray(result[key])) fail(`${key} must be an array.`);
    result[key] ??= [];
  }
  for (const track of result.tracks) {
    claim(track, "Track");
    if (typeof track.target !== "string" || !track.target || typeof track.property !== "string" || !track.property) fail("Track needs target and property.");
    finiteTime(track.start ?? 0, "track.start");
    if (track.duration !== undefined) finiteTime(track.duration, "track.duration");
    if (track.extrapolation !== undefined && !["hold", "none", "loop"].includes(track.extrapolation)) fail("Unknown track extrapolation.");
    if (track.signal) {
      if (track.keyframes !== undefined) fail("Track uses either keyframes or a signal, not both.");
      validateTimelineSignal(track.signal);
      continue;
    }
    if (!Array.isArray(track.keyframes) || !track.keyframes.length) fail("Track needs keyframes or a signal.");
    let previous = -1;
    for (const frame of track.keyframes) {
      finiteTime(frame.time, "keyframe time");
      if (frame.time <= previous || frame.value === undefined) fail("Keyframe times must increase strictly and have values.");
      previous = frame.time;
      validateValue(frame.value);
    }
  }
  for (const key of ["audio", "captions", "clips", "effects"]) for (const item of result[key]) {
    claim(item, key);
    finiteTime(item.start ?? 0, `${key}.start`);
    if (item.duration !== undefined) finiteTime(item.duration, `${key}.duration`);
    for (const name of ["fadeIn", "fadeOut"]) if (item[name] !== undefined) finiteTime(item[name], name);
    if (key === "effects" && (!item.target || !item.operator)) fail("Effect needs target and operator.");
    if (key === "audio") { item.gain ??= 1; item.pan ??= 0; }
    if (key === "effects") {
      if (item.backend !== undefined && !["cpu", "webgl"].includes(item.backend)) fail("Effect backend must be cpu or webgl.");
      if (item.stagger !== undefined && !(Number.isFinite(item.stagger) && item.stagger >= 0 && item.stagger < 1)) fail("Effect stagger must be in [0, 1).");
      if (item.easing !== undefined && !["linear", "smoothstep"].includes(item.easing)) fail("Unknown particle effect easing.");
    }
    if (item.extrapolation !== undefined && !["hold", "none", "loop"].includes(item.extrapolation)) fail("Unknown item extrapolation.");
    if (key === "clips") {
      if (item.source === undefined) fail("Clip source is required.");
      if (!(Number.isFinite(item.duration) && item.duration > 0)) fail("Clip duration must be positive.");
      finiteTime(item.sourceStart ?? 0, "sourceStart");
      if (item.rate !== undefined && !(Number.isFinite(item.rate) && item.rate > 0)) fail("Clip rate must be positive.");
      if (item.transitionIn) {
        const transition = item.transitionIn;
        if (!["wipe", "dissolve"].includes(transition.type) || !(Number.isFinite(transition.duration) && transition.duration > 0 && transition.duration <= item.duration)) fail("Clip transitionIn needs wipe/dissolve and a positive duration within the clip.");
        if (transition.direction !== undefined && !["left", "right", "up", "down"].includes(transition.direction)) fail("Unknown wipe direction.");
        if (transition.seed !== undefined && !Number.isFinite(transition.seed)) fail("Dissolve seed must be finite.");
        if (transition.softness !== undefined && !(Number.isFinite(transition.softness) && transition.softness >= 0 && transition.softness <= 1)) fail("Dissolve softness must be between 0 and 1.");
      }
    }
  }
  return result;
}

function validateValue(value) {
  if (typeof value === "number") { if (!Number.isFinite(value)) fail("Non-finite keyframe value."); return; }
  if (typeof value === "boolean" || typeof value === "string") return;
  if (Array.isArray(value) && value.length > 0) { value.forEach(validateValue); return; }
  if (value && typeof value === "object") { Object.values(value).forEach(validateValue); return; }
  fail("Invalid keyframe value.");
}

export function getTimelineDuration(timeline = {}) {
  if (timeline.duration !== undefined) return finiteTime(timeline.duration, "duration");
  let duration = 0;
  for (const track of timeline.tracks || []) {
    for (const frame of track.keyframes || []) duration = Math.max(duration, (track.start || 0) + frame.time);
    duration = Math.max(duration, (track.start || 0) + (track.duration ?? track.signal?.duration ?? 0));
  }
  for (const key of ["audio", "captions", "clips", "effects"]) for (const item of timeline[key] || []) duration = Math.max(duration, (item.start || 0) + (item.duration || 0));
  return duration;
}

/** Each occurrence has its own instance id, even when it references the same source. */
export function getActiveClips(timeline, time) {
  finiteTime(time);
  return (timeline.clips || []).filter((clip) => clip.enabled !== false && time >= (clip.start || 0) && time < (clip.start || 0) + clip.duration)
    .map((clip) => {
      const localTime = time - (clip.start || 0);
      const fadeIn = Math.max(0, Number(clip.fadeIn) || 0), fadeOut = Math.max(0, Number(clip.fadeOut) || 0);
      const opacity = Math.min(1, fadeIn ? localTime / fadeIn : 1, fadeOut ? (clip.duration - localTime) / fadeOut : 1);
      return { ...clip, localTime, sourceTime: (clip.sourceStart || 0) + localTime * (clip.rate ?? 1), opacity };
    });
}

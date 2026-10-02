// Pure, absolute-time signals shared by camera/property tracks and host media tools.
// Custom evaluators are registered by the application, never evaluated from JSON.
const evaluators = new Map();
const fail = (message) => { throw Object.assign(new TypeError(message), { code: "INVALID_TIMELINE_SIGNAL" }); };
const clamp = (x) => Math.max(0, Math.min(1, x));
const smooth = (x) => x * x * (3 - 2 * x);
const mix = (a, b, t) => Array.isArray(a) ? a.map((v, i) => mix(v, b[i], t)) : a + (b - a) * t;
function hash(n, seed = 0) {
  let x = (n | 0) ^ (seed | 0); x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); return ((x ^ (x >>> 16)) >>> 0) / 4294967295;
}
const builtins = new Set(["constant", "sine", "pulse", "noise", "envelope", "orbit", "path", "beat", "samples"]);
export function registerTimelineSignal(id, evaluate) {
  if (!id || typeof evaluate !== "function") throw new TypeError("Signal needs an id and evaluator.");
  evaluators.set(id, evaluate);
  return () => { if (evaluators.get(id) === evaluate) evaluators.delete(id); };
}
export function getTimelineSignals() { return [...new Set([...builtins, ...evaluators.keys()])]; }
export function validateTimelineSignal(signal) {
  if (!signal || typeof signal !== "object" || Array.isArray(signal) || typeof signal.type !== "string") fail("Signal needs a type.");
  if (!builtins.has(signal.type) && !evaluators.has(signal.type)) fail(`Unknown timeline signal: ${signal.type}`);
  const finite = value => Number.isFinite(value) || Array.isArray(value) && value.length > 0 && value.every(Number.isFinite);
  for (const key of ["frequency", "phase", "seed", "radius", "attack", "release", "duration", "duty", "bpm", "interval", "decay"]) {
    if (signal[key] !== undefined && !Number.isFinite(signal[key])) fail(`Signal ${key} must be a finite number.`);
  }
  for (const key of ["amplitude", "offset", "value"]) if (signal[key] !== undefined && !finite(signal[key])) fail(`Signal ${key} must be finite numbers.`);
  if (Array.isArray(signal.offset) && (!Array.isArray(signal.amplitude) || signal.amplitude.length !== signal.offset.length)) fail("Vector offset needs an equally sized amplitude.");
  for (const key of ["attack", "release", "duration"]) if (signal[key] !== undefined && signal[key] < 0) fail(`Signal ${key} cannot be negative.`);
  if (signal.duty !== undefined && (signal.duty < 0 || signal.duty > 1)) fail("Pulse duty must be between zero and one.");
  if (["orbit", "path", "envelope"].includes(signal.type) && !(signal.duration > 0)) fail(`${signal.type} signal needs a positive duration.`);
  if (signal.type === "orbit") {
    if (signal.center !== undefined && (!Array.isArray(signal.center) || signal.center.length !== 3 || !signal.center.every(Number.isFinite))) fail("Orbit center needs three finite coordinates.");
    if (signal.plane !== undefined && !["xy", "xz", "yz"].includes(signal.plane)) fail("Unknown orbit plane.");
  }
  if (signal.type === "path") {
    if (!Array.isArray(signal.points) || signal.points.length < 2 || !signal.points.every(p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite))) fail("Path needs at least two finite 3D points.");
    if (signal.interpolation !== undefined && !["linear", "catmullRom"].includes(signal.interpolation)) fail("Unknown path interpolation.");
  }
  if (signal.type === "beat" && (!(signal.bpm > 0) || signal.decay !== undefined && !(signal.decay > 0))) fail("Beat needs positive bpm and decay.");
  if (signal.type === "samples" && (!(signal.interval > 0) || !Array.isArray(signal.values) || !signal.values.length || !signal.values.every(Number.isFinite))) fail("Sampled signal needs finite values and a positive interval in seconds.");
  return signal;
}

/** Shared begin/end semantics. No integration or wall-clock dependence. */
export function sampleTimelineWindow(item, time) {
  if (item.enabled === false || time < (item.start ?? 0)) return null;
  let elapsed = time - (item.start ?? 0);
  const duration = item.duration;
  if (duration !== undefined && elapsed >= duration) {
    if (item.extrapolation === "none") return null;
    if (item.extrapolation === "loop" && duration > 0) elapsed %= duration;
    else elapsed = duration;
  }
  return { time: elapsed, progress: duration > 0 ? clamp(elapsed / duration) : 1 };
}

export function sampleTimelineSignal(signal, time) {
  const custom = evaluators.get(signal.type);
  if (custom) return custom(signal, time);
  const frequency = signal.frequency ?? 1, phase = signal.phase ?? 0;
  const amplitude = signal.amplitude ?? 1, offset = signal.offset ?? 0;
  const apply = (v) => Array.isArray(amplitude) ? amplitude.map((a, i) => (Array.isArray(offset) ? offset[i] : offset) + v * a) : offset + v * amplitude;
  switch (signal.type) {
    case "constant": return structuredClone(signal.value ?? 0);
    case "sine": return apply(Math.sin(2 * Math.PI * (time * frequency + phase)));
    case "pulse": return apply(((time * frequency + phase) % 1 + 1) % 1 < (signal.duty ?? .5) ? 1 : 0);
    case "beat": {
      const beat = time * signal.bpm / 60 + phase;
      return apply(Math.exp(-(((beat % 1) + 1) % 1) / (signal.decay ?? .15)));
    }
    case "samples": {
      const values = signal.values, x = Math.max(0, time / signal.interval), i = Math.floor(x);
      return apply(mix(values[Math.min(values.length - 1, i)], values[Math.min(values.length - 1, i + 1)], x - i));
    }
    case "noise": {
      const x = time * frequency + phase, n = Math.floor(x);
      return apply(2 * mix(hash(n, signal.seed), hash(n + 1, signal.seed), smooth(x - n)) - 1);
    }
    case "envelope": {
      const attack = Math.max(0, signal.attack ?? .1), release = Math.max(0, signal.release ?? .1);
      return apply(smooth(clamp(Math.min(attack ? time / attack : 1, release ? (signal.duration - time) / release : 1))));
    }
    case "orbit": {
      const center = signal.center || [0, 0, 0], radius = signal.radius ?? 1, a = 2 * Math.PI * (time / signal.duration + phase);
      const p = [...center], plane = signal.plane || "xz", axes = { x: 0, y: 1, z: 2 };
      p[axes[plane[0]]] += radius * Math.cos(a); p[axes[plane[1]]] += radius * Math.sin(a); return p;
    }
    case "path": {
      const points = signal.points, segments = signal.closed ? points.length : points.length - 1;
      const x = clamp(time / signal.duration) * segments, i = Math.min(segments - 1, Math.floor(x)), t = x - i;
      const at = (index) => points[signal.closed ? (index + points.length) % points.length : Math.max(0, Math.min(points.length - 1, index))];
      if (signal.interpolation === "linear") return mix(at(i), at(i + 1), t);
      const [a, b, c, d] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
      return b.map((v, j) => .5 * ((2 * v) + (-a[j] + c[j]) * t + (2 * a[j] - 5 * v + 4 * c[j] - d[j]) * t * t + (-a[j] + 3 * v - 3 * c[j] + d[j]) * t * t * t));
    }
    default: fail(`Unknown timeline signal: ${signal.type}`);
  }
}

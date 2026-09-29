import * as THREE from "three";
import { timelineError } from "./schema.js";

const easings = new Map([
  ["linear", (t) => t], ["step", () => 0], ["smoothstep", (t) => t * t * (3 - 2 * t)],
  ["easeIn", (t) => t * t], ["easeOut", (t) => 1 - (1 - t) ** 2],
  ["easeInOut", (t) => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2]
]);
export function registerTimelineEasing(id, evaluate) {
  if (typeof id !== "string" || !id || typeof evaluate !== "function") throw new TypeError("Easing needs an id and function.");
  easings.set(id, evaluate);
  return () => { if (easings.get(id) === evaluate) easings.delete(id); };
}
const copy = (value) => value?.clone ? value.clone() : structuredClone(value);
const vectorArray = (value) => Array.isArray(value) ? value : [value.x, value.y, value.z, ...(value.w === undefined ? [] : [value.w])];
function lerp(a, b, t, kind) {
  if (kind === "color") return new THREE.Color(a).lerp(new THREE.Color(b), t);
  if (kind === "quaternion") return new THREE.Quaternion(...vectorArray(a)).slerp(new THREE.Quaternion(...vectorArray(b)), t);
  if (typeof a === "number" && typeof b === "number") return a + (b - a) * t;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) return a.map((v, i) => lerp(v, b[i], t));
  if (a && b && typeof a === "object" && typeof b === "object") return Object.fromEntries(Object.keys(a).map((key) => [key, lerp(a[key], b[key], t)]));
  return t < 1 ? a : b;
}

export function sampleTimelineTrack(track, time, kind) {
  if (track.enabled === false) return undefined;
  const frames = track.keyframes;
  if (time < frames[0].time) return undefined;
  if (time >= frames.at(-1).time) return copy(frames.at(-1).value);
  // Binary lookup makes dense keyframe tracks cheap to seek.
  let lo = 0, hi = frames.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >>> 1; if (frames[mid].time <= time) lo = mid; else hi = mid; }
  const a = frames[lo], b = frames[hi], id = a.easing || track.easing || "linear", ease = easings.get(id);
  if (!ease) throw timelineError("UNKNOWN_TIMELINE_EASING", `Unknown easing: ${id}`);
  return lerp(a.value, b.value, ease((time - a.time) / (b.time - a.time)), kind);
}

/** A compiled track only touches runtime state, never the authoring descriptor. */
export function compileTimelineTracks(runtime, tracks = [], options = {}) {
  const objects = new Map();
  runtime.scene.traverse((object) => { const id = object.userData?.threeJsonId || object.userData?.objJson?.threeJsonId; if (id) objects.set(id, object); });
  objects.set("$camera", runtime.camera); objects.set("$scene", runtime.scene);
  // Resolve aim constraints after every position/parent transform, regardless
  // of JSON ordering. Otherwise moving the camera changes its intended target.
  const bindings = tracks.filter((track) => track.enabled !== false).map((track) => {
    const target = options.resolveTarget?.(track.target, runtime) || objects.get(track.target);
    if (!target) throw timelineError("TIMELINE_TARGET_MISSING", `Timeline target not found: ${track.target}`, { trackId: track.id });
    if (track.property === "lookAt") return { track, aim: true, restore() {}, apply(value) { target.lookAt(new THREE.Vector3(...vectorArray(value))); } };
    const keys = track.property.split(".");
    if (keys.some((key) => ["__proto__", "prototype", "constructor", "userData"].includes(key))) throw timelineError("INVALID_TIMELINE_PROPERTY", `Invalid runtime property: ${track.property}`);
    let owner = target;
    for (const key of keys.slice(0, -1)) owner = owner?.[key];
    const key = keys.at(-1), initial = owner?.[key];
    if (initial === undefined || typeof initial === "function") throw timelineError("TIMELINE_PROPERTY_MISSING", `Timeline property not found: ${track.property}`, { trackId: track.id });
    const baseline = copy(initial), transparent = owner.isMaterial ? owner.transparent : undefined, kind = initial?.isColor ? "color" : initial?.isQuaternion ? "quaternion" : undefined;
    const apply = (value) => {
      if (initial?.isColor) owner[key].set(value);
      else if (initial?.isQuaternion) owner[key].copy(value?.isQuaternion ? value : new THREE.Quaternion(...vectorArray(value)));
      else if (initial?.isVector2 || initial?.isVector3 || initial?.isVector4 || initial?.isEuler) owner[key].set(...vectorArray(value));
      else owner[key] = copy(value);
      if (target.isCamera) target.updateProjectionMatrix();
      if (owner.isMaterial && key === "opacity" && owner.opacity < 1) owner.transparent = true;
    };
    return { track, kind, restore() { apply(baseline); if (transparent !== undefined) owner.transparent = transparent; }, apply };
  });
  return {
    restore() { for (const binding of bindings) binding.restore(); },
    evaluate(time) {
      for (const aim of [false, true]) for (const binding of bindings) {
        if (Boolean(binding.aim) !== aim) continue;
        const value = sampleTimelineTrack(binding.track, time, binding.kind);
        if (value !== undefined) binding.apply(value);
      }
    }
  };
}

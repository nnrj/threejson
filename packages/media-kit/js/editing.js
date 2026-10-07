// Authoring-only NLE operations. Times are seconds; a clip is an occurrence,
// not its scene/asset. All callers (UI, JSON and Agent) use session transactions.
import { getTimelineDuration } from "threejson/timeline";
export const isMediaSource = source => source?.type === "media";
export const mediaAssetOf = (document, clip) => isMediaSource(clip.source) && Object.hasOwn(document.mediaAssets || {}, clip.source.assetId) ? document.mediaAssets[clip.source.assetId] : null;
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const start = item => item.start || 0;
const end = item => start(item) + item.duration;
const finite = value => Number.isFinite(value);
const sections = ["clips", "audio", "captions"];
export const laneEnabled = (timeline, item) => item.enabled !== false && !timeline.lanes?.find(lane => lane.id === item.laneId)?.muted;
export const itemEnabled = (timeline, item) => laneEnabled(timeline, item) && (!item.linkedClipId || laneEnabled(timeline, timeline.clips?.find(c => c.id === item.linkedClipId) || {}));
const lane = (document, item) => document.timeline.lanes?.find(value => value.id === item.laneId);
const editable = (document, item) => { if (lane(document, item)?.locked) fail("MEDIA_LANE_LOCKED", `Track is locked: ${item.laneId}`); };
const find = (document, id) => { const clip = document.timeline.clips.find(c => c.id === id); if (!clip) fail("MEDIA_SHOT_MISSING", `Clip not found: ${id}`); return clip; };
const idValid = id => typeof id === "string" && id.trim() && !["__proto__", "constructor", "prototype"].includes(id);
const uniqueId = (document, proposed) => {
  const used = new Set(["clips", "audio", "captions", "tracks", "effects"].flatMap(key => (document.timeline[key] || []).map(item => item.id)));
  let id = proposed, n = 1; while (used.has(id)) id = `${proposed}-${n++}`; return id;
};

/** Validate lane/asset references separately from property-animation tracks. */
export function validateMediaEditing(document) {
  const timeline = document.timeline || {}, lanes = timeline.lanes || [], ids = new Set();
  if (!Array.isArray(lanes)) fail("INVALID_MEDIA_LANES", "lanes must be an array.");
  if (document.mediaAssets !== undefined && (!document.mediaAssets || typeof document.mediaAssets !== "object" || Array.isArray(document.mediaAssets))) fail("INVALID_MEDIA_ASSET", "mediaAssets must be an object keyed by stable asset ids.");
  for (const item of lanes) {
    if (!idValid(item.id) || ids.has(item.id) || !["visual", "audio", "caption"].includes(item.kind)) fail("INVALID_MEDIA_LANE", "Tracks need unique ids and visual/audio/caption kinds.");
    ids.add(item.id);
  }
  for (const [id, asset] of Object.entries(document.mediaAssets || {})) {
    if (!idValid(id) || !["image", "video", "audio"].includes(asset?.kind) || typeof asset.url !== "string" || !asset.url.trim()) fail("INVALID_MEDIA_ASSET", `Invalid asset: ${id}`);
    if (asset.duration !== undefined && !(finite(asset.duration) && asset.duration > 0)) fail("INVALID_MEDIA_ASSET", `Invalid asset duration: ${id}`);
  }
  for (const section of sections) for (const item of timeline[section] || []) {
    if (item.laneId && (!ids.has(item.laneId) || lane(document, item).kind !== ({ clips: "visual", audio: "audio", captions: "caption" })[section])) fail("INVALID_MEDIA_LANE", `Missing or incompatible track: ${item.laneId}`);
    if (item.linkedClipId && !timeline.clips?.some(c => c.id === item.linkedClipId)) fail("MEDIA_LINK_MISSING", `Linked clip not found: ${item.linkedClipId}`);
    if (section === "audio") {
      for (const field of ["gain", "sourceStart"]) if (item[field] !== undefined && !(finite(item[field]) && item[field] >= 0)) fail("INVALID_MEDIA_AUDIO", `${field} must be nonnegative.`);
      if (item.rate !== undefined && !(finite(item.rate) && item.rate > 0)) fail("INVALID_MEDIA_AUDIO", "Audio rate must be positive.");
    }
    if (section !== "clips") continue;
    if (item.opacity !== undefined && !(finite(item.opacity) && item.opacity >= 0 && item.opacity <= 1)) fail("INVALID_MEDIA_OPACITY", "Clip opacity must be between 0 and 1.");
    if (item.fit !== undefined && !["contain", "cover", "stretch"].includes(item.fit)) fail("INVALID_MEDIA_FIT", "Use contain, cover or stretch.");
    if (isMediaSource(item.source)) {
      const asset = mediaAssetOf(document, item);
      if (!asset || !["image", "video"].includes(asset.kind)) fail("MEDIA_ASSET_MISSING", `Clip needs an image/video asset: ${item.source.assetId}`);
      if (asset.kind === "video" && finite(asset.duration) && (item.sourceStart || 0) + item.duration * (item.rate ?? 1) > asset.duration + 1e-5) fail("MEDIA_SOURCE_BOUNDS", "Clip extends beyond its source video.");
    }
  }
  for (const track of timeline.tracks || []) {
    const section = track.target.startsWith("$caption:") ? "captions" : track.target.startsWith("$audio:") ? "audio" : null;
    if (section && !timeline[section]?.some(item => track.target === `$${section === "audio" ? "audio" : "caption"}:${item.id}`)) fail("TIMELINE_TARGET_MISSING", `Timeline target not found: ${track.target}`);
  }
  return document;
}

const timeMap = (before, after) => {
  const ratio = (before.rate ?? 1) / (after.rate ?? 1);
  return { ratio, offset: start(after) + ((before.sourceStart || 0) - (after.sourceStart || 0)) / (after.rate ?? 1) - start(before) * ratio };
};
/** Preserve root automation when the owning audio/caption is moved or copied.
 * Unrepresentable signal retiming is rejected instead of silently changing its
 * phase/easing. In-shot animation always follows the clip's source clock.
 */
export function remapMediaAutomation(document, section, before, mappings) {
  if (!["audio", "captions"].includes(section)) return;
  const prefix = section === "audio" ? "$audio:" : "$caption:", target = prefix + before.id;
  const tracks = document.timeline.tracks || [], originals = tracks.filter(t => t.target === target);
  if (!originals.length) return;
  const next = tracks.filter(t => t.target !== target);
  const used = new Set([...tracks.map(t => t.id), ...sections.flatMap(key => (document.timeline[key] || []).map(item => item.id))]);
  for (const { item, ratio = 1, offset = 0 } of mappings) for (const track of originals) {
    const shifted = (track.start || 0) * ratio + offset;
    if (shifted < -1e-7 || track.signal && Math.abs(ratio - 1) > 1e-7) fail("MEDIA_AUTOMATION_RETIME", "This edit cannot preserve the root automation exactly. Move the animation into the shot, or retime its tracks explicitly in JSON.");
    let id = track.id;
    if (item.id !== before.id) { id = `${track.id}-${item.id}`; let n = 1; while (used.has(id)) id = `${track.id}-${item.id}-${n++}`; used.add(id); }
    next.push({ ...track, id, target: prefix + item.id, start: Math.max(0, shifted),
      ...(track.duration !== undefined ? { duration: track.duration * ratio } : {}),
      ...(track.keyframes ? { keyframes: track.keyframes.map(frame => ({ ...frame, time: frame.time * ratio })) } : {}) });
  }
  document.timeline.tracks = next;
}

export function editMediaRecordAutomation(document, section, before, after) {
  remapMediaAutomation(document, section, before, after ? [{ item: after, ...timeMap(before, after) }] : []);
}

/** Copy-on-write: split occurrences may reference the same immutable scene. */
export function putClipScene(document, clip, scene) {
  let key = typeof clip.source === "string" ? clip.source : clip.id;
  if (document.timeline.clips.some(c => c.id !== clip.id && c.source === key)) {
    key = `${clip.id}-scene`; let n = 1;
    while (Object.hasOwn(document.scenes, key)) key = `${clip.id}-scene-${n++}`;
  }
  document.scenes[key] = scene;
  document.timeline.clips = document.timeline.clips.map(c => c.id === clip.id ? { ...c, source: key } : c);
}

// Keep linked caption/audio source time continuous through moves, trims and rate
// changes. Cropping is explicit; unlink a record to make it independent.
function mapLinked(item, before, after) {
  const ratio = (before.rate ?? 1) / (after.rate ?? 1);
  const offset = start(after) + ((before.sourceStart || 0) - (after.sourceStart || 0)) / (after.rate ?? 1);
  const audioRate = (item.rate ?? 1) / ratio;
  // Original video sound retains its source handles across repeated trims and
  // rolling edits. Short narration/caption cues are cropped, never stretched.
  const sourceLinked = item.linkedRange === "source" && finite(item.sourceDuration);
  const mappedStart = offset + (start(item) - start(before)) * ratio - (sourceLinked ? (item.sourceStart || 0) / audioRate : 0);
  const mappedEnd = mappedStart + (sourceLinked ? item.sourceDuration / audioRate : item.duration * ratio);
  const begin = Math.max(start(after), mappedStart), stop = Math.min(end(after), mappedEnd);
  if (stop <= begin + 1e-8) return null;
  return { ...item, start: begin, duration: stop - begin,
    ...(item.url || item.recipe ? { sourceStart: (sourceLinked ? 0 : item.sourceStart || 0) + (begin - mappedStart) * audioRate, rate: audioRate } : {}),
    ...(item.fadeIn ? { fadeIn: Math.min(item.fadeIn * ratio, stop - begin) } : {}),
    ...(item.fadeOut ? { fadeOut: Math.min(item.fadeOut * ratio, stop - begin) } : {}) };
}
function update(document, id, changes, linked = true) {
  const before = find(document, id); editable(document, before);
  const keys = ["start", "duration", "sourceStart", "rate", "enabled", "opacity", "fadeIn", "fadeOut", "transitionIn", "laneId", "fit", "name"];
  if (Object.keys(changes || {}).some(key => !keys.includes(key))) fail("INVALID_CLIP_CHANGE", "Use clip timing/appearance fields, not source or id changes.");
  const after = { ...before, ...changes }; editable(document, after);
  if (linked) for (const key of ["audio", "captions"]) document.timeline[key] = (document.timeline[key] || []).flatMap(item => {
    if (item.linkedClipId !== id) return [item]; editable(document, item);
    const mapped = mapLinked(item, before, after);
    remapMediaAutomation(document, key, item, mapped ? [{ item: mapped, ...timeMap(before, after) }] : []);
    return mapped ? [mapped] : [];
  });
  document.timeline.clips = document.timeline.clips.map(c => c.id === id ? after : c);
}

export function applyMediaEditing(document, op, args) {
  if (!op.startsWith("media.clip.") && !["media.asset.put", "media.lanes.set", "media.item.duplicate"].includes(op)) return false;
  if (op === "media.asset.put") {
    if (!idValid(args.id)) fail("INVALID_MEDIA_ASSET", "Asset needs an id.");
    document.mediaAssets = { ...document.mediaAssets, [args.id]: structuredClone(args.asset) };
  } else if (op === "media.lanes.set") {
    document.timeline.lanes = structuredClone(args.lanes);
  } else if (op === "media.item.duplicate") {
    if (!sections.includes(args.section)) fail("INVALID_TIMELINE_SECTION", "Duplicate clips, audio or captions.");
    const before = document.timeline[args.section]?.find(item => item.id === args.id);
    if (!before) fail("TIMELINE_ITEM_MISSING", `Item not found: ${args.id}`);
    editable(document, before);
    const id = args.newId || uniqueId(document, `${before.id}-copy`);
    if (!idValid(id) || sections.some(key => document.timeline[key]?.some(item => item.id === id))) fail("INVALID_MEDIA_SHOT_ID", "Copy needs a new id.");
    const duration = before.duration ?? Math.max(0, getTimelineDuration(document.timeline) - start(before));
    if (!(duration > 0)) fail("MEDIA_ITEM_DURATION_REQUIRED", "Set an explicit item/project duration before duplicating this open-ended item.");
    const copy = { ...before, id, duration, start: args.start ?? start(before) + duration }, offset = start(copy) - start(before);
    delete copy.linkedClipId;
    document.timeline[args.section] = [...document.timeline[args.section], copy];
    if (args.section !== "clips") remapMediaAutomation(document, args.section, before, [{ item: before }, { item: copy, offset }]);
    else {
      for (const section of ["audio", "captions"]) for (const item of [...(document.timeline[section] || [])]) if (item.linkedClipId === before.id) {
        editable(document, item);
        const linked = { ...item, id: uniqueId(document, `${id}-${item.id}`), start: start(item) + offset, linkedClipId: id };
        document.timeline[section] = [...document.timeline[section], linked];
        remapMediaAutomation(document, section, item, [{ item }, { item: linked, offset }]);
      }
      document.production.shots[id] = { ...document.production.shots[before.id] };
    }
  } else if (op === "media.clip.insert") {
    const clip = structuredClone(args.clip);
    if (!idValid(clip?.id) || document.timeline.clips.some(c => c.id === clip.id)) fail("INVALID_MEDIA_SHOT_ID", "Clip needs a unique id.");
    editable(document, clip); document.timeline.clips.push(clip);
  } else if (op === "media.clip.update") update(document, args.id, args.changes, args.linked !== false);
  else if (op === "media.clip.split") {
    const before = find(document, args.id); editable(document, before);
    if (!(finite(args.time) && args.time > start(before) && args.time < end(before))) fail("INVALID_SPLIT_TIME", "Split must be inside the clip.");
    const newId = args.newId || uniqueId(document, `${before.id}-split`);
    if (!idValid(newId) || document.timeline.clips.some(c => c.id === newId)) fail("INVALID_MEDIA_SHOT_ID", "Split needs a new id.");
    const first = { ...before, duration: args.time - start(before), fadeOut: 0 };
    const second = { ...before, id: newId, start: args.time, duration: end(before) - args.time, sourceStart: (before.sourceStart || 0) + first.duration * (before.rate ?? 1), fadeIn: 0 };
    delete second.transitionIn;
    if (first.transitionIn?.duration > first.duration) first.transitionIn = { ...first.transitionIn, duration: first.duration };
    document.timeline.clips = document.timeline.clips.flatMap(c => c.id === before.id ? [first, second] : [c]);
    for (const key of ["audio", "captions"]) document.timeline[key] = (document.timeline[key] || []).flatMap(item => {
      if (item.linkedClipId !== before.id) return [item]; editable(document, item);
      const left = mapLinked(item, before, first), right = mapLinked(item, before, second);
      const copy = right ? { ...right, id: uniqueId(document, `${newId}-${item.id}`), linkedClipId: newId } : null;
      remapMediaAutomation(document, key, item, [...(left ? [{ item: left }] : []), ...(copy ? [{ item: copy }] : [])]);
      return [...(left ? [left] : []), ...(copy ? [copy] : [])];
    });
    document.production.shots[newId] = { ...document.production.shots[before.id] };
  } else if (op === "media.clip.remove") {
    const clip = find(document, args.id); editable(document, clip);
    for (const key of sections) document.timeline[key] = (document.timeline[key] || []).flatMap(item => {
      if (key === "clips" && item.id === args.id || item.linkedClipId === args.id) { editable(document, item); remapMediaAutomation(document, key, item, []); return []; }
      if (!args.ripple) return [item];
      if (!finite(item.duration)) fail("MEDIA_RIPPLE_DURATION_REQUIRED", "Set an explicit duration for open-ended audio/captions before ripple deletion.");
      if (end(item) <= start(clip) + 1e-7) return [item];
      editable(document, item);
      if (start(item) < end(clip) - 1e-7) fail("MEDIA_RIPPLE_OVERLAP", "Ripple deletion intersects another clip. Trim/unlink overlapping tracks first, or use ordinary deletion.");
      const moved = { ...item, start: start(item) - clip.duration };
      remapMediaAutomation(document, key, item, [{ item: moved, offset: -clip.duration }]);
      return [moved];
    });
    if (args.ripple && document.timeline.duration !== undefined) document.timeline.duration = Math.max(0, document.timeline.duration - clip.duration);
    delete document.production.shots[args.id];
  } else if (op === "media.clip.roll") {
    const left = find(document, args.id), right = find(document, args.nextId);
    if (left.laneId !== right.laneId || Math.abs(end(left) - start(right)) > 1e-6) fail("MEDIA_ROLL_NOT_ADJACENT", "Rolling edit requires adjacent clips on the same track.");
    if (!(finite(args.time) && args.time > start(left) && args.time < end(right))) fail("INVALID_ROLL_TIME", "Rolling boundary must stay inside both clips' combined range.");
    update(document, left.id, { duration: args.time - start(left) });
    update(document, right.id, { start: args.time, duration: end(right) - args.time, sourceStart: (right.sourceStart || 0) + (args.time - start(right)) * (right.rate ?? 1) });
  } else if (op === "media.clip.reorder") {
    const clip = find(document, args.id), ordered = document.timeline.clips.filter(c => c.laneId === clip.laneId).toSorted((a, b) => start(a) - start(b));
    if (args.beforeId && !ordered.some(c => c.id === args.beforeId)) fail("MEDIA_REORDER_TRACK", "Reorder within the same track.");
    for (let i = 1; i < ordered.length; i++) if (Math.abs(start(ordered[i]) - end(ordered[i-1])) > 1e-6) fail("MEDIA_REORDER_GAP", "Reordering requires contiguous clips. Use timing/move for tracks with gaps or overlaps.");
    if (args.beforeId === args.id) return true;
    const rest = ordered.filter(c => c.id !== args.id), index = args.beforeId ? rest.findIndex(c => c.id === args.beforeId) : rest.length;
    rest.splice(index, 0, clip); let cursor = start(ordered[0]);
    for (const item of rest) { update(document, item.id, { start: cursor }); cursor += item.duration; }
  } else fail("UNKNOWN_MEDIA_OPERATION", `Unknown editing operation: ${op}`);
  // An explicit end must never silently hide newly moved/inserted content.
  const maxEnd = Math.max(0, ...sections.flatMap(key => (document.timeline[key] || []).map(item => end(item) || 0)));
  if (document.timeline.duration !== undefined && maxEnd > document.timeline.duration) document.timeline.duration = maxEnd;
  return true;
}

export function snapMediaTime(time, timeline, { fps = 30, threshold = 0.12, excludeId, playhead } = {}) {
  const points = [0, ...(finite(playhead) ? [playhead] : []), ...sections.flatMap(key => (timeline[key] || []).filter(i => i.id !== excludeId).flatMap(i => [start(i), end(i)]))];
  const frameTime = Math.max(0, Math.round(time * fps) / fps);
  const nearby = points.filter(point => finite(point) && Math.abs(point - time) <= threshold).sort((a, b) => Math.abs(a - time) - Math.abs(b - time));
  return nearby[0] ?? frameTime;
}

/** Export-time narration policy; captions/shot notes are not audio by themselves.
 * This helper never changes the authoring document or downloads a speech model.
 */
export async function collectExportNarration(document, options = {}) {
  options.signal?.throwIfAborted();
  const duration = options.duration, mode = options.mode || "auto";
  if (!(Number.isFinite(duration) && duration > 0)) throw new RangeError("Narration requires a finite video duration.");
  const captions = [], shots = [];
  const enabled = (timeline, item) => item.enabled !== false && !timeline?.lanes?.some(l => l.id === item.laneId && l.muted);
  const audible = (timeline, item) => enabled(timeline, item) && (!item.linkedClipId || enabled(timeline, timeline?.clips?.find(c => c.id === item.linkedClipId) || {}));
  const append = (list, text, start, end, id) => {
    start = Math.max(0, start); end = Math.min(duration, end);
    if (typeof text === "string" && text.trim() && Number.isFinite(start) && Number.isFinite(end) && end > start) list.push({ id, text: text.trim(), start, duration: end - start });
  };
  const readCaptions = (timeline, offset = 0, sourceStart = 0, rate = 1, length = duration, prefix = "") => {
    for (const caption of timeline?.captions || []) {
      if (!audible(timeline, caption) || caption.narration === false) continue;
      const begin = caption.start || 0, end = begin + caption.duration;
      append(captions, caption.text, offset + Math.max(0, (begin - sourceStart) / rate),
        offset + Math.min(length, (end - sourceStart) / rate), `${prefix}${caption.id}`);
    }
  };
  readCaptions(document.timeline);
  if (document.documentType === "composition") for (const clip of document.timeline?.clips || []) {
    options.signal?.throwIfAborted();
    if (!enabled(document.timeline, clip)) continue;
    const offset = clip.start || 0;
    append(shots, document.production?.shots?.[clip.id]?.narration, offset, offset + clip.duration, clip.id);
    const scene = clip.source?.type === "media" ? null : typeof clip.source === "object" ? clip.source : document.scenes?.[clip.source] || await options.loadScene?.(clip.source);
    if (scene) readCaptions(scene.timeline, offset, clip.sourceStart || 0, clip.rate ?? 1, clip.duration, `${clip.id}/`);
  }
  let cues = mode === "custom" ? [{ id: "custom", text: String(options.text || "").trim(), start: 0, duration }]
    : mode === "shots" ? shots : mode === "captions" ? captions : captions.length ? captions : shots;
  const seen = new Set();
  cues = cues.filter(cue => {
    const key = JSON.stringify([cue.start, cue.text]);
    if (!cue.text || seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a, b) => a.start - b.start);
  // Don't double the explicitly tagged narration already authored by the Agent.
  const existing = (options.audioClips || []).filter(clip => clip.enabled !== false && (clip.narration === true || clip.recipe?.kind === "tts"));
  let skipped = 0;
  cues = cues.filter(cue => {
    const covered = existing.some(clip => (clip.start || 0) < cue.start + cue.duration && (clip.start || 0) + (clip.duration ?? duration) > cue.start);
    if (covered) skipped++;
    return !covered;
  });
  return { cues, skipped };
}

/** PCM-backed synthesis, atomic on failure/cancel. Never silently trim speech or
 * overlap adjacent subtitles. The user can shorten text or raise speech speed.
 */
export async function synthesizeExportNarration(plan, host, options = {}) {
  if (!host?.available || typeof host.narrate !== "function") throw Object.assign(new Error("No exportable speech engine is available."), { code: "LOCAL_NARRATION_UNAVAILABLE" });
  const clips = [];
  for (const [index, cue] of plan.cues.entries()) {
    options.signal?.throwIfAborted();
    const available = Math.min(cue.duration, (plan.cues[index + 1]?.start ?? Infinity) - cue.start);
    if (!(available > 0)) throw Object.assign(new Error(`Narration cue ${index + 1} overlaps another cue.`), { code: "NARRATION_CUES_OVERLAP", cue: index + 1 });
    options.onProgress?.({ stage: "narration", cue: index + 1, cues: plan.cues.length });
    let speed = options.speed ?? 1, result;
    // Resynthesize at a bounded faster rate, rather than chopping audio or
    // shifting subsequent cues. The caller owns the quality/speed limit.
    for (let attempt = 0; attempt < 3; attempt++) {
      options.signal?.throwIfAborted();
      result = await host.narrate({ text: cue.text, speed }, { signal: options.signal });
      options.signal?.throwIfAborted();
      if (!(Number.isFinite(result?.duration) && result.duration > 0 && result.cues?.length)) throw new Error("Local narration returned no audio.");
      if (result.duration <= available + 1e-6 || !(options.maxSpeed > speed)) break;
      speed = Math.min(options.maxSpeed, speed * result.duration / available * 1.03);
    }
    if (result.duration > available + 1e-6) throw Object.assign(new Error(`Narration cue ${index + 1} needs ${result.duration.toFixed(2)}s, but only ${available.toFixed(2)}s is available.`), { code: "NARRATION_EXCEEDS_CUE", cue: index + 1, required: result.duration, available });
    for (const [part, value] of result.cues.entries()) {
      if (!(Number.isFinite(value.start) && value.start >= 0 && Number.isFinite(value.duration) && value.duration > 0 && value.start + value.duration <= result.duration + 1e-6) || !/^data:audio\//.test(value.url)) throw new Error("Local narration needs measured timing and encoded PCM audio.");
      clips.push({ id: `$export-narration-${index}-${part}`, narration: true, start: cue.start + value.start, duration: value.duration, url: value.url });
    }
  }
  return clips;
}

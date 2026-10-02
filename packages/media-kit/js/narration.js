/** Synthesize sentence-sized cues; timing comes from PCM, never estimated words.
 * Data URLs persist across reloads and .tjz packing; no temporary blob URL is saved.
 */
export async function synthesizeNarration(text, producer, options = {}) {
  if (typeof text !== "string" || !text.trim() || !producer?.synthesize) throw new TypeError("Narration needs text and an installed PCM producer.");
  const { validatePcm, pcmDuration, encodeWav } = await import("@threejson/audio-kit");
  const sentences = text.match(/[^。！？!?\n]+[。！？!?]?|[^\s]/gu)?.map(s => s.trim()).filter(Boolean) || [];
  if (options.captionSentences !== undefined && (!Array.isArray(options.captionSentences) || options.captionSentences.length !== sentences.length || !options.captionSentences.every(s => typeof s === "string"))) throw new TypeError("captionSentences must match the spoken sentence count.");
  const cues = []; let start = 0;
  for (const [index, sentence] of sentences.entries()) {
    options.signal?.throwIfAborted();
    const key = JSON.stringify([producer.capabilities?.model, producer.capabilities?.modelVersion, sentence, options.speed ?? 1]);
    const cached = options.cache?.get(key);
    if (cached) { cues.push({ ...cached, text: options.captionSentences?.[index] ?? sentence, id: `narration-${index}`, start }); start += cached.duration; continue; }
    const pcm = validatePcm(await producer.synthesize({ kind: "tts", text: sentence, speed: options.speed ?? 1 }, options));
    options.signal?.throwIfAborted();
    const duration = pcmDuration(pcm), bytes = encodeWav(pcm), parts = [];
    for (let i = 0; i < bytes.length; i += 8192) parts.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
    cues.push({ id: `narration-${index}`, text: options.captionSentences?.[index] ?? sentence, start, duration, url: `data:audio/wav;base64,${btoa(parts.join(""))}` });
    options.cache?.set(key, { text: sentence, duration, url: cues.at(-1).url });
    start += duration; options.onProgress?.({ stage: "narration", sentence: index + 1, sentences: sentences.length, duration: start });
  }
  return { cues, duration: start, model: producer.capabilities?.model, modelVersion: producer.capabilities?.modelVersion };
}

/** Build one atomic project batch after synthesis has completely succeeded. */
export function createNarrationCommands(document, id, narration, { extend = false } = {}) {
  const clip = document.timeline.clips.find(c => c.id === id);
  const scene = typeof clip?.source === "string" ? document.scenes?.[clip.source] : clip?.source;
  if (!scene) throw new Error(`Embedded shot not found: ${id}`);
  if ((clip.rate ?? 1) !== 1 || (clip.sourceStart ?? 0) !== 0) throw new Error("Narration retiming requires an untrimmed, normal-rate shot.");
  if (!Number.isFinite(narration.duration) || narration.duration <= 0 || !narration.cues?.length) throw new Error("Narration has no measured duration.");
  if (narration.duration > clip.duration && !extend) throw Object.assign(new Error(`Narration lasts ${narration.duration.toFixed(2)}s, exceeding the ${clip.duration}s shot. Explicitly extend the shot or shorten the narration.`), { code: "NARRATION_EXCEEDS_SHOT" });
  const next = structuredClone(scene), duration = Math.max(clip.duration, narration.duration), delta = duration - clip.duration;
  next.timeline ??= {};
  if (delta > 0) {
    const scale = duration / clip.duration;
    for (const key of ["tracks", "effects", "captions"]) for (const item of next.timeline[key] || []) {
      if (item.start !== undefined) item.start *= scale;
      if (item.duration !== undefined) item.duration *= scale;
      if (item.signal?.duration !== undefined) item.signal.duration *= scale;
      for (const frame of item.keyframes || []) frame.time *= scale;
    }
  }
  next.timeline.duration = duration;
  next.timeline.audio = (next.timeline.audio || []).filter(c => c.narration !== true);
  next.timeline.captions = (next.timeline.captions || []).filter(c => c.narration !== true);
  for (const cue of narration.cues) {
    if (!(Number.isFinite(cue.start) && cue.start >= 0 && Number.isFinite(cue.duration) && cue.duration > 0 && cue.start + cue.duration <= duration + 1e-6) || typeof cue.url !== "string" || cue.url.startsWith("blob:")) throw new Error("Narration cue needs measured timing and a durable audio URL.");
    next.timeline.audio.push({ id: `${id}-${cue.id}-audio`, narration: true, start: cue.start, duration: cue.duration, url: cue.url });
    next.timeline.captions.push({ id: `${id}-${cue.id}-caption`, narration: true, text: cue.text, start: cue.start, duration: cue.duration, fontSize: 34, y: .9, maxWidth: .86 });
  }
  const commands = [{ op: "media.shot.put", args: { id, scene: next, clip: { duration }, metadata: { ...document.production?.shots?.[id], narrationDuration: narration.duration, narrationModel: narration.model, narrationModelVersion: narration.modelVersion } } }];
  if (delta > 0) {
    // Keep overlaps relative to this shot; earlier shots are not moved.
    for (const other of document.timeline.clips) if (other.id !== id && (other.start || 0) > (clip.start || 0)) commands.push({ op: "media.shot.put", args: { id: other.id, clip: { start: (other.start || 0) + delta } } });
    // Captions after this shot follow the ripple edit. Global music intentionally
    // stays in place; its looping/length is an independent editorial choice.
    const captions = (document.timeline.captions || []).filter(c => (c.start || 0) >= (clip.start || 0) + clip.duration).map(c => ({ ...c, start: c.start + delta }));
    if (captions.length) commands.push({ op: "timeline.edit", args: { section: "captions", upsert: captions } });
    commands.push({ op: "media.duration.set", args: { duration: (document.timeline.duration ?? Math.max(...document.timeline.clips.map(c => (c.start || 0) + c.duration))) + delta } });
  }
  return commands;
}

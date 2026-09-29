/** Musical ticks are authoring truth; seconds are compiled output, not rounded frames. */
export function compileScore(score) {
  if (score?.version !== 1) throw new TypeError("Score version must be 1.");
  const ppq = score.ppq ?? 480;
  if (!Number.isInteger(ppq) || ppq <= 0) throw new RangeError("PPQ must be a positive integer.");
  const tempos = (score.tempos || [{ tick: 0, bpm: 120 }]).map((entry) => ({ ...entry })).sort((a, b) => a.tick - b.tick);
  if (!tempos.length || tempos[0].tick !== 0) throw new Error("Tempo map must start at tick 0.");
  let seconds = 0;
  tempos.forEach((entry, i) => {
    if (!Number.isFinite(entry.tick) || entry.tick < 0 || !Number.isFinite(entry.bpm) || entry.bpm <= 0 || (i && entry.tick <= tempos[i-1].tick)) throw new Error("Invalid tempo map.");
    if (i) seconds += (entry.tick - tempos[i-1].tick) / ppq * 60 / tempos[i-1].bpm;
    entry.seconds = seconds;
  });
  const toSeconds = (tick) => {
    let lo = 0, hi = tempos.length;
    while (lo + 1 < hi) { const mid = (lo + hi) >>> 1; if (tempos[mid].tick <= tick) lo = mid; else hi = mid; }
    return tempos[lo].seconds + (tick - tempos[lo].tick) / ppq * 60 / tempos[lo].bpm;
  };
  const events = [], ids = new Set();
  for (const track of score.tracks || []) {
    if (!track.id || ids.has(track.id)) throw new Error("Score tracks require unique IDs.");
    ids.add(track.id);
    if (!Number.isFinite(track.gain ?? 1) || (track.gain ?? 1) < 0 || !Number.isFinite(track.pan ?? 0) || Math.abs(track.pan ?? 0) > 1) throw new Error(`Invalid gain/pan: ${track.id}`);
    const noteIds = new Set();
    const ordered = (track.notes || []).map((note) => ({ ...note })).sort((a, b) => a.tick - b.tick);
    const tied = new Map();
    for (const note of ordered) {
      if (!note.id || noteIds.has(note.id)) throw new Error(`Track ${track.id}: notes require unique IDs.`);
      noteIds.add(note.id);
      if (!Number.isFinite(note.tick) || note.tick < 0 || !Number.isFinite(note.duration) || note.duration <= 0 || !Number.isFinite(note.pitch) || note.pitch < 0 || note.pitch > 127) throw new Error(`Invalid note: ${note.id}`);
      const velocity = note.velocity ?? .7;
      if (!Number.isFinite(velocity) || velocity < 0 || velocity > 1) throw new Error(`Invalid velocity: ${note.id}`);
      const prior = note.tie && tied.get(note.tie);
      if (prior) {
        if (prior.pitch !== note.pitch || prior.endTick !== note.tick) throw new Error(`Tie ${note.tie} must join adjacent notes of equal pitch.`);
        prior.endTick += note.duration; prior.duration = toSeconds(prior.endTick) - prior.start;
      } else {
        const event = { ...note, trackId: track.id, instrument: track.instrument || "sine", gain: track.gain ?? 1, pan: track.pan ?? 0, velocity, start: toSeconds(note.tick), duration: toSeconds(note.tick + note.duration) - toSeconds(note.tick), endTick: note.tick + note.duration };
        events.push(event); if (note.tie) tied.set(note.tie, event);
      }
    }
  }
  // Explicit repeat regions are unfolded without a hidden iteration limit.
  // Tempo is already resolved in each source region; offsets repeat its duration.
  const repeats = [...(score.repeats || [])].sort((a, b) => a.startTick - b.startTick);
  let offset = 0, previousEnd = 0;
  for (const region of repeats) {
    if (!Number.isSafeInteger(region.count) || region.count < 1 || !Number.isFinite(region.startTick) || !Number.isFinite(region.endTick) || !(region.endTick > region.startTick) || region.startTick < previousEnd) throw new Error("Repeat regions must be ordered, non-overlapping and have a positive integer count.");
    previousEnd = region.endTick;
    const start = toSeconds(region.startTick) + offset, end = toSeconds(region.endTick) + offset, length = end - start;
    const inside = events.filter((event) => event.start >= start && event.start < end);
    if (events.some((event) => event.start < end && event.start + event.duration > end + 1e-8)) throw new Error("A note/tie crosses a repeat boundary; split the phrase explicitly.");
    for (const event of events) if (event.start >= end) event.start += length * (region.count - 1);
    for (let i = 1; i < region.count; i++) for (const event of inside) events.push({ ...event, id: `${event.id}@${i}`, start: event.start + length * i });
    offset += length * (region.count - 1);
  }
  events.sort((a, b) => a.start - b.start || a.trackId.localeCompare(b.trackId));
  return { version: 1, events, duration: events.reduce((end, event) => Math.max(end, event.start + event.duration), 0), ppq };
}

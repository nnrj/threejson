/** Explicit scene time. No wall clock, browser, renderer or scheduling dependency. */
export function createSceneClock(options = {}) {
  const duration = options.duration ?? Infinity;
  if (!(duration >= 0) || (duration !== Infinity && !Number.isFinite(duration))) throw new TypeError("Invalid clock duration.");
  let time = 0, playing = false, rate = options.rate ?? 1;
  const loop = options.loop === true;
  if (!Number.isFinite(rate) || rate < 0) throw new TypeError("Clock rate must be finite and nonnegative.");
  if (loop && !(Number.isFinite(duration) && duration > 0)) throw new TypeError("A looping clock requires a positive finite duration.");
  const seek = (value) => {
    if (!Number.isFinite(value) || value < 0) throw new TypeError("Scene time must be finite and nonnegative.");
    time = Math.min(value, duration);
    return time;
  };
  seek(options.time ?? 0);
  return {
    get time() { return time; }, get duration() { return duration; }, get playing() { return playing; }, get rate() { return rate; },
    play() { playing = true; }, pause() { playing = false; }, seek,
    reset() { playing = false; time = 0; },
    setRate(value) { if (!Number.isFinite(value) || value < 0) throw new TypeError("Invalid playback rate."); rate = value; },
    advance(delta) {
      if (!Number.isFinite(delta) || delta < 0) throw new TypeError("Clock delta must be finite and nonnegative.");
      if (!playing) return time;
      const next = time + delta * rate;
      if (loop) time = next % duration;
      else { time = Math.min(next, duration); if (time === duration) playing = false; }
      return time;
    }
  };
}

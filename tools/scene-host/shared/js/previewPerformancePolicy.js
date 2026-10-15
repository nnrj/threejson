/** Reference host policy. The engine accepts its numerical budgets, not these names. */
export const PREVIEW_PROFILES = Object.freeze({
  full: Object.freeze({ mode: "full", maxPixelRatio: Infinity, maxPixels: Infinity, maxPoints: Infinity, lodBias: 1 }),
  balanced: Object.freeze({ mode: "balanced", maxPixelRatio: 1.25, maxPixels: 960 * 540, maxPoints: 100000, lodBias: 1.25 }),
  economy: Object.freeze({ mode: "economy", maxPixelRatio: 1, maxPixels: 720 * 405, maxPoints: 40000, lodBias: 1.75 })
});
export function resolvePreviewPerformance(mode = "full", device = {}, profiles = PREVIEW_PROFILES) {
  if (mode === "auto") {
    const nav = device.navigator ?? globalThis.navigator;
    const memory = Number(nav?.deviceMemory), cores = Number(nav?.hardwareConcurrency);
    const coarse = device.coarsePointer ?? globalThis.matchMedia?.("(pointer: coarse)")?.matches;
    mode = (memory > 0 && memory <= 4) || (cores > 0 && cores <= 4) ? "economy"
      : coarse || (memory > 0 && memory <= 8) ? "balanced" : "full";
  }
  if (!Object.hasOwn(profiles, mode)) throw new RangeError(`Unknown preview performance mode: ${mode}`);
  return { ...profiles[mode], mode };
}

/** Device hints only select a starting point. Measured continuous frame times
 * can recover quality. Point/LOD changes require separate, explicit permission. */
export function createHostPreviewPerformance(mode = "auto", options = {}) {
  if (mode === "full" || mode === false) return undefined;
  if (typeof mode === "object") return mode;
  const profiles = options.profiles || PREVIEW_PROFILES, order = ["full", "balanced", "economy"];
  let current = order.indexOf(resolvePreviewPerformance(mode, options.device, profiles).mode);
  const target = 1000 / (options.targetFps || 60), samples = options.samples ?? 30;
  const downWindows = options.downWindows ?? 2, upWindows = options.upWindows ?? 6;
  let frames = 0, sum = 0, slow = 0, fast = 0;
  const resetFeedback = () => { frames = sum = slow = fast = 0; };
  return {
    get mode() { return order[current]; },
    getBudget() {
      const p = profiles[order[current]];
      return { ...p, maxPoints: options.allowPointSampling === true ? p.maxPoints : Infinity, lodBias: options.allowLod === true ? p.lodBias : 1 };
    },
    resetFeedback,
    onFrame({ workTimeMs, frameIntervalMs, realtime = false, targetFrameMs } = {}) {
      if (mode !== "auto" || !realtime) return;
      const expected = targetFrameMs || target;
      // Pauses/background tabs and loading stalls are not steady rendering load.
      if (!Number.isFinite(workTimeMs) || workTimeMs < 0 || workTimeMs > (options.maxSampleMs ?? 250) || (frameIntervalMs != null && (!Number.isFinite(frameIntervalMs) || frameIntervalMs <= 0 || frameIntervalMs > (options.maxSampleMs ?? 250)))) { resetFeedback(); return; }
      sum += Math.max(workTimeMs, frameIntervalMs || 0) / expected;
      if (++frames < samples) return;
      const cost = sum / frames; frames = sum = 0;
      slow = cost > (options.downThreshold ?? 1.35) ? slow + 1 : 0;
      fast = cost < (options.upThreshold ?? 1.1) ? fast + 1 : 0;
      const next = slow >= downWindows ? Math.min(2, current + 1) : fast >= upWindows ? Math.max(0, current - 1) : current;
      if (next !== current) { current = next; resetFeedback(); options.onChange?.({ mode: order[current], budget: this.getBudget() }); }
    }
  };
}

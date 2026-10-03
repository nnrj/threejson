// Troika's sync API only has a success callback. A failed font request or
// worker can otherwise leave it pending forever (including after disposal).
export const DEFAULT_TEXT_LOAD_TIMEOUT_MS = 15000;

export function waitForSdfText(text, { signals = [], root = text, timeoutMs = DEFAULT_TEXT_LOAD_TIMEOUT_MS } = {}) {
  if (timeoutMs !== 0 && timeoutMs !== Infinity && (!Number.isFinite(timeoutMs) || timeoutMs < 0)) timeoutMs = DEFAULT_TEXT_LOAD_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const active = [...new Set(signals.filter(Boolean))];
    let settled = false, failed = false, timer;
    const originalDispose = text.dispose;
    const dispose = function (...args) { onDispose(); return originalDispose.apply(this, args); };
    const cleanup = () => {
      clearTimeout(timer);
      for (const signal of active) signal.removeEventListener("abort", onAbort);
      root.removeEventListener?.("removed", onDispose);
      if (text.dispose === dispose) text.dispose = originalDispose;
    };
    const finish = (error) => {
      if (settled) return;
      settled = true; failed = Boolean(error); cleanup();
      if (error) reject(error); else resolve(text);
    };
    const onAbort = () => finish(active.find(signal => signal.aborted)?.reason || new DOMException("Text preparation cancelled.", "AbortError"));
    const onDispose = () => finish(new DOMException("Text disposed during preparation.", "AbortError"));
    if (active.some(signal => signal.aborted)) { onAbort(); return; }
    for (const signal of active) signal.addEventListener("abort", onAbort, { once: true });
    // Troika itself disposes/reallocates geometry during a successful sync;
    // only object removal/disposal, not geometry's event, means cancellation.
    text.dispose = dispose;
    root.addEventListener?.("removed", onDispose);
    // A host may extend the deadline, or opt out with 0/Infinity. This is an
    // I/O liveness policy, not a limit on text length or scene complexity.
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) timer = setTimeout(() => finish(Object.assign(
      new Error(`SDF text preparation timed out after ${timeoutMs} ms. Check font URLs, CORS and worker availability.`),
      { code: "TEXT_SDF_TIMEOUT", name: "TimeoutError" }
    )), timeoutMs);
    try {
      text.sync(() => {
        // A late callback must not resurrect a disposed/replaced mesh.
        if (settled && failed) text.dispose();
        else finish();
      });
    } catch (error) { finish(error); }
  });
}

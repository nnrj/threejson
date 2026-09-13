/** Renderer/host-independent resource leases. No request is made until acquire(). */
export function createAssetResolver(options = {}) {
  const entries = new Map();
  let disposed = false;
  const notify = (entry) => {
    try { options.onEvent?.({ source: entry.request.source, kind: entry.request.kind, state: entry.state, error: entry.error }); }
    catch { /* diagnostics must not change resource ownership */ }
  };
  const destroy = (entry) => {
    if (entry.destroyed) return;
    entry.destroyed = true;
    if (entries.get(entry.key) === entry) entries.delete(entry.key);
    entry.controller.abort();
    if (entry.value !== undefined) entry.disposeValue?.(entry.value);
    entry.releaseSource?.();
  };
  function acquire(request, hooks = {}) {
    if (disposed) throw new Error("AssetResolver is disposed.");
    if (!request || typeof request.source !== "string" || !request.source.trim()) throw new TypeError("Asset source is required.");
    const key = JSON.stringify([request.kind || "binary", request.source, request.variant || "", request.replicas || []]);
    let entry = entries.get(key);
    if (!entry || entry.state === "error" || entry.state === "cancelled") {
      entry = { key, request: { ...request }, state: "loading", references: 0, controller: new AbortController(), disposeValue: hooks.dispose || options.dispose };
      entries.set(key, entry);
      const current = entry;
      current.promise = Promise.resolve().then(async () => {
        const signal = current.controller.signal;
        signal.throwIfAborted();
        const resolved = await (hooks.resolve || options.resolve || ((item) => item.replicas?.length ? [...item.replicas, item.source] : [item.source]))(current.request, { signal });
        const candidates = (Array.isArray(resolved) ? resolved : [resolved]).filter(Boolean).map((value) => {
          let released = false;
          return { url: typeof value === "string" ? value : value.url, release() {
            if (!released) { released = true; value?.release?.(); }
          } };
        });
        let failure;
        try { for (const candidate of candidates) {
          const source = candidate.url;
          signal.throwIfAborted();
          try {
            const load = hooks.load || options.load || (async (url, context) => {
              const response = await (options.fetch || globalThis.fetch)(url, { signal: context.signal });
              if (!response.ok) throw Object.assign(new Error(`Resource returned HTTP ${response.status}`), { status: response.status });
              return response.arrayBuffer();
            });
            const value = await load(source, { signal, request: current.request });
            if (current.destroyed || signal.aborted) {
              current.disposeValue?.(value);
              signal.throwIfAborted();
              throw new DOMException("Resource released.", "AbortError");
            }
            current.value = value;
            current.releaseSource = candidate.release;
            current.resolvedSource = source;
            current.state = "ready";
            notify(current);
            return value;
          } catch (error) { failure = error; }
          candidate.release();
        } } finally {
          for (const candidate of candidates) if (candidate.release !== current.releaseSource) candidate.release();
        }
        throw failure || new Error(`No resource candidate for ${request.source}`);
      }).catch((error) => {
        current.error = error;
        current.state = current.controller.signal.aborted ? "cancelled" : "error";
        if (entries.get(key) === current) entries.delete(key);
        notify(current);
        throw error;
      });
      // Callers may release a lease before observing it. Their promise still rejects, but
      // the resolver itself never leaves an unhandled rejection behind.
      current.promise.catch(() => {});
      notify(current);
    }
    entry.references++;
    const owned = entry;
    let released = false;
    let rejectReleased;
    const promise = Promise.race([owned.promise, new Promise((_, reject) => { rejectReleased = reject; })]);
    promise.catch(() => {});
    const release = () => {
      if (released) return;
      released = true;
      hooks.signal?.removeEventListener("abort", release);
      rejectReleased(hooks.signal?.reason || new DOMException("Resource lease released.", "AbortError"));
      owned.references--;
      if (owned.references === 0 && (options.retainReady !== true || owned.state !== "ready")) destroy(owned);
    };
    if (hooks.signal?.aborted) release();
    else hooks.signal?.addEventListener("abort", release, { once: true });
    return {
      promise,
      get state() { return released ? "released" : owned.state; },
      get value() { return owned.value; },
      get resolvedSource() { return owned.resolvedSource; },
      retain: () => acquire(request, { ...hooks, signal: undefined }),
      release
    };
  }
  return {
    acquire,
    inspect: () => [...entries.values()].map(({ request, state, references }) => ({ source: request.source, kind: request.kind, state, references })),
    clear() { for (const entry of [...entries.values()]) if (!entry.references) destroy(entry); },
    dispose() { disposed = true; for (const entry of [...entries.values()]) destroy(entry); }
  };
}

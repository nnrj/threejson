/** Host-owned live viewport budget. Documents/history are never owned by the pool. */
export function createSceneViewportPool({ limit = 1 } = {}) {
  const entries = new Map();
  let queue = Promise.resolve(), maximum = Math.max(1, Math.floor(Number(limit) || 1)), order = 0;
  const serialize = (callback) => {
    const task = queue.then(callback); queue = task.catch(() => {}); return task;
  };
  const trim = async (keep) => {
    const active = [...entries.entries()].filter(([, entry]) => entry.active && entry !== keep).sort((a, b) => a[1].used - b[1].used);
    while ([...entries.values()].filter((entry) => entry.active).length > maximum && active.length) {
      const [, entry] = active.shift();
      await entry.suspend(); entry.active = false;
    }
  };
  return {
    register(key, suspend) {
      if (entries.has(key)) throw new Error("Viewport already registered.");
      entries.set(key, { suspend, active: false, used: 0 });
      return () => entries.delete(key);
    },
    run(key, callback, limitOverride) {
      return serialize(async () => {
        const entry = entries.get(key);
        if (!entry) throw new DOMException("Viewport is no longer registered.", "AbortError");
        if (limitOverride != null) maximum = Math.max(1, Math.floor(Number(limitOverride) || 1));
        const wasActive = entry.active; entry.active = true; entry.used = ++order;
        try { await trim(entry); return await callback(); }
        catch (error) { entry.active = wasActive; throw error; }
      });
    },
    suspend(key) { return serialize(async () => { const entry = entries.get(key); if (entry) { await entry.suspend(); entry.active = false; } }); },
    setLimit(value) { return serialize(async () => { maximum = Math.max(1, Math.floor(Number(value) || 1)); await trim(); }); },
    inspect() { return { limit: maximum, registered: entries.size, active: [...entries.values()].filter((entry) => entry.active).length }; }
  };
}

export const sharedSceneViewportPool = createSceneViewportPool();

/** Small preview for dormant cards; pixels are not the authoritative scene snapshot. */
export function captureSceneCardPreview(runtime, canvas, { width = 640 } = {}) {
  if (!canvas || typeof document === "undefined") return null;
  try {
    runtime?.renderOnce?.();
    const preview = document.createElement("canvas");
    preview.width = Math.min(width, canvas.width || width);
    preview.height = Math.max(1, Math.round(preview.width * (canvas.height || 180) / (canvas.width || 320)));
    const context = preview.getContext("2d");
    if (!context) return null;
    context.drawImage(canvas, 0, 0, preview.width, preview.height);
    return preview.toDataURL("image/webp", 0.82);
  } catch { return null; } // CORS/unsupported encoders leave an explicit activate button, not a black canvas.
}

const preparers = new Map();

export function registerSceneCapabilityPreparer(id, prepare) {
  const key = typeof id === "string" ? id.trim() : "";
  if (!key || typeof prepare !== "function") throw new Error("[scenePreparer] id and prepare function are required");
  preparers.set(key, prepare);
}

export function unregisterSceneCapabilityPreparer(id) {
  return preparers.delete(String(id || "").trim());
}

/** A load owns its optional prepared resources; no process-global asset state. */
export function createPreparedCapabilityStore() {
  const entries = [];
  let disposed = false;
  return {
    add(id, resources) {
      if (!resources) return;
      if (disposed) { resources.dispose?.(); throw new DOMException("Preparation disposed.", "AbortError"); }
      entries.push({ id, resources });
    },
    find(id, select = (value) => value) {
      if (disposed) return undefined;
      for (let i = entries.length - 1; i >= 0; i--) if (entries[i].id === id) {
        const value = select(entries[i].resources);
        if (value !== undefined && value !== null) return value;
      }
      return undefined;
    },
    adopt(other) { for (const entry of other.take()) this.add(entry.id, entry.resources); },
    take() { return entries.splice(0); },
    dispose() {
      if (disposed) return; disposed = true;
      for (const { resources } of entries.splice(0).reverse()) {
        try { resources.dispose?.(); } catch { /* release the remaining independent preparations */ }
      }
    }
  };
}

export async function runSceneCapabilityPreparers(payload, options = {}) {
  const resources = createPreparedCapabilityStore();
  try {
    for (const [id, prepare] of preparers) {
      options.signal?.throwIfAborted();
      resources.add(id, await prepare(payload, { ...options, preparerId: id }));
    }
    options.signal?.throwIfAborted();
    return resources;
  } catch (error) { resources.dispose(); throw error; }
}

export function _clearSceneCapabilityPreparersForTests() {
  preparers.clear();
}

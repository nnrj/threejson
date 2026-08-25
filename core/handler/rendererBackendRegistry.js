const backends = new Map();

function normalize(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function registerRendererBackend(id, definition) {
  const key = normalize(id);
  if (!key || !definition || typeof definition.createRenderer !== "function") {
    throw new Error("[rendererBackend] id and createRenderer are required");
  }
  backends.set(key, { ...definition, id: key });
}

export function unregisterRendererBackend(id) {
  return backends.delete(normalize(id));
}

export function getRendererBackend(id) {
  const definition = backends.get(normalize(id));
  return definition ? { ...definition } : null;
}

export function hasRendererBackend(id) {
  return backends.has(normalize(id));
}

/** Resolve a runtime renderer to a backend id without teaching core about implementation flags.
 * Optional adapters may tag their renderer with `__threeJsonBackend` and/or provide
 * `matchesRenderer(renderer)` when they register. */
export function detectRendererBackend(renderer, fallback = "webgl") {
  const tagged = normalize(renderer?.__threeJsonBackend);
  if (tagged) return tagged;
  for (const [id, definition] of backends) {
    if (typeof definition.matchesRenderer === "function" && definition.matchesRenderer(renderer)) {
      return id;
    }
  }
  return normalize(fallback) || "webgl";
}

/** Whether a backend supplies its own post-processing/composer implementation. */
export function rendererBackendOwnsPostProcessing(rendererOrId) {
  const id = typeof rendererOrId === "string"
    ? normalize(rendererOrId)
    : detectRendererBackend(rendererOrId);
  const definition = backends.get(id);
  return typeof definition?.ownsPostProcessing === "function"
    ? definition.ownsPostProcessing(rendererOrId) === true
    : definition?.ownsPostProcessing === true;
}

/** Ask a registered backend whether one compatibility policy selects a whole-scene fallback.
 * Core validates the returned backend independently; adapters cannot bypass capability checks. */
export function resolveRendererBackendFallback(id, context = {}) {
  const definition = backends.get(normalize(id));
  if (typeof definition?.resolveFallback !== "function") return null;
  const result = definition.resolveFallback({ ...context, backend: normalize(id) });
  if (result && typeof result.then === "function") {
    throw new Error("[rendererBackend] resolveFallback must be synchronous");
  }
  return normalize(result) || null;
}

export async function createRendererFromRegisteredBackend(id, context) {
  const backend = getRendererBackend(id);
  if (!backend) {
    const error = new Error(`Renderer backend is not registered: ${id}. Import its optional ThreeJSON entry first.`);
    error.code = "E_RENDERER_BACKEND_UNAVAILABLE";
    error.backend = normalize(id);
    throw error;
  }
  const result = await backend.createRenderer(context);
  const renderer = result?.renderer ?? result;
  if (!renderer || typeof renderer.render !== "function") {
    throw new Error(`[rendererBackend] ${id} returned no renderer`);
  }
  return result?.renderer ? result : { renderer };
}

export function _clearRendererBackendsForTests() {
  backends.clear();
}

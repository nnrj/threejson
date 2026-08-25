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


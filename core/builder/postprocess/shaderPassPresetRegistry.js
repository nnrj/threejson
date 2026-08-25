const presets = new Map();

function normalizeId(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Register a ShaderPass-safe preset. Definition may be a Three.js shader object or a factory
 * returning one. Raw shader source remains host code and is never evaluated from scene JSON.
 */
export function registerShaderPassPreset(id, definition) {
  const key = normalizeId(id);
  if (!key || (!definition || (typeof definition !== "object" && typeof definition !== "function"))) {
    throw new Error("[shaderPassPreset] id and shader definition are required");
  }
  presets.set(key, definition);
}

export function unregisterShaderPassPreset(id) {
  return presets.delete(normalizeId(id));
}

export function getShaderPassPreset(id) {
  return presets.get(normalizeId(id)) ?? null;
}

export function resolveShaderPassPreset(id, record = {}, ctx = {}) {
  const definition = getShaderPassPreset(id);
  return typeof definition === "function" ? definition(record, ctx) : definition;
}

export function _clearShaderPassPresetsForTests() {
  presets.clear();
}


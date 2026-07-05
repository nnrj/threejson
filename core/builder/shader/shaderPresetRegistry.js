import { log } from "../../util/logger.js";
/**
 * Shader preset registry: preset id → createMaterial / updateUniforms (registered by core or domain at startup).
 * JSON references preset id + uniforms only; does not include GLSL strings.
 */

/** @typedef {{
 *   schema?: Record<string, string>,
 *   defaultUniforms?: Record<string, unknown>,
 *   createMaterial: (uniforms: Record<string, unknown>, ctx?: object) => import("three").ShaderMaterial|null,
 *   updateUniforms?: (material: import("three").ShaderMaterial, ctx: object) => void,
 *   dispose?: (material: import("three").ShaderMaterial) => void
 * }} ShaderPresetDefinition */

/** @type {Map<string, ShaderPresetDefinition>} */
const presetsById = new Map();

/**
 * @param {string} presetId
 * @returns {string}
 */
function normalizePresetId(presetId) {
  return typeof presetId === "string" ? presetId.trim() : "";
}

/**
 * @param {string} presetId
 * @param {ShaderPresetDefinition} definition
 */
export function registerShaderPreset(presetId, definition) {
  const key = normalizePresetId(presetId);
  if (!key) {
    throw new Error("[shaderPreset] registerShaderPreset requires presetId");
  }
  if (!definition || typeof definition.createMaterial !== "function") {
    throw new Error("[shaderPreset] registerShaderPreset requires createMaterial");
  }
  presetsById.set(key, definition);
}

/**
 * @param {string} presetId
 * @returns {ShaderPresetDefinition|null}
 */
export function getShaderPreset(presetId) {
  const key = normalizePresetId(presetId);
  return key ? presetsById.get(key) ?? null : null;
}

/**
 * @param {string} presetId
 * @returns {boolean}
 */
export function hasShaderPreset(presetId) {
  return Boolean(getShaderPreset(presetId));
}

/**
 * @param {Record<string, unknown>|undefined} base
 * @param {Record<string, unknown>|undefined} overrides
 * @returns {Record<string, unknown>}
 */
export function mergeShaderUniforms(base, overrides) {
  const out = base && typeof base === "object" && !Array.isArray(base) ? { ...base } : {};
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    return out;
  }
  for (const key of Object.keys(overrides)) {
    out[key] = overrides[key];
  }
  return out;
}

/**
 * @param {object|null|undefined} descriptor
 * @returns {string}
 */
export function resolveShaderPresetIdFromDescriptor(descriptor) {
  const raw = descriptor?.shaderPreset ?? descriptor?.material?.shaderPreset;
  return normalizePresetId(typeof raw === "string" ? raw : "");
}

/**
 * @param {string} presetId
 * @param {object} [descriptor]
 * @param {object} [ctx]
 * @returns {import("three").ShaderMaterial|null}
 */
export function createShaderMaterialFromPreset(presetId, descriptor = {}, ctx = {}) {
  const key = normalizePresetId(presetId) || resolveShaderPresetIdFromDescriptor(descriptor);
  const preset = getShaderPreset(key);
  if (!preset) {
    log.warn("[shaderPreset] unknown preset:", key || presetId);
    return null;
  }
  const uniforms = mergeShaderUniforms(
    preset.defaultUniforms,
    descriptor?.uniforms && typeof descriptor.uniforms === "object" && !Array.isArray(descriptor.uniforms)
      ? descriptor.uniforms
      : {}
  );
  return preset.createMaterial(uniforms, ctx);
}

/** For unit tests only */
export function _clearShaderPresetsForTests() {
  presetsById.clear();
}

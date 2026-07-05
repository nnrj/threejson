/** @typedef {'runtime' | 'document'} CommandMode */

/**
 * @typedef {object} CommandContext
 * @property {import("three").Scene | null} [scene]
 * @property {import("three").Camera | null} [camera]
 * @property {import("three").WebGLRenderer | null} [renderer]
 * @property {object | null} [controls]
 * @property {object | null} [document] Scene JSON payload when no live runtime is required.
 * @property {object} [options]
 */

/**
 * @typedef {object} ParsedCommand
 * @property {number} [v]
 * @property {string} op
 * @property {object} args
 */

/**
 * @typedef {object} CommandResult
 * @property {boolean} ok
 * @property {string} op
 * @property {CommandMode} [mode]
 * @property {object} [data]
 * @property {string | null} [error]
 * @property {string[]} [warnings]
 */

/**
 * @typedef {object} CommandSpec
 * @property {string} op
 * @property {CommandMode} mode
 * @property {string} summary
 * @property {Record<string, string>} args
 * @property {object} [example]
 */

export const COMMAND_API_VERSION = 1;

export const RUNTIME_OPS = new Set([
  "scene.load",
  "scene.export",
  "scene.list",
  "object.add",
  "object.remove",
  "object.patch",
  "object.get",
  "object.reconcile",
  "material.patch",
  "camera.fit"
]);

export const DOCUMENT_OPS = new Set(["scene.validate", "scene.applyPatch"]);

/**
 * @param {Partial<CommandContext>} [init]
 * @returns {CommandContext}
 */
export function createCommandContext(init = {}) {
  return {
    scene: init.scene ?? null,
    camera: init.camera ?? null,
    renderer: init.renderer ?? null,
    controls: init.controls ?? null,
    document: init.document ?? null,
    options: init.options && typeof init.options === "object" ? { ...init.options } : {}
  };
}

/**
 * @param {string} op
 * @returns {CommandMode}
 */
export function resolveCommandMode(op) {
  const key = String(op ?? "").trim();
  if (DOCUMENT_OPS.has(key)) {
    return "document";
  }
  if (RUNTIME_OPS.has(key)) {
    return "runtime";
  }
  return "runtime";
}

/**
 * @param {string} op
 * @param {Partial<CommandResult>} fields
 * @returns {CommandResult}
 */
export function buildCommandResult(op, fields = {}) {
  return {
    ok: Boolean(fields.ok),
    op: String(op || "").trim(),
    mode: fields.mode,
    data: fields.data,
    error: fields.error ?? null,
    warnings: Array.isArray(fields.warnings) ? fields.warnings : undefined
  };
}

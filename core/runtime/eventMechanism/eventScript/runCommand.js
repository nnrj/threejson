/**
 * EventScript `run` → executeCommand bridge with allowedCommands whitelist (M3b).
 */

import { executeCommand } from "../../../command/executor.js";
import { parseCommandLine } from "../../../command/parser.js";
import { createCommandContext, DOCUMENT_OPS } from "../../../command/types.js";
import { log } from "../../../util/logger.js";
import { resolveEventScriptAllowedCommands } from "./config.js";

/** @readonly */
export const EVENT_SCRIPT_FORBIDDEN_COMMANDS = new Set([
  ...DOCUMENT_OPS,
  "scene.load",
  "scene.export",
  "scene.list",
  "material.patch",
  "camera.fit"
]);

/**
 * @param {string} op
 * @param {object|null|undefined} sceneConfig
 * @returns {boolean}
 */
export function isEventScriptCommandAllowed(op, sceneConfig) {
  const key = typeof op === "string" ? op.trim() : "";
  if (!key || EVENT_SCRIPT_FORBIDDEN_COMMANDS.has(key)) {
    return false;
  }
  const allowed = new Set(resolveEventScriptAllowedCommands(sceneConfig));
  return allowed.has(key);
}

/**
 * @param {object} dispatchCtx
 * @param {object} [options]
 * @returns {import("../../../command/types.js").CommandContext}
 */
export function createEventScriptCommandContext(dispatchCtx, options = {}) {
  const runtime = dispatchCtx.sceneRuntime ?? null;
  return createCommandContext({
    scene: dispatchCtx.scene ?? runtime?.scene ?? null,
    camera: dispatchCtx.camera ?? runtime?.camera ?? null,
    renderer: dispatchCtx.renderer ?? runtime?.renderer ?? null,
    controls: dispatchCtx.controls ?? runtime?.controls ?? null,
    options: options.commandOptions ?? {}
  });
}

/**
 * @param {string} commandText
 * @param {object} dispatchCtx
 * @param {object} [options]
 * @returns {Promise<import("../../../command/types.js").CommandResult>}
 */
export async function runEventScriptCommand(commandText, dispatchCtx, options = {}) {
  const sceneConfig = options.sceneConfig ?? dispatchCtx.sceneConfig ?? dispatchCtx.sceneRuntime?.sceneConfig;
  let parsed;
  try {
    parsed = parseCommandLine(String(commandText ?? "").trim());
  } catch (error) {
    log.warn("[eventMechanism] run command parse failed", { commandText, error });
    return { ok: false, op: "", error: String(error?.message || error) };
  }
  if (!isEventScriptCommandAllowed(parsed.op, sceneConfig)) {
    log.warn("[eventMechanism] run command blocked by whitelist", { op: parsed.op });
    return { ok: false, op: parsed.op, error: `command not allowed: ${parsed.op}` };
  }
  const ctx = createEventScriptCommandContext(dispatchCtx, options);
  const result = await executeCommand(ctx, parsed);
  if (!result.ok) {
    log.warn("[eventMechanism] run command failed", { op: parsed.op, error: result.error });
  }
  return result;
}

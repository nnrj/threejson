/**
 * Resolve EventScript execution mode from sceneConfig.
 */

/** @readonly */
export const DEFAULT_EVENT_SCRIPT_ALLOWED_COMMANDS = Object.freeze([
  "object.patch",
  "object.get",
  "object.reconcile",
  "object.add",
  "object.remove"
]);

/**
 * @param {object|null|undefined} sceneConfig
 * @param {object|null|undefined} [eventConfig]
 * @returns {'dsl'|'javascript'}
 */
export function resolveEventScriptMode(sceneConfig, eventConfig = null) {
  const bindingMode = eventConfig?.mode;
  if (typeof bindingMode === "string" && bindingMode.trim().toLowerCase() === "javascript") {
    return "javascript";
  }
  if (typeof bindingMode === "string" && bindingMode.trim().toLowerCase() === "dsl") {
    return "dsl";
  }
  const mode = sceneConfig?.eventScript?.mode;
  if (typeof mode === "string" && mode.trim().toLowerCase() === "javascript") {
    return "javascript";
  }
  return "dsl";
}

/**
 * @param {object|null|undefined} sceneConfig
 * @returns {number}
 */
export function resolveEventScriptStepLimit(sceneConfig) {
  const raw = sceneConfig?.eventScript?.maxSteps;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) {
    return Math.floor(n);
  }
  return 1000;
}

/**
 * @param {object|null|undefined} sceneConfig
 * @returns {string[]}
 */
export function resolveEventScriptAllowedCommands(sceneConfig) {
  const custom = sceneConfig?.eventScript?.allowedCommands;
  if (Array.isArray(custom) && custom.length > 0) {
    return custom
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean);
  }
  return [...DEFAULT_EVENT_SCRIPT_ALLOWED_COMMANDS];
}

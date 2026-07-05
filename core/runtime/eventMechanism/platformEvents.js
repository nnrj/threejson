/**
 * Core platform event catalog — the only event names ELM may listen for or bind.
 * Domains must not register extension names here.
 */

/** @readonly */
export const PLATFORM_EVENT_NAMES = Object.freeze([
  "click",
  "dblclick",
  "pointerdown",
  "pointerup",
  "pointerover",
  "pointerout",
  "keydown",
  "keyup",
  "scene.ready",
  "scene.dispose",
  "object.ready",
  "object.dispose"
]);

/** @type {ReadonlySet<string>} */
export const PLATFORM_EVENT_SET = new Set(PLATFORM_EVENT_NAMES);

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizePlatformEventName(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {unknown} eventName
 * @returns {boolean}
 */
export function isPlatformEventName(eventName) {
  const key = normalizePlatformEventName(eventName);
  return key.length > 0 && PLATFORM_EVENT_SET.has(key);
}

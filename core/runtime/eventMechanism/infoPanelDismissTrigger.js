/**
 * Resolve infoPanel dismiss from fix (primary) and dismissTrigger (advanced when fix:false).
 */

import { normalizePlatformEventName } from "./platformEvents.js";

const DISMISS_TRIGGER_VALUES = new Set(["none", "click", "dblclick", "keydown"]);

function normalizeText(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function hasOwn(record, key) {
  return Boolean(record && Object.prototype.hasOwnProperty.call(record, key));
}

/**
 * @param {unknown} value
 * @returns {'none'|'click'|'dblclick'|'keydown'}
 */
export function normalizeDismissTrigger(value) {
  const key = normalizeText(value);
  if (DISMISS_TRIGGER_VALUES.has(key)) {
    return /** @type {'none'|'click'|'dblclick'|'keydown'} */ (key);
  }
  return "none";
}

/**
 * @param {object|null|undefined} descriptor
 * @returns {'none'|'click'|'dblclick'|'keydown'}
 */
export function resolveInfoPanelDismissTrigger(descriptor) {
  if (!descriptor || typeof descriptor !== "object") {
    return "none";
  }
  if (descriptor.fix === true) {
    return "none";
  }
  if (descriptor.fix === false) {
    if (hasOwn(descriptor, "dismissTrigger")) {
      const trigger = normalizeDismissTrigger(descriptor.dismissTrigger);
      return trigger === "none" ? "dblclick" : trigger;
    }
    return "dblclick";
  }
  return "none";
}

/**
 * @param {'none'|'click'|'dblclick'|'keydown'} trigger
 * @returns {string|null}
 */
export function dismissTriggerToPlatformEvent(trigger) {
  if (trigger === "click" || trigger === "dblclick") {
    return normalizePlatformEventName(trigger);
  }
  return null;
}

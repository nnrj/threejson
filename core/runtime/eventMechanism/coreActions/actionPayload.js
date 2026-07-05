function isObjectRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {unknown} action
 * @returns {boolean}
 */
export function isActionRecord(action) {
  return isObjectRecord(action) && normalizeText(action.type).length > 0;
}

/**
 * Normalize `action` shorthand and `actions` array into one ordered list.
 * When both exist, the single `action` becomes the first item.
 *
 * @param {object|null|undefined} eventConfig
 * @returns {object[]}
 */
export function normalizeEventActions(eventConfig) {
  if (!isObjectRecord(eventConfig)) {
    return [];
  }
  const out = [];
  if (Object.prototype.hasOwnProperty.call(eventConfig, "action")) {
    if (isActionRecord(eventConfig.action)) {
      out.push(eventConfig.action);
    }
  }
  if (Array.isArray(eventConfig.actions)) {
    for (let i = 0; i < eventConfig.actions.length; i++) {
      const action = eventConfig.actions[i];
      if (isActionRecord(action)) {
        out.push(action);
      }
    }
  }
  return out;
}

/**
 * @param {unknown} eventConfig
 * @returns {boolean}
 */
export function eventConfigHasActionPayload(eventConfig) {
  return normalizeEventActions(eventConfig).length > 0;
}

/**
 * @param {unknown} eventConfig
 * @returns {string|null}
 */
export function getRejectedActionPayloadReason(eventConfig) {
  if (!isObjectRecord(eventConfig)) {
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(eventConfig, "action") && !isActionRecord(eventConfig.action)) {
    return "events action must be an object with non-empty type";
  }
  if (Object.prototype.hasOwnProperty.call(eventConfig, "actions")) {
    if (!Array.isArray(eventConfig.actions)) {
      return "events actions must be an array";
    }
    for (let i = 0; i < eventConfig.actions.length; i++) {
      if (!isActionRecord(eventConfig.actions[i])) {
        return `events actions[${i}] must be an object with non-empty type`;
      }
    }
  }
  return null;
}

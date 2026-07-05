/**
 * Validate record.events blocks — reject legacy handler strings (§3.1.8).
 */

import { isPlatformEventName, normalizePlatformEventName } from "./platformEvents.js";
import { getRejectedActionPayloadReason } from "./coreActions/index.js";

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {unknown} eventConfig
 * @returns {string|null} rejection reason
 */
export function getRejectedEventConfigReason(eventConfig) {
  if (!eventConfig || typeof eventConfig !== "object" || Array.isArray(eventConfig)) {
    return "events entry must be an object";
  }
  const handler = normalizeText(/** @type {Record<string, unknown>} */ (eventConfig).handler);
  if (handler) {
    return "events handler strings are not supported; use script or domain trigger fields";
  }
  const domain = normalizeText(/** @type {Record<string, unknown>} */ (eventConfig).domain);
  if (domain && handler) {
    return "events { domain, handler } L3 shape is not supported";
  }
  const actionReason = getRejectedActionPayloadReason(eventConfig);
  if (actionReason) {
    return actionReason;
  }
  return null;
}

/**
 * @param {unknown} eventsBlock
 * @returns {{ eventName: string, config: object }[]}
 */
export function listValidEventEntries(eventsBlock) {
  if (!eventsBlock || typeof eventsBlock !== "object" || Array.isArray(eventsBlock)) {
    return [];
  }
  const out = [];
  for (const [rawName, config] of Object.entries(eventsBlock)) {
    const eventName = normalizePlatformEventName(rawName);
    if (!isPlatformEventName(eventName)) {
      continue;
    }
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      continue;
    }
    if (getRejectedEventConfigReason(config)) {
      continue;
    }
    out.push({ eventName, config });
  }
  return out;
}

/**
 * @param {unknown} eventsBlock
 * @param {string} threeJsonId
 * @returns {string[]} rejection reasons
 */
export function collectRejectedEventConfigs(eventsBlock, threeJsonId = "") {
  if (!eventsBlock || typeof eventsBlock !== "object" || Array.isArray(eventsBlock)) {
    return [];
  }
  const id = normalizeText(threeJsonId);
  const prefix = id ? `[${id}] ` : "";
  const reasons = [];
  for (const [rawName, config] of Object.entries(eventsBlock)) {
    const eventName = normalizePlatformEventName(rawName);
    if (!isPlatformEventName(eventName)) {
      continue;
    }
    const reason = getRejectedEventConfigReason(config);
    if (reason) {
      reasons.push(`${prefix}${eventName}: ${reason}`);
    }
  }
  return reasons;
}

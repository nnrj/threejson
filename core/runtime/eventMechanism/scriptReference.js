/**
 * Detect URL / lib:// references in unified events.*.script field.
 */

import { LIB_PREFIX } from "../../util/resolveTextureSource.js";

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {unknown} script
 * @returns {boolean}
 */
export function isEventScriptReference(script) {
  const text = normalizeText(script);
  if (!text) {
    return false;
  }
  const lower = text.toLowerCase();
  if (lower.startsWith(LIB_PREFIX)) {
    return true;
  }
  if (/^https?:\/\//i.test(text)) {
    return true;
  }
  if (text.startsWith("./")) {
    return true;
  }
  // Absolute asset path (e.g. /assets/scripts/foo.dsl) — not line/block comments (//, /*).
  if (/^\/[^/*]/.test(text)) {
    return true;
  }
  return false;
}

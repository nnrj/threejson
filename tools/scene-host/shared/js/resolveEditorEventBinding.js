/**
 * Editor event binding settings → createJsonScene bindSceneEvents flag.
 */

import { resolveBindSceneEvents } from "../../../../core/runtime/eventMechanism/resolveBindSceneEvents.js";

const PREVIEW_MODES = new Set(["followJson", "alwaysOn", "alwaysOff"]);
const EDITOR_CANVAS_MODES = new Set(["alwaysOff", "alwaysOn", "followJson"]);

function normalizeMode(value, allowed, fallback) {
  const key = typeof value === "string" ? value.trim() : "";
  return allowed.has(key) ? key : fallback;
}

/**
 * @param {object|null|undefined} editorSettings
 * @param {object|null|undefined} payload
 * @returns {boolean}
 */
export function resolveEditorCanvasBindSceneEvents(editorSettings, payload = null) {
  const mode = normalizeMode(
    editorSettings?.interaction?.editorEventBinding,
    EDITOR_CANVAS_MODES,
    "alwaysOff"
  );
  if (mode === "alwaysOff") {
    return false;
  }
  if (mode === "alwaysOn") {
    return true;
  }
  return resolveBindSceneEvents(payload, payload?.sceneConfig, {});
}

/**
 * @param {object|null|undefined} editorSettings
 * @param {object|null|undefined} payload
 * @returns {boolean}
 */
export function resolvePreviewBindSceneEvents(editorSettings, payload = null) {
  const mode = normalizeMode(
    editorSettings?.interaction?.previewEventBinding,
    PREVIEW_MODES,
    "followJson"
  );
  if (mode === "alwaysOff") {
    return false;
  }
  if (mode === "alwaysOn") {
    return true;
  }
  return resolveBindSceneEvents(payload, payload?.sceneConfig, {});
}

/**
 * @param {object|null|undefined} editorSettings
 * @returns {string}
 */
export function resolvePreviewPlayerUrl(editorSettings, fallbackUrl) {
  const raw = editorSettings?.interaction?.previewPlayerUrl;
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim();
  }
  return fallbackUrl;
}

/**
 * @param {object|null|undefined} editorSettings
 * @returns {boolean}
 */
export function resolvePreviewHotReloadEnabled(editorSettings) {
  return editorSettings?.interaction?.previewHotReload !== false;
}

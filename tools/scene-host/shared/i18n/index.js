/**
 * Scene-host runtime i18n (editor / player).
 */
import { EDITOR_SETTINGS_LABELS_EN } from "./editorSettingsLabels.en.js";
import { EDITOR_SHELL_LABELS_EN } from "./editorShellLabels.en.js";
import { PLAYER_SETTINGS_LABELS_EN } from "./playerSettingsLabels.en.js";
import { PLAYER_SHELL_LABELS_EN } from "./playerShellLabels.en.js";
import { applyShellI18n } from "./applyShellI18n.js";

export { applyShellI18n };

const SUPPORTED = new Set(["zh-CN", "en-US"]);
const LOCALE_STORAGE_KEY = "threejson.host.locale";

let catalog = {};
let currentLocale = "en-US";

export function normalizeLocale(raw) {
  const tag = String(raw || "")
    .trim()
    .replace(/_/g, "-");
  if (!tag) {
    return "en-US";
  }
  const lower = tag.toLowerCase();
  if (lower === "zh" || lower.startsWith("zh-")) {
    return "zh-CN";
  }
  if (lower === "en" || lower.startsWith("en-")) {
    return "en-US";
  }
  return "en-US";
}

export function detectNavigatorLocale() {
  const nav =
    (typeof navigator !== "undefined" &&
      (navigator.language || (navigator.languages && navigator.languages[0]))) ||
    "";
  return normalizeLocale(nav);
}

export function resolveHostLocale(settingsLocale) {
  const explicit = String(settingsLocale || "").trim();
  if (explicit && SUPPORTED.has(explicit)) {
    return explicit;
  }
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored && SUPPORTED.has(stored)) {
      return stored;
    }
  } catch (_) {
    /* ignore */
  }
  return detectNavigatorLocale();
}

export async function loadHostLocaleCatalog(locale) {
  const loc = SUPPORTED.has(locale) ? locale : normalizeLocale(locale);
  if (loc === "en-US") {
    catalog = {
      ...EDITOR_SETTINGS_LABELS_EN,
      ...EDITOR_SHELL_LABELS_EN,
      ...PLAYER_SETTINGS_LABELS_EN,
      ...PLAYER_SHELL_LABELS_EN
    };
    currentLocale = loc;
    return catalog;
  }
  async function fetchJson(name) {
    const res = await fetch(new URL(`./locales/${name}`, import.meta.url));
    return res.ok ? res.json() : {};
  }
  const [settings, editorShell, playerSettings, playerShell] = await Promise.all([
    fetchJson(`${loc}.json`),
    fetchJson(`editor-shell.${loc}.json`),
    fetchJson(`player-settings.${loc}.json`),
    fetchJson(`player-shell.${loc}.json`)
  ]);
  catalog = { ...settings, ...editorShell, ...playerSettings, ...playerShell };
  currentLocale = loc;
  return catalog;
}

export function getHostLocale() {
  return currentLocale;
}

export function setHostLocaleStorage(locale) {
  const next = SUPPORTED.has(locale) ? locale : normalizeLocale(locale);
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, next);
  } catch (_) {
    /* ignore */
  }
  return next;
}

export function t(key, fallback = "", params) {
  let text = (catalog && catalog[key]) || fallback || key;
  if (params && typeof text === "string") {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp("\\{" + k + "\\}", "g"), String(v));
    }
  }
  return text;
}

export async function initHostI18n(settingsLocale) {
  const locale = resolveHostLocale(settingsLocale);
  await loadHostLocaleCatalog(locale);
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale === "zh-CN" ? "zh-CN" : "en";
  }
  setHostLocaleStorage(locale);
  return locale;
}

export function applyDataI18n(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    const fallback = el.getAttribute("data-i18n-fallback") || el.textContent || "";
    el.textContent = t(key, fallback);
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    const fallback = el.getAttribute("data-i18n-fallback") || el.title || "";
    el.title = t(key, fallback);
  });
  root.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    const key = el.getAttribute("data-i18n-aria");
    const fallback = el.getAttribute("data-i18n-fallback") || el.getAttribute("aria-label") || "";
    el.setAttribute("aria-label", t(key, fallback));
  });
}

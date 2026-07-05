import { t } from "./index.js";

/**
 * Apply shell UI translations from data-i18n* attributes under root.
 */
export function applyShellI18n(root = document) {
  if (!root) {
    return;
  }
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (!key) {
      return;
    }
    if (el.children.length > 0) {
      return;
    }
    const fallback = el.getAttribute("data-i18n-fallback") || el.textContent || "";
    el.textContent = t(key, fallback);
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    if (!key) {
      return;
    }
    const fallback = el.getAttribute("data-i18n-fallback-title") || el.title || "";
    el.title = t(key, fallback);
  });
  root.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    const key = el.getAttribute("data-i18n-aria");
    if (!key) {
      return;
    }
    const fallback = el.getAttribute("data-i18n-fallback-aria") || el.getAttribute("aria-label") || "";
    el.setAttribute("aria-label", t(key, fallback));
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (!key) {
      return;
    }
    const fallback = el.getAttribute("data-i18n-fallback-placeholder") || el.placeholder || "";
    el.placeholder = t(key, fallback);
  });
}

/**
 * Demo index i18n: locale resolution, UI strings, catalog load.
 */
(function (global) {
  const LOCALE_STORAGE_KEY = "threejson.demo.locale";
  const SUPPORTED = new Set(["zh-CN", "en-US"]);

  function normalizeLocale(raw) {
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

  function detectLocale() {
    try {
      const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
      if (stored && SUPPORTED.has(stored)) {
        return stored;
      }
    } catch (_) {
      /* ignore */
    }
    const nav =
      (typeof navigator !== "undefined" &&
        (navigator.language || (navigator.languages && navigator.languages[0]))) ||
      "";
    return normalizeLocale(nav);
  }

  function setLocale(locale) {
    const next = SUPPORTED.has(locale) ? locale : normalizeLocale(locale);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch (_) {
      /* ignore */
    }
    return next;
  }

  function getLocale() {
    return detectLocale();
  }

  function catalogLocaleFile(locale) {
    return locale === "en-US" ? "demo-catalog.en.json" : "demo-catalog.zh.json";
  }

  function uiLocaleFile(locale) {
    return locale === "en-US" ? "locales/demo-ui.en.json" : "locales/demo-ui.zh.json";
  }

  function t(ui, key, params) {
    let text = ui?.[key] ?? key;
    if (params && typeof text === "string") {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(new RegExp("\\{" + k + "\\}", "g"), String(v));
      }
    }
    return text;
  }

  async function loadDemoIndexBundle(locale, baseUrl) {
    const root = baseUrl || "./examples/html-demo/";
    const loc = SUPPORTED.has(locale) ? locale : normalizeLocale(locale);
    const [catalogRes, uiRes] = await Promise.all([
      fetch(root + catalogLocaleFile(loc)),
      fetch(root + uiLocaleFile(loc))
    ]);
    if (!catalogRes.ok || !uiRes.ok) {
      throw new Error("[demo-i18n] failed to load catalog or UI locale files");
    }
    const demos = await catalogRes.json();
    const ui = await uiRes.json();
    if (!Array.isArray(demos)) {
      throw new Error("[demo-i18n] catalog must be a JSON array");
    }
    return {
      locale: loc,
      demos,
      ui
    };
  }

  const api = {
    LOCALE_STORAGE_KEY,
    SUPPORTED,
    normalizeLocale,
    detectLocale,
    getLocale,
    setLocale,
    catalogLocaleFile,
    uiLocaleFile,
    loadDemoIndexBundle,
    t
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  global.DemoIndexI18n = api;
})(typeof globalThis !== "undefined" ? globalThis : window);

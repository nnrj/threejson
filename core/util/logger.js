/**
 * ThreeJSON lightweight log levels: default warn; debug via URL / localStorage / configureLogger.
 * Levels: error(0) < warn(1) < info(2) < debug(3)
 */

const LEVEL_BY_NAME = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

const DEBUG_STORAGE_KEY = "threejson.debug";
const DEBUG_URL_PARAM = "threejson_debug";

let currentLevel = LEVEL_BY_NAME.warn;

function resolveLevelFromName(name) {
  if (name == null || name === "") {
    return undefined;
  }
  const key = String(name).trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(LEVEL_BY_NAME, key)
    ? LEVEL_BY_NAME[key]
    : undefined;
}

function readBrowserDebugFlag() {
  if (typeof globalThis === "undefined") {
    return false;
  }
  try {
    if (typeof globalThis.location?.search === "string") {
      const params = new URLSearchParams(globalThis.location.search);
      const raw = params.get(DEBUG_URL_PARAM);
      if (raw === "1" || raw === "true" || raw === "yes") {
        return true;
      }
    }
  } catch (_) {
    /* ignore */
  }
  try {
    if (typeof globalThis.localStorage?.getItem === "function") {
      const stored = globalThis.localStorage.getItem(DEBUG_STORAGE_KEY);
      if (stored === "1" || stored === "true" || stored === "yes") {
        return true;
      }
    }
  } catch (_) {
    /* ignore */
  }
  return false;
}

function applyBrowserDefaults() {
  if (readBrowserDebugFlag()) {
    currentLevel = LEVEL_BY_NAME.debug;
  }
}

applyBrowserDefaults();

/**
 * @param {{ level?: string, debug?: boolean }} [options]
 */
export function configureLogger(options = {}) {
  if (options.debug === true) {
    currentLevel = LEVEL_BY_NAME.debug;
  } else if (options.debug === false && currentLevel >= LEVEL_BY_NAME.debug) {
    currentLevel = LEVEL_BY_NAME.warn;
  }
  const named = resolveLevelFromName(options.level);
  if (named != null) {
    currentLevel = named;
  }
}

/** @returns {boolean} */
export function isDebugEnabled() {
  return currentLevel >= LEVEL_BY_NAME.debug;
}

function shouldLog(minLevel) {
  return currentLevel >= minLevel;
}

export const log = {
  error(...args) {
    console.error(...args);
  },
  warn(...args) {
    if (shouldLog(LEVEL_BY_NAME.warn)) {
      console.warn(...args);
    }
  },
  info(...args) {
    if (shouldLog(LEVEL_BY_NAME.info)) {
      console.info(...args);
    }
  },
  debug(...args) {
    if (shouldLog(LEVEL_BY_NAME.debug)) {
      console.debug(...args);
    }
  }
};

import { THREEBOX_SETTINGS_DEFAULTS, THREEBOX_SETTINGS_STORAGE_KEY } from "./threeBoxSettingsSchema.js";

export function cloneThreeBoxSettings(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainSettingsObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function deepMergeThreeBoxSettings(base, overlay) {
  if (!isPlainSettingsObject(base)) {
    return cloneThreeBoxSettings(overlay || {});
  }
  const out = cloneThreeBoxSettings(base);
  if (!isPlainSettingsObject(overlay)) {
    return out;
  }
  for (const key of Object.keys(overlay)) {
    const next = overlay[key];
    if (isPlainSettingsObject(next) && isPlainSettingsObject(out[key])) {
      out[key] = deepMergeThreeBoxSettings(out[key], next);
    } else {
      out[key] = next;
    }
  }
  return out;
}

function splitSettingsPath(path) {
  return String(path || "").split(".").filter(Boolean);
}

export function getSettingsByPath(obj, path) {
  const parts = splitSettingsPath(path);
  let cur = obj;
  for (const part of parts) {
    if (cur == null) {
      return undefined;
    }
    cur = cur[part];
  }
  return cur;
}

export function setSettingsByPath(obj, path, value) {
  const parts = splitSettingsPath(path);
  if (!parts.length) {
    return;
  }
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (!isPlainSettingsObject(cur[part])) {
      cur[part] = {};
    }
    cur = cur[part];
  }
  cur[parts[parts.length - 1]] = value;
}

export function readThreeBoxSettingsCache() {
  try {
    const raw = localStorage.getItem(THREEBOX_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return isPlainSettingsObject(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

export function saveThreeBoxSettingsCache(settings) {
  try {
    localStorage.setItem(THREEBOX_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn("[threebox settings] save cache failed:", error);
  }
}

export function loadThreeBoxSettingsBundle() {
  const cached = readThreeBoxSettingsCache();
  const merged = deepMergeThreeBoxSettings(THREEBOX_SETTINGS_DEFAULTS, cached || {});
  if (cached?.io?.sceneJsonFormat !== "standard" && cached?.io?.sceneJsonFormat !== "friendly") {
    merged.io.sceneJsonFormat = cached?.io?.copyFriendlyJson === true ? "friendly" : "standard";
  }
  if (!cached?.agent && cached?.ai?.agentDepth && !merged.agent?.depth) {
    merged.agent = { ...(merged.agent || {}), depth: cached.ai.agentDepth };
  } else if (!cached?.agent && cached?.ai?.agentDepth) {
    merged.agent.depth = cached.ai.agentDepth;
  }
  return merged;
}

/** Strips provider API keys before persisting, unless ai.rememberKeys is true. */
export function persistThreeBoxSettings(settings) {
  const toSave = cloneThreeBoxSettings(settings);
  if (!toSave.ai?.rememberKeys && Array.isArray(toSave.ai?.providers)) {
    toSave.ai.providers = toSave.ai.providers.map((p) => ({ ...p, apiKey: "" }));
  }
  saveThreeBoxSettingsCache(toSave);
}

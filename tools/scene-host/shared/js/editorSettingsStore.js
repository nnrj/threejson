import {
  EDITOR_BUILTIN_PROVIDER_ID,
  EDITOR_SETTINGS_DEFAULTS,
  EDITOR_SETTINGS_JSON_URL,
  EDITOR_SETTINGS_STORAGE_KEY
} from "./editorSettingsSchema.js";
import { BUILTIN_PROVIDER_TYPE } from "./builtinAiProvider.js";
import { resolveSceneHostUrl } from "./sceneHostPaths.js";

export function cloneEditorSettings(value) {
  return JSON.parse(JSON.stringify(value));
}

export function isPlainSettingsObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

export function deepMergeEditorSettings(base, overlay) {
  if (!isPlainSettingsObject(base)) {
    return cloneEditorSettings(overlay || {});
  }
  const out = cloneEditorSettings(base);
  if (!isPlainSettingsObject(overlay)) {
    return out;
  }
  for (const key of Object.keys(overlay)) {
    const next = overlay[key];
    if (isPlainSettingsObject(next) && isPlainSettingsObject(out[key])) {
      out[key] = deepMergeEditorSettings(out[key], next);
    } else {
      out[key] = next;
    }
  }
  return out;
}

export function splitSettingsPath(path) {
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
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!isPlainSettingsObject(cur[part])) {
      cur[part] = {};
    }
    cur = cur[part];
  }
  cur[parts[parts.length - 1]] = value;
}

export async function fetchEditorSettingsFileDefaults() {
  try {
    const response = await fetch(EDITOR_SETTINGS_JSON_URL, { cache: "no-cache" });
    if (!response.ok) {
      return cloneEditorSettings(EDITOR_SETTINGS_DEFAULTS);
    }
    const json = await response.json();
    return deepMergeEditorSettings(EDITOR_SETTINGS_DEFAULTS, json);
  } catch (error) {
    console.warn("[scene-editor settings] fetch defaults failed:", error);
    return cloneEditorSettings(EDITOR_SETTINGS_DEFAULTS);
  }
}

export function readEditorSettingsCache() {
  try {
    const raw = localStorage.getItem(EDITOR_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return isPlainSettingsObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveEditorSettingsCache(settings) {
  try {
    localStorage.setItem(EDITOR_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn("[scene-editor settings] save cache failed:", error);
  }
}

export function clearEditorSettingsCache() {
  try {
    localStorage.removeItem(EDITOR_SETTINGS_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Seeds the built-in trial provider on first-ever load (no cached settings) or whenever the
 * provider list has otherwise ended up empty (e.g. the user deleted their only provider) — mirrors
 * ThreeBox's ensureBuiltinProviderSeeded (threeBoxSettingsStore.js). editorBuiltinAiProvider.js's
 * `ensureEditorBuiltinApiKey` fills in the actual trial `apiKey` shortly after boot; this only
 * creates the provider entry shell. */
function ensureBuiltinProviderSeeded(merged) {
  if (!Array.isArray(merged.ai.providers)) {
    merged.ai.providers = [];
  }
  if (merged.ai.providers.length > 0) {
    return merged;
  }
  merged.ai.providers.push({
    id: EDITOR_BUILTIN_PROVIDER_ID,
    label: "内置试用（限额）",
    provider: BUILTIN_PROVIDER_TYPE,
    model: "",
    apiKey: "",
    baseUrl: ""
  });
  merged.ai.defaultProviderId = EDITOR_BUILTIN_PROVIDER_ID;
  return merged;
}

export async function loadEditorSettingsBundle() {
  const fileDefaults = await fetchEditorSettingsFileDefaults();
  const cached = readEditorSettingsCache();
  const merged = deepMergeEditorSettings(fileDefaults, cached || {});
  ensureBuiltinProviderSeeded(merged);
  return {
    fileDefaults,
    settings: merged
  };
}

/** Strips provider API keys before persisting, unless ai.rememberConfig is true (or the caller
 * passes rememberAiKey — used for the built-in trial key, see editorBuiltinAiProvider.js). The
 * built-in provider's key is exempt from stripping either way: it's a backend-revocable,
 * device-fingerprint-tied credential, not a user-owned secret. */
export function persistEditorSettings(settings, { rememberAiKey = false } = {}) {
  const toSave = cloneEditorSettings(settings);
  if (!toSave.ai?.rememberConfig && !rememberAiKey && Array.isArray(toSave.ai?.providers)) {
    toSave.ai.providers = toSave.ai.providers.map((p) =>
      p.provider === BUILTIN_PROVIDER_TYPE ? p : { ...p, apiKey: "" }
    );
  }
  saveEditorSettingsCache(toSave);
}

export function getDefaultSceneJsonUrl(settings) {
  const value = settings?.general?.defaultSceneUrl || EDITOR_SETTINGS_DEFAULTS.general.defaultSceneUrl;
  return resolveSceneHostUrl(value);
}

export function getLoadingMaskDefaultText(settings) {
  return settings?.general?.loadingMaskText || EDITOR_SETTINGS_DEFAULTS.general.loadingMaskText;
}

export function getSceneLoadDoneDelayMs(settings) {
  const n = Number(settings?.general?.sceneLoadDoneDelayMs);
  if (!Number.isFinite(n)) {
    return EDITOR_SETTINGS_DEFAULTS.general.sceneLoadDoneDelayMs;
  }
  return Math.min(3000, Math.max(0, Math.round(n)));
}

export function applyEditorSettingsToSysConfig(sysConfig, settings) {
  if (!settings) {
    return;
  }
  sysConfig.antialias = settings.render?.antialias ?? sysConfig.antialias;
  sysConfig.fps = settings.render?.targetFps ?? sysConfig.fps;
  sysConfig.lowFps = settings.render?.lowFpsMode ?? sysConfig.lowFps;
  sysConfig.sceneAutoRotate = settings.render?.sceneAutoRotate ?? sysConfig.sceneAutoRotate;
  sysConfig.progressFlag = settings.general?.progressOverlayEnabled ?? sysConfig.progressFlag;
  sysConfig.optimizeJson = settings.io?.optimizeJsonOnSave ?? sysConfig.optimizeJson;
  sysConfig.clickHighLightFlag =
    settings.editing?.clickHighlightNonEditable ?? sysConfig.clickHighLightFlag;
  sysConfig.impactCheckFlag = settings.editing?.impactCheckOnEdit ?? sysConfig.impactCheckFlag;
}

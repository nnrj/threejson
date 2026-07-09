import {
  HIGHLIGHT_ALARM_RED,
  HIGHLIGHT_LOCATE_AMBER
} from "../../../../domains/sceneHighlight/channels.js";
import { resolveSceneHostUrl } from "./sceneHostPaths.js";

const PLAYER_SETTINGS_STORAGE_KEY = "scenePlayer_settings_v1";
const PLAYER_SETTINGS_JSON_URL = new URL(
  "../../../../assets/json/other/scene-player/setting.json",
  import.meta.url
).href;

export { PLAYER_SETTINGS_STORAGE_KEY };

export const PLAYER_SETTINGS_DEFAULTS = {
  version: 1,
  app: "scene-player",
  general: {
    locale: "",
    baseTitle: "Scene Player",
    defaultSceneUrl: "../../../../assets/json/portShow.json",
    loadingMaskText: "Loading 3D scene…",
    messageToastDurationMs: 2600,
    progressOverlayEnabled: true,
    sceneLoadDoneDelayMs: 300
  },
  layout: { rightPanelOpenByDefault: true, playlistListMinHeightPx: 120 },
  audio: { defaultVolumePercent: 100, defaultMuted: false, rememberVolume: true },
  playback: { restorePlaylistOnStartup: true, preferUrlQueryScene: true, sceneAutoRotate: false },
  render: {
    antialias: true,
    targetFps: 60,
    lowFpsMode: false,
    overrideSceneRenderLoop: false,
    earlyRenderWhileLoading: true
  },
  immersive: { chromeHideDelayMs: 420, rightEdgeStripWidthPx: 22 },
  highlight: {
    channels: { info: "#FFFFFF", locate: HIGHLIGHT_LOCATE_AMBER, alarm: HIGHLIGHT_ALARM_RED }
  }
};

export function clonePlayerSettings(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainPlayerSettingsObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function splitSettingsPath(path) {
  return String(path || "").split(".").filter(Boolean);
}

export function getPlayerSettingsByPath(obj, path) {
  let cur = obj;
  for (const part of splitSettingsPath(path)) {
    if (cur == null) {
      return undefined;
    }
    cur = cur[part];
  }
  return cur;
}

export function setPlayerSettingsByPath(obj, path, value) {
  const parts = splitSettingsPath(path);
  if (!parts.length) {
    return;
  }
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!isPlainPlayerSettingsObject(cur[parts[i]])) {
      cur[parts[i]] = {};
    }
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

export function clearPlayerSettingsCache() {
  try {
    localStorage.removeItem(PLAYER_SETTINGS_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function deepMergePlayerSettings(base, patch) {
  if (!isPlainPlayerSettingsObject(base)) {
    return clonePlayerSettings(patch || {});
  }
  const out = clonePlayerSettings(base);
  if (!isPlainPlayerSettingsObject(patch)) {
    return out;
  }
  for (const key of Object.keys(patch)) {
    const pv = patch[key];
    if (isPlainPlayerSettingsObject(pv) && isPlainPlayerSettingsObject(out[key])) {
      out[key] = deepMergePlayerSettings(out[key], pv);
    } else {
      out[key] = pv;
    }
  }
  return out;
}

export async function fetchPlayerSettingsFileDefaults() {
  try {
    const response = await fetch(PLAYER_SETTINGS_JSON_URL, { cache: "no-cache" });
    if (!response.ok) {
      return clonePlayerSettings(PLAYER_SETTINGS_DEFAULTS);
    }
    return deepMergePlayerSettings(PLAYER_SETTINGS_DEFAULTS, await response.json());
  } catch {
    return clonePlayerSettings(PLAYER_SETTINGS_DEFAULTS);
  }
}

function readPlayerSettingsCache() {
  try {
    const raw = localStorage.getItem(PLAYER_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return isPlainPlayerSettingsObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function persistPlayerSettings(settings) {
  try {
    localStorage.setItem(PLAYER_SETTINGS_STORAGE_KEY, JSON.stringify(clonePlayerSettings(settings)));
  } catch {
    /* ignore */
  }
}

export async function loadPlayerSettingsBundle() {
  const fileDefaults = await fetchPlayerSettingsFileDefaults();
  const cached = readPlayerSettingsCache();
  const settings = cached ? deepMergePlayerSettings(fileDefaults, cached) : clonePlayerSettings(fileDefaults);
  return { fileDefaults, settings };
}

export function getDefaultSceneUrl(playerSettings) {
  const value = playerSettings?.general?.defaultSceneUrl || PLAYER_SETTINGS_DEFAULTS.general.defaultSceneUrl;
  return resolveSceneHostUrl(value);
}

export function getPlayerLoadingMaskText(playerSettings) {
  return playerSettings?.general?.loadingMaskText || PLAYER_SETTINGS_DEFAULTS.general.loadingMaskText;
}

export function getPlayerSceneLoadDoneDelayMs(playerSettings) {
  const n = Number(playerSettings?.general?.sceneLoadDoneDelayMs);
  return Number.isFinite(n) ? Math.min(3000, Math.max(0, Math.round(n))) : PLAYER_SETTINGS_DEFAULTS.general.sceneLoadDoneDelayMs;
}

export function getPlayerMessageToastDurationMs(playerSettings) {
  const n = Number(playerSettings?.general?.messageToastDurationMs);
  return Number.isFinite(n) ? n : PLAYER_SETTINGS_DEFAULTS.general.messageToastDurationMs;
}

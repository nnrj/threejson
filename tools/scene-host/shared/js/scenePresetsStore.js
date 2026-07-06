import {
  EDITOR_SCENE_PRESETS_KEY,
  editorSessionIdbGet,
  editorSessionIdbPut,
  editorSessionIdbDelete
} from "./editorSessionIdb.js";

export const PRESET_SCENE_BASE_URL = new URL(
  "../../../../assets/json/other/demo-json/",
  import.meta.url
).href;
export const PRESET_MANIFEST_URL = `${PRESET_SCENE_BASE_URL}presets.manifest.json`;

export const PRESET_SCENES_FALLBACK = [
  { id: "preset-blank-orbit", file: "preset-blank-orbit.json", label: "Preset blank orbit", order: 1 },
  { id: "smart-park", file: "smart-park.json", label: "Smart park", order: 10 },
  { id: "forest-02", file: "forest-02.json", label: "Forest and animals", order: 20 },
  { id: "forest", file: "forest.json", label: "Forest scene", order: 30 },
  { id: "robot-training-02", file: "robot-training-02.json", label: "Robot training", order: 40 },
  { id: "robot-adam", file: "robot-adam.json", label: "Robot Adam", order: 50 },
  { id: "robot-eden", file: "robot-eden.json", label: "Robot Eden", order: 60 },
  { id: "bot", file: "bot.json", label: "Robot bot", order: 70 },
  { id: "rotor", file: "rotor.json", label: "Rotor scene", order: 80 }
];

function resolveSceneHostUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return raw;
  }
  if (/^(?:[a-z]+:)?\/\//i.test(raw) || raw.startsWith("data:") || raw.startsWith("blob:")) {
    return raw;
  }
  const sceneHostRoot = new URL("../../../../", import.meta.url).href;
  if (raw.startsWith("/assets/")) {
    return new URL(raw.slice(1), sceneHostRoot).href;
  }
  if (raw.startsWith("./")) {
    return new URL(raw.slice(2), sceneHostRoot).href;
  }
  if (raw.startsWith("../")) {
    return new URL(raw, sceneHostRoot).href;
  }
  if (raw.startsWith("assets/")) {
    return new URL(raw, sceneHostRoot).href;
  }
  return raw;
}

export function normalizePresetSceneEntries(manifest) {
  const normalizedBase = resolveSceneHostUrl(String(manifest?.baseUrl || PRESET_SCENE_BASE_URL));
  const normalizedBaseWithSlash = normalizedBase.endsWith("/") ? normalizedBase : `${normalizedBase}/`;
  const raw = Array.isArray(manifest?.entries) ? manifest.entries : PRESET_SCENES_FALLBACK;
  return raw
    .map((entry, index) => {
      const file = String(entry?.file || "").trim();
      if (!file) {
        return null;
      }
      const label = String(entry?.label || file.replace(/\.json$/i, "")).trim();
      return {
        id: String(entry?.id || file.replace(/\.json$/i, "") || `preset-${index}`),
        file,
        label,
        order: Number.isFinite(Number(entry?.order)) ? Number(entry.order) : index * 10,
        url: `${normalizedBaseWithSlash}${file}`
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.order - b.order);
}

export async function readScenePresetsRecord() {
  const current = await editorSessionIdbGet(EDITOR_SCENE_PRESETS_KEY);
  if (current && typeof current === "object" && current.presets && typeof current.presets === "object") {
    return current;
  }
  return { version: 1, manifestVersion: 0, presets: {} };
}

export async function writeScenePresetsRecord(record) {
  await editorSessionIdbPut(EDITOR_SCENE_PRESETS_KEY, record);
}

async function fetchPresetManifestForSync() {
  try {
    const response = await fetch(PRESET_MANIFEST_URL);
    if (!response.ok) {
      throw new Error(String(response.status));
    }
    return await response.json();
  } catch (error) {
    console.warn("[scene-editor presets] manifest load failed:", error);
    return {
      version: 1,
      baseUrl: PRESET_SCENE_BASE_URL,
      entries: PRESET_SCENES_FALLBACK
    };
  }
}

export async function syncScenePresetsFromManifest() {
  const manifest = await fetchPresetManifestForSync();
  const manifestVersion = Number(manifest?.version) || 1;
  const entries = normalizePresetSceneEntries(manifest);
  const record = await readScenePresetsRecord();
  const normalizedBase = resolveSceneHostUrl(String(manifest?.baseUrl || PRESET_SCENE_BASE_URL));
  const normalizedBaseWithSlash = normalizedBase.endsWith("/") ? normalizedBase : `${normalizedBase}/`;
  const forceRefreshAllBuiltin = manifestVersion > (Number(record.manifestVersion) || 0);
  let changed = false;

  for (const entry of entries) {
    const existing = record.presets?.[entry.id];
    const needsSeed =
      forceRefreshAllBuiltin || !existing || existing.source !== "builtin" || !existing.json;
    if (!needsSeed) {
      continue;
    }
    try {
      const response = await fetch(`${normalizedBaseWithSlash}${entry.file}`);
      if (!response.ok) {
        throw new Error(String(response.status));
      }
      const jsonText = JSON.stringify(await response.json(), null, 2);
      const now = Date.now();
      record.presets[entry.id] = {
        id: entry.id,
        source: "builtin",
        label: entry.label,
        order: entry.order,
        file: entry.file,
        json: jsonText,
        createdAt: existing?.createdAt || now,
        updatedAt: now
      };
      changed = true;
    } catch (error) {
      console.warn(`[scene-editor presets] seed failed: ${entry.id}`, error);
    }
  }

  if (changed || forceRefreshAllBuiltin || record.manifestVersion !== manifestVersion) {
    record.manifestVersion = manifestVersion;
    await writeScenePresetsRecord(record);
  }
  return record;
}

export async function buildPresetSceneEntriesFromRecord() {
  const record = await readScenePresetsRecord();
  return Object.values(record.presets || {})
    .map((preset) => ({
      id: String(preset?.id || "").trim(),
      label: String(preset?.label || preset?.id || "Unnamed preset").trim(),
      order: Number.isFinite(Number(preset?.order)) ? Number(preset.order) : 9999,
      source: preset?.source === "user" ? "user" : "builtin"
    }))
    .filter((entry) => entry.id)
    .sort((a, b) => a.order - b.order);
}

export async function loadPresetSceneEntries() {
  await syncScenePresetsFromManifest();
  return buildPresetSceneEntriesFromRecord();
}

export async function readPresetJson(presetId) {
  const key = String(presetId || "").trim();
  if (!key) {
    return null;
  }
  const record = await readScenePresetsRecord();
  const preset = record.presets?.[key];
  if (!preset?.json) {
    return null;
  }
  try {
    return JSON.parse(String(preset.json));
  } catch (error) {
    console.warn("[scene-editor presets] json parse failed:", error);
    return null;
  }
}

export async function writeUserScenePreset({ label, json }) {
  const record = await readScenePresetsRecord();
  const uuid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : String(Date.now());
  const id = `user-preset-${uuid.replace(/-/g, "").slice(0, 8)}`;
  const now = Date.now();
  record.presets[id] = {
    id,
    source: "user",
    label: String(label || "Unnamed preset").trim() || "Unnamed preset",
    order: 9000 + (now % 1000),
    json: typeof json === "string" ? json : JSON.stringify(json, null, 2),
    createdAt: now,
    updatedAt: now
  };
  await writeScenePresetsRecord(record);
  return id;
}

export async function deleteUserScenePreset(presetId) {
  const key = String(presetId || "").trim();
  if (!key) {
    return false;
  }
  const record = await readScenePresetsRecord();
  const preset = record.presets?.[key];
  if (!preset || preset.source !== "user") {
    return false;
  }
  delete record.presets[key];
  await writeScenePresetsRecord(record);
  return true;
}

export async function renameUserScenePreset(presetId, nextLabel) {
  const key = String(presetId || "").trim();
  const label = String(nextLabel || "").trim();
  if (!key || !label) {
    return false;
  }
  const record = await readScenePresetsRecord();
  const preset = record.presets?.[key];
  if (!preset || preset.source !== "user") {
    return false;
  }
  preset.label = label;
  preset.updatedAt = Date.now();
  await writeScenePresetsRecord(record);
  return true;
}

export async function clearScenePresetsCache() {
  try {
    await editorSessionIdbDelete(EDITOR_SCENE_PRESETS_KEY);
  } catch (error) {
    console.warn("[scene-editor presets] clear cache failed:", error);
  }
}

import { editorSessionIdbGet, editorSessionIdbPut } from "./editorSessionIdb.js";

export const EDITOR_USER_BASELINE_KEY = "user-baseline";

export async function fingerprintSessionJsonText(text) {
  const payload = new TextEncoder().encode(String(text || ""));
  if (typeof crypto !== "undefined" && crypto.subtle?.digest) {
    const buf = await crypto.subtle.digest("SHA-256", payload);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  return String(text || "").length + ":" + String(text || "").slice(0, 256);
}

export async function readUserSavedBaselineRecord() {
  const current = await editorSessionIdbGet(EDITOR_USER_BASELINE_KEY);
  if (current && typeof current === "object" && !Array.isArray(current)) {
    return current;
  }
  return {
    version: 1,
    scenes: {}
  };
}

export async function hasUserSavedBaseline(sceneThreeJsonId) {
  const key = String(sceneThreeJsonId || "").trim();
  if (!key) {
    return false;
  }
  const record = await readUserSavedBaselineRecord();
  return Boolean(record.scenes?.[key]);
}

export async function writeUserSavedBaseline(sceneThreeJsonId, value) {
  const key = String(sceneThreeJsonId || "").trim();
  if (!key) {
    throw new Error("保存失败：场景 threeJsonId 为空。");
  }
  const record = await readUserSavedBaselineRecord();
  record.scenes = record.scenes && typeof record.scenes === "object" ? record.scenes : {};
  record.scenes[key] = {
    ...value,
    updatedAt: Date.now()
  };
  await editorSessionIdbPut(EDITOR_USER_BASELINE_KEY, record);
  return record.scenes[key];
}

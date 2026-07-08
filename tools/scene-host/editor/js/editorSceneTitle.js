import { t } from "../../shared/i18n/index.js";

const GENERIC_RECENT_SCENE_LABELS = new Set([
  "未命名场景",
  "示例场景",
  "新场景",
  "新建场景",
  "默认场景",
  "未命名文件"
]);

export function basenameFromHintLabel(hintLabel) {
  const s = String(hintLabel || "").trim();
  if (!s) {
    return "";
  }
  const normalized = s.replace(/\\/g, "/");
  const tail = normalized.split("/").pop();
  return String(tail || "").trim();
}

export function readSceneDocumentNameFromPayload(jsonData) {
  const label = String(jsonData?.label || "").trim();
  if (label) {
    return label;
  }
  return String(jsonData?.name || "").trim();
}

export function isGenericRecentSceneLabel(label) {
  const text = String(label || "").trim();
  return !text || GENERIC_RECENT_SCENE_LABELS.has(text);
}

export function pickEditorSceneTitleSuffix(hintLabel, jsonData) {
  const base = basenameFromHintLabel(hintLabel);
  if (/\.json$/i.test(base)) {
    return base;
  }
  const docName = readSceneDocumentNameFromPayload(jsonData);
  if (docName) {
    return docName;
  }
  const hint = String(hintLabel || "").trim();
  if (hint && !isGenericRecentSceneLabel(hint)) {
    return hint;
  }
  return "";
}

export function formatEditorTopBarSceneTitle(suffix, baseTitle) {
  const rawBase = String(baseTitle || "").trim();
  const base =
    !rawBase || rawBase === "Scene Editor" || rawBase === "场景编辑器"
      ? t("editor.shell.topBarSceneTitle", "SceneEditor")
      : rawBase;
  return suffix ? `${base} - ${suffix}` : base;
}

import { inspectEditorParticleMigration, describeEditorParticleMigration } from "./editorLegacyParticleMigration.js";

export function formatEditorSceneImportError(error) {
  const raw = String(error?.message || error || "未知错误");
  if (error?.code === "E_EDITOR_IMPORT_MIGRATION") return `导入失败：${raw}`;
  if (error?.code === "UNSUPPORTED_SCHEMA_VERSION") return `导入失败：不支持此场景文档版本。${raw}`;
  if (Array.isArray(error?.diagnostics) && error.diagnostics.length) {
    return `导入失败：场景包含不支持的字段或能力。\n${error.diagnostics.map((item) => `${item.pointer || item.path || item.id || "场景"}：${item.reason || item.message || item.id}`).join("\n")}`;
  }
  if (error instanceof SyntaxError || /Invalid scene JSON|invalid JSON|Generated scene JSON must|JSON 格式无效|JSON.*(?:parse|解析|语法)/i.test(raw)) {
    return `文件格式或 JSON 内容不正确：${raw}`;
  }
  return `导入失败：${raw}`;
}

export async function prepareEditorSceneImport(payload, confirmMigration) {
  const report = inspectEditorParticleMigration(payload);
  if (report.issues.length) {
    throw Object.assign(new Error(`旧版粒子格式无法自动转换：\n${report.issues.map((item) => `对象「${item.label}」 (${item.path})：${item.reason}`).join("\n")}`), { code: "E_EDITOR_IMPORT_MIGRATION" });
  }
  if (!report.needed) return { status: "ready", payload };
  const confirmed = await confirmMigration(describeEditorParticleMigration(report), {
    title: "转换旧版粒子格式", confirmLabel: "转换副本并导入", cancelLabel: "取消导入"
  });
  return confirmed ? { status: "ready", payload: report.payload, migrated: true } : { status: "cancelled" };
}

/** Keep failure, user cancellation and a superseded async load distinct. Host boolean APIs
 * may return result.status === "loaded", but callers must not infer cancellation from false. */
export async function runEditorSceneImport(operation, feedback = {}) {
  const current = () => feedback.isCurrent?.() !== false;
  let result;
  try {
    result = await operation();
    if (!current()) result = { status: "superseded" };
  } catch (error) {
    result = error?.name === "AbortError" || !current()
      ? { status: "superseded" } : { status: "failed", error };
  }
  if (current()) {
    if (result.status !== "loaded") feedback.stopLoading?.();
    if (result.status === "cancelled") feedback.showMessage?.("已取消导入。", "info");
    if (result.status === "failed") {
      feedback.showMessage?.(formatEditorSceneImportError(result.error), "error");
      feedback.onError?.(result.error);
    }
  }
  return result;
}

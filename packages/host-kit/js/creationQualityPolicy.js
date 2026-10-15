/** Product defaults shared by native and npm hosts, never imported by the engine. */
export const CREATION_QUALITY_PROFILES = Object.freeze({
  quick: Object.freeze({ repairRounds: 0, views: 1, samplesPerShot: 1, alternatives: 1, reviewVisual: false }),
  standard: Object.freeze({ repairRounds: 1, views: 1, samplesPerShot: 3, alternatives: 1, reviewVisual: true }),
  fine: Object.freeze({ repairRounds: 2, views: 3, samplesPerShot: 3, alternatives: 1, reviewVisual: true }),
  ultimate: Object.freeze({ repairRounds: 3, views: 4, samplesPerShot: 5, alternatives: 2, reviewVisual: true })
});
export function resolveCreationQuality(value = "quick", overrides = {}) {
  const id = Object.hasOwn(CREATION_QUALITY_PROFILES, value) ? value : "quick";
  return { id, ...CREATION_QUALITY_PROFILES[id], ...overrides };
}
const messages = {
  QUALITY_NEEDS_WORK: ["画面检查仍有未解决问题；已保留可继续修改的版本", "Unresolved quality issues remain; the document is available for further editing."],
  QUALITY_VISUAL_SAMPLED: ["已完成采样画面的视觉检查（不代表所有帧均已检查）", "Visual review passed for sampled views, not every possible frame."],
  QUALITY_STRUCTURAL_ONLY: ["仅完成结构与数值检查；视觉质量未验证", "Only structural and numeric checks were completed; visual quality is unverified."],
  QUALITY_INSPECTION_UNAVAILABLE: ["运行时检查不可用；已保留文档，尚未通过质量验收", "Runtime inspection unavailable; the document is retained without quality approval."],
  QUALITY_REPORT_STALE: ["作品已修改，旧版检查结果已失效", "The document changed; the previous quality report is stale."]
};
const localeDefault = () => globalThis.document?.documentElement?.lang || globalThis.navigator?.language || "en-US";
export function qualityReportMessage(report, locale = localeDefault()) {
  return messages[report?.messageCode]?.[/^zh/i.test(locale) ? 0 : 1] || report?.message || "";
}
export function formatQualityReport(report, locale = localeDefault()) {
  if (!report) return "";
  const zh = /^zh/i.test(locale), labels = zh ? { quick: "快速", standard: "标准", fine: "精细", ultimate: "极致" } : { quick: "Quick", standard: "Standard", fine: "Fine", ultimate: "Ultimate" };
  const profile = labels[report.profile] || report.profile || (zh ? "自定义" : "Custom");
  const details = (report.issues || []).slice(0, 5).map(issue => `- ${issue.message || issue.code}`).join("\n");
  const assets = (report.referencedAssets || []).slice(0, 12).map(asset => `${zh ? "引用资产（非原创建模）" : "Referenced asset (not original modeling)"}: ${asset.name || (zh ? "模型" : "Model")} · ${asset.source || ""} · ${asset.license || ""} · ${asset.author || ""}\n${asset.landingUrl || ""}`).join("\n");
  return [zh ? `质量检查 · ${profile} · 主动修正 ${report.repairs || 0} 轮` : `Quality review · ${profile} · ${report.repairs || 0} repairs`, qualityReportMessage(report, locale), report.visualReason, report.error, details, assets].filter(Boolean).join("\n\n");
}

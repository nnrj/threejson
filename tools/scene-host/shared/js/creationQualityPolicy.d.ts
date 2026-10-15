import type { QualityProfile, QualityReport } from "threejson/visual-quality";
export type CreationQuality = "quick" | "standard" | "fine" | "ultimate";
export const CREATION_QUALITY_PROFILES: Readonly<Record<CreationQuality, Readonly<Omit<QualityProfile, "id">>>>;
export function resolveCreationQuality(value?: string, overrides?: Partial<QualityProfile>): QualityProfile;
export function qualityReportMessage(report: QualityReport | null | undefined, locale?: string): string;
export function formatQualityReport(report: QualityReport | null | undefined, locale?: string): string;

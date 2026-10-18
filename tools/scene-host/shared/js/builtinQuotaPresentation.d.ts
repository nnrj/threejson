export type QuotaTranslator = (key: string, fallback: string, params?: Record<string, string | number>) => string;
export function formatQuotaUsd(cents: unknown): string;
export function builtinQuotaText(quota: unknown, t: QuotaTranslator): string;
export function builtinQuotaStatusText(status: string, t: QuotaTranslator): string;
export function builtinQuotaErrorMessage(payload: unknown, t: QuotaTranslator): string;

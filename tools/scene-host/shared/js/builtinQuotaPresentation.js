/** Product UI only. Amounts in the gateway contract are USD cents, not Cloud credits. */
function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
export function formatQuotaUsd(cents) {
  const value = finite(cents);
  if (value === null) return "—";
  const dollars = Math.max(0, value) / 100;
  if (dollars > 0 && dollars < 0.0001) return "<$0.0001";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(dollars);
}
export function builtinQuotaText(quota, t) {
  if (!quota || typeof quota !== "object") return t("builtinQuota.unknown", "尚未获取额度");
  if (quota.mode === "account") {
    const credits = finite(quota.creditsRemaining);
    return t("builtinQuota.account", "账户剩余 {remaining} 次官方 AI 调用", { remaining: credits === null ? "—" : Math.max(0, credits) });
  }
  const used = finite(quota.roundsUsed), limit = finite(quota.roundsLimit);
  const costUsed = finite(quota.costUsedUsdCents), costLimit = finite(quota.costLimitUsdCents);
  return [
    t("builtinQuota.rounds", "轮数：已用 {used} / 上限 {limit} / 剩余 {remaining} 轮", {
      used: used ?? "—", limit: limit ?? "—", remaining: used === null || limit === null ? "—" : Math.max(0, limit - used)
    }),
    t("builtinQuota.cost", "金额（USD）：已用 {used} / 上限 {limit} / 剩余 {remaining}", {
      used: formatQuotaUsd(costUsed), limit: formatQuotaUsd(costLimit),
      remaining: formatQuotaUsd(costUsed === null || costLimit === null ? null : costLimit - costUsed)
    }),
    t("builtinQuota.bothRequired", "轮数和金额均需有余额。")
  ].join("\n");
}
export function builtinQuotaStatusText(status, t) {
  if (status === "fresh") return "";
  if (status === "stale") return t("builtinQuota.stale", "额度刷新失败，以上为上次记录，并非实时余额。");
  if (status === "unavailable") return t("builtinQuota.unavailable", "尚未取得实时额度。");
  return t("builtinQuota.refreshing", "正在刷新额度，以上可能为上次记录…");
}
export function builtinQuotaErrorMessage(payload, t) {
  const quota = payload?.quota || payload?.details?.quota;
  const exhausted = Array.isArray(quota?.exhausted) ? quota.exhausted : [];
  const rounds = exhausted.includes("rounds"), cost = exhausted.includes("cost");
  const message = rounds && cost
    ? t("builtinQuota.bothExhausted", "内置供应商的轮数和金额额度均已用完，请联系管理员补充额度或使用自己的供应商。")
    : cost
      ? t("builtinQuota.costExhausted", "内置供应商的金额额度已用完，即使还有剩余轮数也无法继续。请联系管理员充值金额额度或使用自己的供应商。")
      : rounds
        ? t("builtinQuota.roundsExhausted", "内置供应商的轮数额度已用完，请联系管理员增加轮数或使用自己的供应商。")
        : t("builtinQuota.exhausted", "内置供应商额度不足，请检查轮数和金额额度，联系管理员或使用自己的供应商。");
  return quota ? message + "\n" + builtinQuotaText(quota, t) : message;
}

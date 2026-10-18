import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { builtinQuotaText, builtinQuotaErrorMessage, builtinQuotaStatusText, formatQuotaUsd } from "../tools/scene-host/shared/js/builtinQuotaPresentation.js";
import { getAiErrorFeedback } from "../tools/scene-host/shared/js/aiErrorFeedback.js";
import { loadHostLocaleCatalog, t } from "../tools/scene-host/shared/i18n/index.js";

const zh = (_key, fallback, params = {}) => fallback.replace(/\{(\w+)\}/g, (_, name) => String(params[name]));
const quota = { mode: "device", roundsUsed: 248, roundsLimit: 50030, costUsedUsdCents: 100, costLimitUsdCents: 100, exhausted: ["cost"] };

test("shows both limits, precise USD values and remaining rounds when money is exhausted", () => {
  const text = builtinQuotaText(quota, zh);
  assert.match(text, /剩余 49782 轮/);
  assert.match(text, /金额（USD）：已用 \$1\.00 \/ 上限 \$1\.00 \/ 剩余 \$0\.00/);
  assert.match(text, /均需有余额/);
  assert.equal(formatQuotaUsd(123.456), "$1.2346");
  assert.equal(formatQuotaUsd(0.0001), "<$0.0001");
});

test("unknown fields are not falsely presented as zero and Cloud credits are not dollars", () => {
  const unknown = builtinQuotaText({ roundsUsed: 2, roundsLimit: 3 }, zh);
  assert.match(unknown, /金额（USD）：已用 — \/ 上限 — \/ 剩余 —/);
  assert.equal(formatQuotaUsd(null), "—");
  assert.equal(formatQuotaUsd(NaN), "—");
  assert.equal(builtinQuotaText({ mode: "account", creditsRemaining: 15 }, zh), "账户剩余 15 次官方 AI 调用");
  assert.equal(builtinQuotaText({ mode: "account", creditsRemaining: 0 }, zh), "账户剩余 0 次官方 AI 调用");
});

test("each exhausted dimension is actionable; old servers remain compatible", () => {
  assert.match(builtinQuotaErrorMessage({ quota }, zh), /金额额度已用完，即使还有剩余轮数/);
  assert.match(builtinQuotaErrorMessage({ details: { quota: { ...quota, exhausted: ["rounds"] } } }, zh), /轮数额度已用完/);
  assert.match(builtinQuotaErrorMessage({ quota: { ...quota, exhausted: ["rounds", "cost"] } }, zh), /轮数和金额额度均已用完/);
  assert.match(builtinQuotaErrorMessage({}, zh), /请检查轮数和金额额度/);
});

test("cached quota refresh status is explicit", () => {
  assert.match(builtinQuotaStatusText("stale", zh), /并非实时余额/);
  assert.match(builtinQuotaStatusText("refreshing", zh), /上次记录/);
  assert.equal(builtinQuotaStatusText("fresh", zh), "");
});

test("English quota messages survive transport wrappers and do not expose unrelated fields", async () => {
  await loadHostLocaleCatalog("en-US");
  assert.match(builtinQuotaText(quota, t), /Amount \(USD\)/);
  const feedback = getAiErrorFeedback(new Error(`AI request failed (429): ${JSON.stringify({ error: "QUOTA_EXCEEDED", quota, secret: "never-display-me" })}`));
  assert.match(feedback.message, /monetary quota is exhausted/);
  assert.match(feedback.message, /49782/);
  assert.doesNotMatch(feedback.message + feedback.detail, /never-display-me/);
});

test("static hosts and published host-kit share quota presentation and error behavior", async () => {
  for (const name of ["builtinQuotaPresentation.js", "builtinQuotaPresentation.d.ts", "aiErrorFeedback.js"]) {
    const source = await readFile(new URL(`../tools/scene-host/shared/js/${name}`, import.meta.url), "utf8");
    const packaged = await readFile(new URL(`../packages/host-kit/js/${name}`, import.meta.url), "utf8");
    assert.equal(packaged.replaceAll("\r\n", "\n"), source.replaceAll("\r\n", "\n"), name);
  }
});

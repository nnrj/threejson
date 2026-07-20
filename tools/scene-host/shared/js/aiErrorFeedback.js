import { t } from "../i18n/index.js";

const PROVIDER_CODE_BY_CLIENT_CODE = {
  BUILTIN_SAFETY_WARNING: "SAFETY_POLICY_WARNING",
  BUILTIN_DEVICE_BANNED: "DEVICE_BANNED",
  BUILTIN_DEVICE_PERMANENTLY_BANNED: "DEVICE_PERMANENTLY_BANNED",
  BUILTIN_DEVICE_MUTED: "DEVICE_MUTED",
  BUILTIN_QUOTA_EXCEEDED: "QUOTA_EXCEEDED"
};

function parseEmbeddedPayload(message) {
  const text = String(message || "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    // Wrapped errors such as `fallback: classification failed (... {json})` have a trailing
    // parenthesis after the response body. Parse only the JSON span instead of requiring the
    // entire remainder of the outer message to be JSON.
    const parsed = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function safeTechnicalDetail(error, payload, providerCode) {
  const lines = [];
  if (Number.isFinite(Number(error?.httpStatus))) lines.push(`HTTP ${Number(error.httpStatus)}`);
  if (providerCode) lines.push(`error: ${providerCode}`);
  const providerMessage = typeof payload?.message === "string"
    ? payload.message
    : typeof payload?.error?.message === "string" ? payload.error.message : "";
  if (providerMessage.trim()) lines.push(`message: ${providerMessage.trim()}`);
  const turnId = payload?.threebox_moderation?.turn_id;
  if (typeof turnId === "string" && turnId.trim()) lines.push(`turn_id: ${turnId.trim()}`);
  if (lines.length) return lines.join("\n");
  return String(error?.message || error || t("ai.error.unknownDetail", "Unknown error"));
}

/** Converts transport errors into safe user-facing semantics. It intentionally projects only
 * status/code/general message/turn id into the expandable detail and ignores rule/keyword fields. */
export function getAiErrorFeedback(error) {
  const payload = error?.providerError || parseEmbeddedPayload(error?.message);
  const payloadCode = typeof payload?.error === "string"
    ? payload.error
    : typeof payload?.error?.code === "string" ? payload.error.code : "";
  const providerCode = String(payloadCode || PROVIDER_CODE_BY_CLIENT_CODE[error?.code] || "");
  const warningCount = Number(payload?.safety_enforcement?.warning_count);
  let tone = "error";
  let message;

  if (providerCode === "SAFETY_POLICY_WARNING") {
    tone = "warning";
    message = Number.isInteger(warningCount) && warningCount > 0
      ? t("ai.error.safetyWarningCount", "您违反了我们的内容安全策略，已被警告 {count} 次。", { count: warningCount })
      : t("ai.error.safetyWarning", "您违反了我们的内容安全策略，已被警告。");
  } else if (providerCode === "DEVICE_BANNED") {
    tone = "banned";
    message = t("ai.error.deviceBanned", "您违反了我们的内容安全策略，已被封禁。");
  } else if (providerCode === "DEVICE_PERMANENTLY_BANNED") {
    tone = "banned";
    message = t("ai.error.devicePermanentlyBanned", "您已被永久封禁。");
  } else if (providerCode === "DEVICE_MUTED") {
    tone = "warning";
    message = t("ai.error.deviceMuted", "您已被暂时限制使用，请稍后再试。");
  } else if (providerCode === "QUOTA_EXCEEDED" || error?.code === "BUILTIN_QUOTA_EXCEEDED") {
    message = t("ai.error.builtinQuotaExceeded", "内置供应商的体验额度已用完，请切换为自己的供应商。");
  } else if (["INVALID_API_KEY", "INVALID_OR_EXPIRED_API_KEY", "MISSING_API_KEY"].includes(providerCode)) {
    message = t("ai.error.invalidApiKey", "API 密钥无效或已过期，请检查配置后重试。");
  } else if (providerCode === "REVOKED_API_KEY") {
    message = t("ai.error.revokedApiKey", "访问凭证已失效，请刷新后重试。");
  } else if (error?.code === "INVALID_API_KEY_HEADER_VALUE") {
    message = t("ai.error.invalidApiKeyHeader", "API Key 包含无法用于请求头的字符，请检查配置后重试。");
  } else if (error?.code === "THREEBOX_INTENT_CLASSIFICATION_FAILED") {
    message = t("ai.error.intentClassificationFailed", "未能可靠判断本次请求的操作类型，已停止本轮操作以避免错误修改场景，请重试。");
  } else if (providerCode || Number.isFinite(Number(error?.httpStatus))) {
    message = t("ai.error.failed", "处理失败，发生错误。");
  } else if (error?.code) {
    message = t("ai.error.failed", "处理失败，发生错误。");
  } else {
    message = t("ai.error.unknown", "处理失败：未知错误。");
  }

  return {
    tone,
    message,
    code: providerCode || String(error?.code || ""),
    detail: safeTechnicalDetail(error, payload, providerCode)
  };
}

export function renderAiErrorFeedback(container, error) {
  if (!container) return null;
  const feedback = getAiErrorFeedback(error);
  container.textContent = "";
  container.classList.remove("markdown-body");

  const wrapper = document.createElement("div");
  wrapper.className = `aiErrorFeedback aiErrorFeedback${feedback.tone === "warning" ? "Warning" : feedback.tone === "banned" ? "Banned" : "Error"}`;

  const details = document.createElement("details");
  details.className = "aiErrorFeedbackDetails";
  const summary = document.createElement("summary");
  summary.textContent = t("ai.error.details", "错误详情");
  const pre = document.createElement("pre");
  pre.textContent = feedback.detail;
  details.append(summary, pre);

  const text = document.createElement("div");
  text.className = "aiErrorFeedbackMessage";
  text.textContent = feedback.message;
  wrapper.append(details, text);
  container.appendChild(wrapper);
  return feedback;
}

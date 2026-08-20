import { t } from "@threejson/host-kit/i18n/index.js";

const RETRY_ICON = (
  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" d="M13 3.6v3.6H9.4M3 12.4V8.8h3.6" />
    <path fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" d="M3.6 6.6A5.2 5.2 0 0 1 13 5.3M12.4 9.4A5.2 5.2 0 0 1 3 10.7" />
  </svg>
);

function toneClass(tone) {
  if (tone === "warning") return "aiErrorFeedbackWarning";
  if (tone === "banned") return "aiErrorFeedbackBanned";
  return "aiErrorFeedbackError";
}

/** React counterpart of host-kit's renderAiErrorFeedback, with the baseline retry controls. */
export function AiErrorFeedback({ feedback, stoppedText, onRetry, onConfigureProvider, retrying = false }) {
  return (
    <div className={`aiErrorFeedback ${toneClass(feedback?.tone)}`}>
      {feedback && (
        <details className="aiErrorFeedbackDetails">
          <summary>{t("ai.error.details", "错误详情")}</summary>
          <pre>{feedback.detail}</pre>
        </details>
      )}
      <div className="aiErrorFeedbackMessage">{stoppedText || feedback?.message}</div>
      {(onRetry || onConfigureProvider) && (
        <div className="chatRetryControls">
          {onRetry && (
            <button type="button" className="chatRetryBtn" disabled={retrying} onClick={onRetry}>
              {RETRY_ICON}
              <span>{t("threebox.chat.retry", "重试")}</span>
            </button>
          )}
          {onConfigureProvider && (
            <button type="button" className="chatRetryBtn" onClick={onConfigureProvider}>
              {t("threebox.chat.configureProvider", "点此配置供应商")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

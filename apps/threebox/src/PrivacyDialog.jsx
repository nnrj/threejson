import { useEffect, useRef } from "react";
import { t } from "@threejson/host-kit/i18n/index.js";

/**
 * React rendering of the baseline built-in-provider privacy gate.
 *
 * Keep the DOM class contract in sync with host-kit's
 * builtin-provider-privacy.css so the vanilla and React ThreeBox surfaces share the same layout,
 * responsive behaviour, focus handling and locale catalogue.
 */
export function PrivacyDialog({ onAccept, onDecline }) {
  const acceptRef = useRef(null);
  const declineRef = useRef(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    document.body.classList.add("builtinPrivacyOpen");
    const focusTimer = window.setTimeout(() => acceptRef.current?.focus({ preventScroll: true }), 0);

    return () => {
      window.clearTimeout(focusTimer);
      document.body.classList.remove("builtinPrivacyOpen");
      previousFocus?.focus?.({ preventScroll: true });
    };
  }, []);

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key !== "Tab") return;
    if (event.shiftKey && document.activeElement === declineRef.current) {
      event.preventDefault();
      acceptRef.current?.focus();
    } else if (!event.shiftKey && document.activeElement === acceptRef.current) {
      event.preventDefault();
      declineRef.current?.focus();
    }
  }

  return (
    <div
      className="builtinPrivacyOverlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="builtinPrivacyTitle"
      aria-describedby="builtinPrivacyIntro"
      onKeyDown={handleKeyDown}
    >
      <div className="builtinPrivacyDialog">
        <header className="builtinPrivacyHeader">
          <h2 id="builtinPrivacyTitle">{t("builtinPrivacy.title", "ThreeBox 内置供应商隐私告知")}</h2>
        </header>
        <div className="builtinPrivacyBody">
          <p id="builtinPrivacyIntro" className="builtinPrivacyLead">
            {t(
              "builtinPrivacy.intro",
              "您必须阅读并同意以下条款，才能使用 ThreeBox 内置供应商。如果您不同意，仍可继续使用 ThreeBox，但需要在设置中自行配置模型供应商。"
            )}
          </p>

          <PrivacySection
            titleKey="builtinPrivacy.free.title"
            title="免费内置供应商"
            bodyKey="builtinPrivacy.free.body"
            body="ThreeBox 提供有使用限额的免费内置供应商，方便您无需配置即可开始使用。为防止滥用并满足服务政策，您通过内置供应商发送的每条用户消息都会先由 ThreeBox 服务器进行内容审核。"
          />

          <section className="builtinPrivacySection">
            <h3>{t("builtinPrivacy.moderation.title", "审核范围和处理措施")}</h3>
            <p>
              {t(
                "builtinPrivacy.moderation.body",
                "ThreeBox 服务器不会保存您的完整聊天记录；正常通过审核的消息不会作为聊天内容持久化。服务器会进行敏感词和意图审查，主要包括："
              )}
            </p>
            <ul className="builtinPrivacyList">
              <li>{t("builtinPrivacy.moderation.terrorism", "是否涉嫌恐怖主义；")}</li>
              <li>{t("builtinPrivacy.moderation.violence", "是否涉嫌暴力或威胁；")}</li>
              <li>{t("builtinPrivacy.moderation.sexual", "是否涉嫌色情内容（仅中国大陆地区）；")}</li>
              <li>{t("builtinPrivacy.moderation.politics", "是否涉及政治敏感内容（仅中国大陆地区）。")}</li>
            </ul>
            <p>
              {t(
                "builtinPrivacy.moderation.actions",
                "发现异常时，服务器可能记录必要的审核结果和内容摘要，并根据严重程度采取标记并放行、临时禁言或永久封禁等措施。"
              )}
            </p>
          </section>

          <PrivacySection
            titleKey="builtinPrivacy.identity.title"
            title="匿名身份标识"
            bodyKey="builtinPrivacy.identity.body"
            body="使用内置供应商时，系统会根据浏览器和设备特征生成匿名身份标识，用于限额、防滥用和执行审核措施。该标识不要求您提供真实姓名或账号。"
          />
          <PrivacySection
            titleKey="builtinPrivacy.custom.title"
            title="您自行添加的供应商"
            bodyKey="builtinPrivacy.custom.body"
            body="您自行添加的模型供应商不会经过上述 ThreeBox 审核链路，也不会与 ThreeBox 的匿名身份标识关联。自定义供应商仍可能执行其自身的内容政策、日志或账号规则；这些行为由相应供应商负责，与 ThreeBox 无关。请遵守所在地法律法规及相应供应商条款。"
          />
          <PrivacySection
            titleKey="builtinPrivacy.local.title"
            title="本地数据和备份"
            bodyKey="builtinPrivacy.local.body"
            body="无论使用内置供应商还是自行添加的供应商，ThreeBox 的设置和聊天记录都保存在您的本地浏览器缓存中，不会作为聊天历史上传至 ThreeBox 服务器。请及时导出并妥善保存重要场景和模型；清理浏览器缓存可能导致会话历史永久丢失。"
          />

          <p className="builtinPrivacyDeclineNote">
            {t(
              "builtinPrivacy.declineNote",
              "如果您选择“我拒绝”，内置供应商将被禁用。之后可在供应商设置中点击“查看协议”，重新阅读并作出选择。"
            )}
          </p>
        </div>
        <footer className="builtinPrivacyFooter">
          <button
            ref={declineRef}
            type="button"
            className="builtinPrivacyButton builtinPrivacyDecline"
            onClick={onDecline}
          >
            {t("builtinPrivacy.decline", "我拒绝")}
          </button>
          <button
            ref={acceptRef}
            type="button"
            className="builtinPrivacyButton builtinPrivacyAccept"
            onClick={onAccept}
          >
            {t("builtinPrivacy.accept", "我同意")}
          </button>
        </footer>
      </div>
    </div>
  );
}

function PrivacySection({ titleKey, title, bodyKey, body }) {
  return (
    <section className="builtinPrivacySection">
      <h3>{t(titleKey, title)}</h3>
      <p>{t(bodyKey, body)}</p>
    </section>
  );
}

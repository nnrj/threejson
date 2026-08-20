/**
 * Schema-driven settings modal, ported from tools/scene-host/threebox/js/threeBoxSettingsModal.js
 * (structure follows threebox-cloud's React port). Nav + section panels + a generic field loop
 * driven by THREEBOX_SETTINGS_FIELDS, plus the special AI-providers section (an editable array of
 * saved provider configs the composer picks from per-message).
 *
 * Includes provider editing, live built-in quota, endpoint checks, thumbnail-cache controls,
 * self-hosted sync and the schema-driven product settings.
 */
import { useEffect, useState } from "react";
import { t } from "@threejson/host-kit/i18n/index.js";
import { probeEndpoint } from "@threejson/host-kit/js/endpointProbe.js";
import { getDisplayDeviceId } from "@threejson/host-kit/js/builtinAiProvider.js";
import { clearThumbnailCache, rebuildAllTemplateThumbnails } from "./lib/threeBoxTemplateThumbnails.js";
import { refreshBuiltinQuota } from "./lib/threeBoxBuiltinProvider.js";
import { threeBoxSettingsController } from "./useThreeBoxSettings.js";
import { getThreeBoxSettings, setThreeBoxSettings, useThreeBoxSettings } from "./useThreeBoxSettings.js";
import { cloneThreeBoxSettings, getSettingsByPath, setSettingsByPath } from "./lib/threeBoxSettingsStore.js";
import {
  THREEBOX_BUILTIN_PROVIDER_TYPE,
  THREEBOX_PROVIDER_TYPES,
  THREEBOX_SETTINGS_FIELDS,
  THREEBOX_SETTINGS_SECTIONS,
  THREEBOX_VERSION
} from "./lib/threeBoxSettingsSchema.js";

function createProviderId() {
  return `provider-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
function fieldLabelKey(field) {
  return `threebox.settings.field.${field.path.replace(/\./g, "_")}`;
}
function fieldPlaceholderKey(field) {
  return `threebox.settings.fieldPlaceholder.${field.path.replace(/\./g, "_")}`;
}
function fieldHintKey(field) {
  return `threebox.settings.fieldHint.${field.path.replace(/\./g, "_")}`;
}
function optionLabelKey(field, value) {
  return `threebox.settings.option.${field.path.replace(/\./g, "_")}.${value}`;
}
function sectionTitleKey(sectionId) {
  return `threebox.settings.section.${sectionId}`;
}
function fieldsForSection(sectionId) {
  return THREEBOX_SETTINGS_FIELDS.filter((f) => f.section === sectionId);
}

function GenericField({ field, draft, onChange, onTestEndpoint }) {
  const value = getSettingsByPath(draft, field.path);
  const [testState, setTestState] = useState("idle");
  const [testMessage, setTestMessage] = useState("");

  async function runTest(currentValue) {
    if (!field.testEndpoint) {
      return;
    }
    setTestState("testing");
    try {
      const result = onTestEndpoint
        ? await onTestEndpoint(field.testEndpoint, currentValue)
        : await probeEndpoint(currentValue, "/health");
      setTestState(result.ok ? "success" : "failed");
      setTestMessage(result.ok ? "" : result.message || "unreachable");
    } catch (error) {
      setTestState("failed");
      setTestMessage(error?.message || "unreachable");
    } finally {
      setTimeout(() => setTestState("idle"), 2200);
    }
  }

  let control;
  if (field.type === "checkbox") {
    control = <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(field.path, e.target.checked)} />;
  } else if (field.type === "select") {
    control = (
      <select value={value ?? ""} onChange={(e) => onChange(field.path, e.target.value)}>
        {(field.options || []).map(([optValue, optLabel]) => (
          <option key={optValue} value={optValue}>
            {t(optionLabelKey(field, optValue), optLabel)}
          </option>
        ))}
      </select>
    );
  } else if (field.type === "number") {
    control = (
      <input
        type="number"
        min={field.min}
        max={field.max}
        value={value ?? 0}
        onChange={(e) => onChange(field.path, Number(e.target.value))}
      />
    );
  } else if (field.type === "textarea") {
    control = (
      <textarea
        rows={field.rows || 3}
        placeholder={field.placeholder ? t(fieldPlaceholderKey(field), field.placeholder) : ""}
        value={value ?? ""}
        onChange={(e) => onChange(field.path, e.target.value)}
      />
    );
  } else {
    control = (
      <input
        type={field.type === "password" ? "password" : "text"}
        placeholder={field.placeholder ? t(fieldPlaceholderKey(field), field.placeholder) : ""}
        value={value ?? ""}
        onChange={(e) => onChange(field.path, e.target.value)}
      />
    );
  }

  const testLabel =
    testState === "testing"
      ? t("threebox.settings.testEndpointTesting", "测试中…")
      : testState === "success"
        ? t("threebox.settings.testEndpointSuccess", "已连接")
        : testState === "failed"
          ? t("threebox.settings.testEndpointFailed", `失败：${testMessage || "无法连接"}`)
          : t("threebox.settings.testEndpoint", "测试");

  return (
    <div className="settingsField">
      <label className="settingsFieldLabel">{t(fieldLabelKey(field), field.label)}</label>
      <div className="settingsFieldControl">
        {control}
        {field.testEndpoint && (
          <button
            type="button"
            className="settingsActionBtn settingsTestEndpointBtn"
            disabled={testState === "testing"}
            onClick={() => void runTest(String(value ?? "").trim())}
          >
            {testLabel}
          </button>
        )}
      </div>
      {field.hint && (
        <div className="settingsFieldHint">{t(fieldHintKey(field), field.hint)}</div>
      )}
    </div>
  );
}

/** Special-cased card for the auto-seeded built-in trial provider: no editable base URL/model/key
 * (auto-managed), no delete button — shows the device's support ID and the privacy consent gate.
 * Shows the device support ID and the live remaining-quota readout (GET /v1/quota via
 * refreshBuiltinQuota). */
function BuiltinProviderCard({ provider, privacyAccepted, onOpenPrivacy, showToast }) {
  const [deviceId, setDeviceId] = useState(t("threebox.settings.provider.deviceIdLoading", "获取中…"));
  const [quota, setQuota] = useState(provider?.builtinQuota);

  useEffect(() => {
    let cancelled = false;
    void getDisplayDeviceId().then((id) => {
      if (!cancelled) {
        setDeviceId(id);
      }
    });
    void refreshBuiltinQuota(threeBoxSettingsController).then((fresh) => {
      if (!cancelled && fresh) {
        setQuota(fresh);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function formatQuota(q) {
    const parsed = q || null;
    if (!parsed) {
      return t("threebox.settings.provider.quotaUnknown", "尚未获取（保存设置后自动申请）");
    }
    const used = Number(parsed.roundsUsed) || 0;
    const remaining = Math.max(0, (Number(parsed.roundsLimit) || 0) - used);
    return t("threebox.settings.provider.quotaValue", "已用 {used} 轮 / 剩余 {remaining} 轮", { used, remaining });
  }

  async function copyDeviceId() {
    try {
      await navigator.clipboard.writeText(deviceId);
      showToast?.(t("threebox.settings.provider.deviceIdCopied", "识别 ID 已复制。"), "success");
    } catch {
      showToast?.(t("threebox.settings.provider.deviceIdCopyFailed", "复制失败，请手动选中复制。"), "error");
    }
  }

  return (
    <div className="providerCard providerCardBuiltin">
      <div className="providerCardRow providerBuiltinHeading">
        {t("threebox.settings.provider.builtinLabel", "ThreeBox 内置供应商（限额体验）")}
      </div>
      <div className="providerCardRow">
        <label>{t("threebox.settings.provider.deviceIdLabel", "识别 ID")}</label>
        <div className="providerBuiltinIdControl">
          <code>{deviceId}</code>
          <button type="button" className="settingsActionBtn" onClick={() => void copyDeviceId()}>
            {t("threebox.settings.provider.copyDeviceId", "复制")}
          </button>
        </div>
      </div>
      <div className="settingsFieldHint">
        {t("threebox.settings.provider.deviceIdHint", "清除浏览器缓存后此 ID 保持不变；如遇问题请附带此 ID 反馈。")}
      </div>
      <div className="providerCardRow">
        <label>{t("threebox.settings.provider.quotaLabel", "剩余额度")}</label>
        <span>{formatQuota(quota)}</span>
      </div>
      {!privacyAccepted && (
        <div className="providerBuiltinConsentNotice">
          <span>{t("builtinPrivacy.required", "您必须同意使用协议才能使用内置模型。")}</span>
          <button type="button" className="settingsActionBtn" onClick={() => onOpenPrivacy?.()}>
            {t("builtinPrivacy.viewAgreement", "查看协议")}
          </button>
        </div>
      )}
    </div>
  );
}

function ProviderCard({ provider, onChange, onDelete }) {
  const [keyRevealed, setKeyRevealed] = useState(false);

  return (
    <div className="providerCard">
      <div className="providerCardRow">
        <label>{t("threebox.settings.provider.nameLabel", "名称")}</label>
        <input
          type="text"
          value={provider.label || ""}
          placeholder={t("threebox.settings.provider.namePlaceholder", "例如：我的 OpenAI")}
          onChange={(e) => onChange({ ...provider, label: e.target.value })}
        />
      </div>
      <div className="providerCardRow">
        <label>{t("threebox.settings.provider.typeLabel", "供应商")}</label>
        <select value={provider.provider || "chatgpt"} onChange={(e) => onChange({ ...provider, provider: e.target.value })}>
          {THREEBOX_PROVIDER_TYPES.filter(([val]) => val !== THREEBOX_BUILTIN_PROVIDER_TYPE).map(([val, text]) => (
            <option key={val} value={val}>
              {t(`threebox.settings.providerType.${val}`, text)}
            </option>
          ))}
        </select>
      </div>
      {provider.provider === "custom" && (
        <div className="providerCardRow">
          <label>{t("threebox.settings.provider.baseUrlLabel", "Base URL")}</label>
          <input
            type="text"
            value={provider.baseUrl || ""}
            placeholder="https://..."
            onChange={(e) => onChange({ ...provider, baseUrl: e.target.value })}
          />
        </div>
      )}
      <div className="providerCardRow">
        <label>{t("threebox.settings.provider.apiKeyLabel", "API Key")}</label>
        <div className="providerSecretControl">
          <input
            type={keyRevealed ? "text" : "password"}
            className="providerApiKeyInput"
            autoComplete="off"
            value={provider.apiKey || ""}
            onChange={(e) => onChange({ ...provider, apiKey: e.target.value })}
          />
          <button
            type="button"
            className="providerSecretToggle"
            aria-pressed={keyRevealed}
            aria-label={t(
              keyRevealed ? "threebox.settings.provider.hideApiKey" : "threebox.settings.provider.showApiKey",
              keyRevealed ? "隐藏 API Key" : "显示 API Key"
            )}
            title={t(
              keyRevealed ? "threebox.settings.provider.hideApiKey" : "threebox.settings.provider.showApiKey",
              keyRevealed ? "隐藏 API Key" : "显示 API Key"
            )}
            onClick={() => setKeyRevealed((v) => !v)}
          >
            {keyRevealed ? (
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M3 3l14 14M8.6 5.2A8.7 8.7 0 0 1 10 5c4.7 0 7.5 5 7.5 5a13 13 0 0 1-2.1 2.7M11.7 11.7A2.4 2.4 0 0 1 8.3 8.3M6.1 6.1C3.8 7.5 2.5 10 2.5 10s2.8 5 7.5 5c1 0 1.9-.2 2.7-.5" />
              </svg>
            ) : (
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M2.5 10s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5z" />
                <circle cx="10" cy="10" r="2.5" />
              </svg>
            )}
          </button>
        </div>
      </div>
      <div className="providerCardRow">
        <label>{t("threebox.settings.provider.modelLabel", "模型")}</label>
        <input
          type="text"
          value={provider.model || ""}
          placeholder={t("threebox.settings.provider.modelPlaceholder", "留空使用默认模型")}
          onChange={(e) => onChange({ ...provider, model: e.target.value })}
        />
      </div>
      <button type="button" className="providerCardDeleteBtn" onClick={onDelete}>
        {t("threebox.settings.provider.deleteBtn", "删除此供应商")}
      </button>
    </div>
  );
}

function AiSection({ draft, setDraft, onChange, privacyAccepted, onOpenPrivacy, showToast }) {
  const providers = draft.ai.providers || [];

  function updateProvider(index, next) {
    setDraft((prev) => {
      const nextProviders = [...prev.ai.providers];
      nextProviders[index] = next;
      return { ...prev, ai: { ...prev.ai, providers: nextProviders } };
    });
  }
  function deleteProvider(id) {
    setDraft((prev) => {
      const nextProviders = prev.ai.providers.filter((p) => p.id !== id);
      const nextDefault = prev.ai.defaultProviderId === id ? nextProviders[0]?.id || "" : prev.ai.defaultProviderId;
      return { ...prev, ai: { ...prev.ai, providers: nextProviders, defaultProviderId: nextDefault } };
    });
  }
  function addProvider() {
    setDraft((prev) => {
      const id = createProviderId();
      const nextProviders = [
        ...prev.ai.providers,
        {
          id,
          label: t("threebox.settings.defaultProviderName", "供应商 {n}", { n: prev.ai.providers.length + 1 }),
          provider: "chatgpt",
          model: "",
          apiKey: "",
          baseUrl: ""
        }
      ];
      return { ...prev, ai: { ...prev.ai, providers: nextProviders, defaultProviderId: prev.ai.defaultProviderId || id } };
    });
  }

  const selectableDefault = providers.find((p) => p.provider !== THREEBOX_BUILTIN_PROVIDER_TYPE || privacyAccepted);
  const configuredDefault = providers.find(
    (p) => p.id === draft.ai.defaultProviderId && (p.provider !== THREEBOX_BUILTIN_PROVIDER_TYPE || privacyAccepted)
  );
  const defaultValue = configuredDefault?.id || selectableDefault?.id || draft.ai.defaultProviderId || providers[0]?.id || "";

  return (
    <div className="settingsSectionPanel">
      <div className="settingsSectionHeading">{t("threebox.settings.providersHeading", "模型供应商")}</div>
      <div className="providerList">
        {providers.length === 0 && (
          <div className="settingsEmptyHint">
            {t("threebox.settings.providersEmptyHint", "尚未添加任何供应商，添加后可在聊天输入框选择使用的模型。")}
          </div>
        )}
        {providers.map((provider, index) =>
          provider.provider === THREEBOX_BUILTIN_PROVIDER_TYPE ? (
            <BuiltinProviderCard
              key={provider.id}
              provider={provider}
              privacyAccepted={privacyAccepted}
              onOpenPrivacy={onOpenPrivacy}
              showToast={showToast}
            />
          ) : (
            <ProviderCard
              key={provider.id}
              provider={provider}
              onChange={(next) => updateProvider(index, next)}
              onDelete={() => deleteProvider(provider.id)}
            />
          )
        )}
      </div>
      <button type="button" className="addProviderBtn" onClick={addProvider}>
        {t("threebox.settings.addProviderBtn", "+ 添加供应商")}
      </button>
      {providers.length > 0 && (
        <div className="settingsField">
          <label className="settingsFieldLabel">{t("threebox.settings.defaultProviderLabel", "默认模型供应商")}</label>
          <div className="settingsFieldControl">
            <select
              value={defaultValue}
              onChange={(e) => setDraft((prev) => ({ ...prev, ai: { ...prev.ai, defaultProviderId: e.target.value } }))}
            >
              {providers.map((provider) => (
                <option
                  key={provider.id}
                  value={provider.id}
                  disabled={provider.provider === THREEBOX_BUILTIN_PROVIDER_TYPE && !privacyAccepted}
                >
                  {provider.label || provider.id}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
      <div className="settingsSectionHeading">{t("threebox.settings.behaviorHeading", "生成与调整行为")}</div>
      {fieldsForSection("ai").map((field) => (
        <GenericField key={field.path} field={field} draft={draft} onChange={onChange} />
      ))}
    </div>
  );
}

function GeneralSection({ draft, onChange, showToast }) {
  return (
    <div className="settingsSectionPanel">
      {fieldsForSection("general").map((field) => (
        <GenericField key={field.path} field={field} draft={draft} onChange={onChange} />
      ))}
      <div className="settingsSectionHeading">{t("threebox.settings.templateThumbHeading", "模板库缩略图缓存")}</div>
      <div className="settingsButtonRow">
        <button
          type="button"
          className="settingsActionBtn"
          onClick={() => {
            rebuildAllTemplateThumbnails();
            showToast?.(t("threebox.settings.rebuildThumbCacheToast", "正在后台重新生成模板缩略图…"), "info");
          }}
        >
          {t("threebox.settings.rebuildThumbCacheBtn", "重建缩略图缓存")}
        </button>
        <button
          type="button"
          className="settingsActionBtn"
          onClick={() => {
            clearThumbnailCache();
            showToast?.(t("threebox.settings.clearThumbCacheToast", "模板缩略图缓存已清空。"), "success");
          }}
        >
          {t("threebox.settings.clearThumbCacheBtn", "清空缩略图缓存")}
        </button>
      </div>
    </div>
  );
}

function SyncSection({ draft, onChange, onSyncNow, showToast }) {
  const [syncing, setSyncing] = useState(false);
  const configured = draft.sync?.enabled === true && Boolean(String(draft.sync?.endpoint || "").trim());

  async function runSyncNow() {
    if (!onSyncNow) {
      return;
    }
    setSyncing(true);
    try {
      await onSyncNow();
      showToast?.(t("threebox.settings.sync.syncedToast", "会话已同步。"), "success");
    } catch (error) {
      showToast?.(
        t("threebox.settings.sync.syncFailedToast", "同步失败：{error}", { error: error?.message || error }),
        "error"
      );
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="settingsSectionPanel">
      {fieldsForSection("sync").map((field) => (
        <GenericField
          key={field.path}
          field={field}
          draft={draft}
          onChange={onChange}
          onTestEndpoint={field.testEndpoint === "selfHostedSync" && onSyncNow
            ? async () => { await onSyncNow(); return { ok: true }; }
            : undefined}
        />
      ))}
      <div className="settingsButtonRow">
        <button type="button" className="settingsActionBtn" disabled={!configured || syncing} onClick={() => void runSyncNow()}>
          {syncing
            ? t("threebox.settings.sync.syncingBtn", "同步中…")
            : t("threebox.settings.sync.syncNowBtn", "立即同步")}
        </button>
      </div>
      <div className="settingsFieldHint">
        {t(
          "threebox.settings.sync.hint",
          "先填写并保存同步服务器地址后，此按钮才会生效。合并策略为按更新时间的后写覆盖，且不会删除本地记录。"
        )}
      </div>
    </div>
  );
}

function AboutSection() {
  return (
    <div className="settingsSectionPanel">
      <p>{t("threebox.settings.about.version", "ThreeBox v{version}", { version: THREEBOX_VERSION })}</p>
      <p>{t("threebox.settings.about.builtOn", "基于 ThreeJSON 与 Three.js 构建。")}</p>
      <p>
        <span>{t("threebox.settings.about.websiteLabel", "ThreeJSON 官网：")}</span>
        <a href="https://threejson.org/website/" target="_blank" rel="noreferrer">
          threejson.org
        </a>
      </p>
      <div className="settingsSectionHeading">{t("threebox.settings.about.contactHeading", "联系我们")}</div>
      <ul className="helpContactList">
        <li>
          <span>{t("threebox.help.emailLabel", "邮箱反馈：")}</span>
          <a href="mailto:threejson@outlook.com">threejson@outlook.com</a>
        </li>
        <li>
          <span>{t("threebox.help.issuesLabel", "或访问 GitHub 仓库提交 Issue：")}</span>
          <a href="https://github.com/nnrj/threejson/issues" target="_blank" rel="noreferrer">
            github.com/nnrj/threejson/issues
          </a>
        </li>
      </ul>
    </div>
  );
}

/**
 * @param {object} props
 * @param {string} [props.initialSectionId]
 * @param {() => void} props.onClose
 * @param {boolean} props.privacyAccepted   whether the built-in provider agreement is accepted
 * @param {() => void} [props.onOpenPrivacy] open the privacy dialog (built-in provider gate)
 * @param {(text: string, kind?: string) => void} [props.showToast]
 */
export function SettingsModal({ initialSectionId = "general", onClose, privacyAccepted, onOpenPrivacy, showToast, onSyncNow }) {
  // Subscribe so an external settings change (e.g. dev provider seeding) reflows this modal.
  useThreeBoxSettings();
  const [draft, setDraft] = useState(() => cloneThreeBoxSettings(getThreeBoxSettings()));
  const [activeSectionId, setActiveSectionId] = useState(
    THREEBOX_SETTINGS_SECTIONS.some((s) => s.id === initialSectionId) ? initialSectionId : "general"
  );

  function handleFieldChange(path, value) {
    setDraft((prev) => {
      const next = cloneThreeBoxSettings(prev);
      setSettingsByPath(next, path, value);
      return next;
    });
  }

  function handleSave() {
    setThreeBoxSettings(draft);
    showToast?.(t("threebox.settings.savedToast", "设置已保存。"), "success");
    onClose();
  }

  const sectionProps = { draft, setDraft, onChange: handleFieldChange };

  return (
    <div
      className="modalOverlay"
      id="settingsModal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settingsModalTitle"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="modalDialog settingsDialog">
        <div className="modalHeader" id="settingsModalTitle">
          {t("threebox.shell.settingsTitle", "设置")}
        </div>
        <div className="settingsBody">
          <nav className="settingsNav" id="settingsNav">
            {THREEBOX_SETTINGS_SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                className={`settingsNavBtn${section.id === activeSectionId ? " active" : ""}`}
                onClick={() => setActiveSectionId(section.id)}
              >
                {t(sectionTitleKey(section.id), section.title)}
              </button>
            ))}
          </nav>
          <div className="settingsScroll" id="settingsScroll">
            {activeSectionId === "ai" ? (
              <AiSection
                {...sectionProps}
                privacyAccepted={privacyAccepted}
                onOpenPrivacy={onOpenPrivacy}
                showToast={showToast}
              />
            ) : activeSectionId === "general" ? (
              <GeneralSection draft={draft} onChange={handleFieldChange} showToast={showToast} />
            ) : activeSectionId === "sync" ? (
              <SyncSection draft={draft} onChange={handleFieldChange} onSyncNow={onSyncNow} showToast={showToast} />
            ) : activeSectionId === "about" ? (
              <AboutSection />
            ) : (
              <div className="settingsSectionPanel">
                {fieldsForSection(activeSectionId).map((field) => (
                  <GenericField key={field.path} field={field} draft={draft} onChange={handleFieldChange} />
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="modalFooter">
          <button type="button" id="settingsCancelBtn" onClick={onClose}>
            {t("threebox.shell.cancel", "取消")}
          </button>
          <button type="button" id="settingsSaveBtn" className="primary" onClick={handleSave}>
            {t("threebox.shell.save", "保存")}
          </button>
        </div>
      </div>
    </div>
  );
}

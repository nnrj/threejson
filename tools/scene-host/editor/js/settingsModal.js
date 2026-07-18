import {
  EDITOR_BUILTIN_PROVIDER_ID,
  EDITOR_PROVIDER_TYPES,
  EDITOR_SETTINGS_FIELDS,
  EDITOR_SETTINGS_SECTIONS
} from "../../shared/js/editorSettingsSchema.js";
import {
  cloneEditorSettings,
  deepMergeEditorSettings,
  getSettingsByPath,
  setSettingsByPath
} from "../../shared/js/editorSettingsStore.js";
import { fetchBuiltinQuota } from "../../shared/js/builtinAiProvider.js";
import { BUILTIN_PROVIDER_TYPE, getDisplayDeviceId } from "./editorBuiltinAiProvider.js";
import { t } from "../../shared/i18n/index.js";

function createEditorProviderId() {
  return `provider-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function settingsText(key, fallback) {
  return t(key, fallback);
}

function writeSettingsFieldValueToInput(field, inputEl, value) {
  if (!inputEl) {
    return;
  }
  if (field.type === "checkbox") {
    inputEl.checked = Boolean(value);
    return;
  }
  if (field.type === "select") {
    inputEl.value = value != null ? String(value) : "";
    return;
  }
  if (field.type === "number") {
    inputEl.value = value != null && Number.isFinite(Number(value)) ? String(value) : "";
    return;
  }
  if (field.type === "textarea") {
    inputEl.value = value != null ? String(value) : "";
    return;
  }
  if (field.path === "capture.recordBitrateBps") {
    inputEl.value = value != null && value > 0 ? String(value) : "";
    return;
  }
  inputEl.value = value != null ? String(value) : "";
}

function readSettingsFieldValueFromInput(field, inputEl) {
  if (!inputEl) {
    return undefined;
  }
  if (field.type === "checkbox") {
    return inputEl.checked;
  }
  if (field.type === "number") {
    const n = Number(inputEl.value);
    return Number.isFinite(n) ? n : undefined;
  }
  if (field.path === "capture.recordBitrateBps") {
    const raw = String(inputEl.value || "").trim();
    if (!raw) {
      return null;
    }
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return inputEl.value;
}

export function createSettingsModalController({ host, onSave, onReset }) {
  const modal = document.getElementById("editorSettingsModal");
  const nav = document.getElementById("editorSettingsNav");
  const scroll = document.getElementById("editorSettingsScroll");
  const saveBtn = document.getElementById("editorSettingsSaveBtn");
  const cancelBtn = document.getElementById("editorSettingsCancelBtn");
  const resetBtn = document.getElementById("editorSettingsResetBtn");
  let draft = null;
  let scrollObserver = null;
  let providerListEl = null;
  let defaultProviderRowEl = null;

  /** Special-cased card for the auto-seeded built-in trial provider: no editable base URL / model
   * / API key (auto-managed) and no delete button (it's the zero-config fallback), instead
   * showing the device's support ID and remaining trial quota. Mirrors ThreeBox's
   * buildBuiltinProviderCard (threeBoxSettingsModal.js). */
  function buildBuiltinProviderCard(provider) {
    const card = document.createElement("div");
    card.className = "editorProviderCard editorProviderCardBuiltin";

    const heading = document.createElement("div");
    heading.className = "editorProviderCardRow editorProviderBuiltinHeading";
    heading.textContent = settingsText("settings.provider.builtinLabel", "编辑器内置供应商（限额体验）");
    card.appendChild(heading);

    const idRow = document.createElement("div");
    idRow.className = "editorProviderCardRow";
    const idLabel = document.createElement("label");
    idLabel.textContent = settingsText("settings.provider.deviceIdLabel", "识别 ID");
    const idControl = document.createElement("div");
    idControl.className = "editorProviderBuiltinIdControl";
    const idValue = document.createElement("code");
    idValue.textContent = settingsText("settings.provider.deviceIdLoading", "获取中…");
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "editorSettingsActionBtn";
    copyBtn.textContent = settingsText("settings.provider.copyDeviceId", "复制");
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(idValue.textContent || "");
      } catch {
        /* ignore — clipboard permission not granted */
      }
    });
    getDisplayDeviceId().then((id) => {
      idValue.textContent = id;
    });
    idControl.appendChild(idValue);
    idControl.appendChild(copyBtn);
    idRow.appendChild(idLabel);
    idRow.appendChild(idControl);
    card.appendChild(idRow);

    const idHint = document.createElement("div");
    idHint.className = "editorSettingsHint";
    idHint.textContent = settingsText(
      "settings.provider.deviceIdHint",
      "清除浏览器缓存后此 ID 保持不变；此 ID 与 ThreeBox 使用同一套设备识别逻辑，限额统一计算。"
    );
    card.appendChild(idHint);

    const quotaRow = document.createElement("div");
    quotaRow.className = "editorProviderCardRow";
    const quotaLabel = document.createElement("label");
    quotaLabel.textContent = settingsText("settings.provider.quotaLabel", "剩余额度");
    const quotaValue = document.createElement("span");
    function formatQuota(quota) {
      return quota
        ? settingsText("settings.provider.quotaValue", "{used}/{limit} 轮，预估花费 {costUsed}/{costLimit} 美分")
            .replace("{used}", quota.roundsUsed)
            .replace("{limit}", quota.roundsLimit)
            .replace("{costUsed}", Math.round(quota.costUsedUsdCents))
            .replace("{costLimit}", Math.round(quota.costLimitUsdCents))
        : settingsText("settings.provider.quotaUnknown", "尚未获取（保存设置后自动申请）");
    }
    quotaValue.textContent = formatQuota(provider.builtinQuota);
    quotaRow.appendChild(quotaLabel);
    quotaRow.appendChild(quotaValue);
    card.appendChild(quotaRow);

    if (provider.apiKey) {
      const base = String(draft?.ai?.builtinBackendUrl || "").replace(/\/$/, "");
      fetchBuiltinQuota(base, provider.apiKey)
        .then((body) => {
          provider.builtinQuota = body.quota;
          provider.builtinShortId = body.shortId;
          quotaValue.textContent = formatQuota(body.quota);
        })
        .catch(() => {
          /* keep showing the cached quota on failure */
        });
    }

    return card;
  }

  function buildProviderCard(provider) {
    if (provider.provider === BUILTIN_PROVIDER_TYPE) {
      return buildBuiltinProviderCard(provider);
    }
    const card = document.createElement("div");
    card.className = "editorProviderCard";

    const labelRow = document.createElement("div");
    labelRow.className = "editorProviderCardRow";
    const labelLabel = document.createElement("label");
    labelLabel.textContent = settingsText("settings.provider.nameLabel", "名称");
    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.value = provider.label || "";
    labelInput.placeholder = settingsText("settings.provider.namePlaceholder", "例如：我的 OpenAI");
    labelInput.addEventListener("input", () => {
      provider.label = labelInput.value;
    });
    labelRow.appendChild(labelLabel);
    labelRow.appendChild(labelInput);
    card.appendChild(labelRow);

    const typeRow = document.createElement("div");
    typeRow.className = "editorProviderCardRow";
    const typeLabel = document.createElement("label");
    typeLabel.textContent = settingsText("settings.provider.typeLabel", "供应商");
    const typeSelect = document.createElement("select");
    // The built-in trial type is never user-selectable here — see the same note in
    // threeBoxSettingsModal.js's buildProviderCard.
    for (const [val, text] of EDITOR_PROVIDER_TYPES) {
      if (val === BUILTIN_PROVIDER_TYPE) continue;
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = settingsText(`settings.providerType.${val}`, text);
      typeSelect.appendChild(opt);
    }
    typeSelect.value = provider.provider || "chatgpt";
    typeSelect.addEventListener("change", () => {
      provider.provider = typeSelect.value;
      renderProviderList();
    });
    typeRow.appendChild(typeLabel);
    typeRow.appendChild(typeSelect);
    card.appendChild(typeRow);

    if (provider.provider === "custom") {
      const baseUrlRow = document.createElement("div");
      baseUrlRow.className = "editorProviderCardRow";
      const baseUrlLabel = document.createElement("label");
      baseUrlLabel.textContent = settingsText("settings.provider.baseUrlLabel", "Base URL");
      const baseUrlInput = document.createElement("input");
      baseUrlInput.type = "text";
      baseUrlInput.value = provider.baseUrl || "";
      baseUrlInput.placeholder = "https://...";
      baseUrlInput.addEventListener("input", () => {
        provider.baseUrl = baseUrlInput.value;
      });
      baseUrlRow.appendChild(baseUrlLabel);
      baseUrlRow.appendChild(baseUrlInput);
      card.appendChild(baseUrlRow);
    }

    const keyRow = document.createElement("div");
    keyRow.className = "editorProviderCardRow";
    const keyLabel = document.createElement("label");
    keyLabel.textContent = settingsText("settings.provider.apiKeyLabel", "API Key");
    const keyInput = document.createElement("input");
    keyInput.type = "password";
    keyInput.className = "editorProviderApiKeyInput";
    keyInput.value = provider.apiKey || "";
    keyInput.autocomplete = "off";
    keyInput.addEventListener("input", () => {
      provider.apiKey = keyInput.value;
    });

    const keyControl = document.createElement("div");
    keyControl.className = "editorProviderSecretControl";
    const keyVisibilityBtn = document.createElement("button");
    keyVisibilityBtn.type = "button";
    keyVisibilityBtn.className = "editorProviderSecretToggle";
    keyVisibilityBtn.setAttribute("aria-pressed", "false");

    function updateKeyVisibilityButton(revealed) {
      const label = revealed
        ? settingsText("settings.provider.hideApiKey", "隐藏 API Key")
        : settingsText("settings.provider.showApiKey", "显示 API Key");
      keyVisibilityBtn.setAttribute("aria-label", label);
      keyVisibilityBtn.title = label;
      keyVisibilityBtn.innerHTML = revealed
        ? '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 3l14 14M8.6 5.2A8.7 8.7 0 0 1 10 5c4.7 0 7.5 5 7.5 5a13 13 0 0 1-2.1 2.7M11.7 11.7A2.4 2.4 0 0 1 8.3 8.3M6.1 6.1C3.8 7.5 2.5 10 2.5 10s2.8 5 7.5 5c1 0 1.9-.2 2.7-.5"/></svg>'
        : '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 10s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5z"/><circle cx="10" cy="10" r="2.5"/></svg>';
    }

    updateKeyVisibilityButton(false);
    keyVisibilityBtn.addEventListener("click", () => {
      const revealed = keyInput.type === "password";
      keyInput.type = revealed ? "text" : "password";
      keyVisibilityBtn.setAttribute("aria-pressed", String(revealed));
      updateKeyVisibilityButton(revealed);
      keyInput.focus({ preventScroll: true });
      const cursor = keyInput.value.length;
      keyInput.setSelectionRange?.(cursor, cursor);
    });

    keyControl.appendChild(keyInput);
    keyControl.appendChild(keyVisibilityBtn);
    keyRow.appendChild(keyLabel);
    keyRow.appendChild(keyControl);
    card.appendChild(keyRow);

    const modelRow = document.createElement("div");
    modelRow.className = "editorProviderCardRow";
    const modelLabel = document.createElement("label");
    modelLabel.textContent = settingsText("settings.provider.modelLabel", "模型");
    const modelInput = document.createElement("input");
    modelInput.type = "text";
    modelInput.value = provider.model || "";
    modelInput.placeholder = settingsText("settings.provider.modelPlaceholder", "留空使用默认模型");
    modelInput.addEventListener("input", () => {
      provider.model = modelInput.value;
    });
    modelRow.appendChild(modelLabel);
    modelRow.appendChild(modelInput);
    card.appendChild(modelRow);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "editorProviderCardDeleteBtn";
    deleteBtn.textContent = settingsText("settings.provider.deleteBtn", "删除此供应商");
    deleteBtn.addEventListener("click", () => {
      draft.ai.providers = draft.ai.providers.filter((p) => p.id !== provider.id);
      if (draft.ai.defaultProviderId === provider.id) {
        draft.ai.defaultProviderId = draft.ai.providers[0]?.id || "";
      }
      renderProviderList();
    });
    card.appendChild(deleteBtn);

    return card;
  }

  function renderProviderList() {
    if (!providerListEl || !draft) {
      return;
    }
    providerListEl.innerHTML = "";
    const providers = Array.isArray(draft.ai.providers) ? draft.ai.providers : [];
    if (!providers.length) {
      const hint = document.createElement("div");
      hint.className = "editorSettingsHint";
      hint.textContent = settingsText("settings.providersEmptyHint", "尚未添加任何供应商，添加后可在「AI 编辑」标签页选择使用。");
      providerListEl.appendChild(hint);
    } else {
      for (const provider of providers) {
        providerListEl.appendChild(buildProviderCard(provider));
      }
    }

    if (!defaultProviderRowEl) {
      return;
    }
    defaultProviderRowEl.innerHTML = "";
    if (!providers.length) {
      return;
    }
    const defaultLabel = document.createElement("label");
    defaultLabel.textContent = settingsText("settings.defaultProviderLabel", "默认模型供应商");
    const defaultSelect = document.createElement("select");
    for (const provider of providers) {
      const opt = document.createElement("option");
      opt.value = provider.id;
      opt.textContent = provider.label || provider.id;
      defaultSelect.appendChild(opt);
    }
    defaultSelect.value = draft.ai.defaultProviderId || providers[0].id;
    defaultSelect.addEventListener("change", () => {
      draft.ai.defaultProviderId = defaultSelect.value;
    });
    defaultProviderRowEl.appendChild(defaultLabel);
    defaultProviderRowEl.appendChild(defaultSelect);
  }

  function renderBody() {
    if (!scroll || !nav) {
      return;
    }
    nav.innerHTML = "";
    scroll.innerHTML = "";
    for (const section of EDITOR_SETTINGS_SECTIONS) {
      const navBtn = document.createElement("button");
      navBtn.type = "button";
      navBtn.className = "editorSettingsNavBtn";
      navBtn.dataset.sectionId = section.id;
      navBtn.textContent = settingsText(`settings.sections.${section.id}`, section.title);
      nav.appendChild(navBtn);

      const sectionEl = document.createElement("section");
      sectionEl.className = "editorSettingsSection";
      sectionEl.id = `editorSettingsSection-${section.id}`;
      sectionEl.dataset.sectionId = section.id;
      const title = document.createElement("h3");
      title.className = "editorSettingsSectionTitle";
      title.textContent = settingsText(`settings.sections.${section.id}`, section.title);
      sectionEl.appendChild(title);

      if (section.id === "ai") {
        const providersHeading = document.createElement("h4");
        providersHeading.className = "editorSettingsSectionTitle";
        providersHeading.textContent = settingsText("settings.providersHeading", "模型供应商");
        sectionEl.appendChild(providersHeading);

        providerListEl = document.createElement("div");
        providerListEl.className = "editorProviderList";
        sectionEl.appendChild(providerListEl);

        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "editorSettingsActionBtn addProviderBtn";
        addBtn.textContent = settingsText("settings.addProviderBtn", "+ 添加供应商");
        addBtn.addEventListener("click", () => {
          if (!draft) return;
          if (!Array.isArray(draft.ai.providers)) draft.ai.providers = [];
          const wasEmpty = draft.ai.providers.length === 0;
          const id = createEditorProviderId();
          draft.ai.providers.push({
            id,
            label: settingsText("settings.defaultProviderName", "供应商 {n}").replace(
              "{n}",
              String(draft.ai.providers.length + 1)
            ),
            provider: "chatgpt",
            model: "",
            apiKey: "",
            baseUrl: ""
          });
          // The very first provider ever added becomes the default silently (nothing to choose
          // between yet, matches the built-in provider's own auto-seed behavior). Adding a 2nd+
          // provider asks — users who add a provider and forget to flip the default is exactly
          // the confusion this prompt exists to prevent.
          if (wasEmpty || !draft.ai.defaultProviderId) {
            draft.ai.defaultProviderId = id;
            renderProviderList();
            return;
          }
          renderProviderList();
          void host
            ?.confirmYesNo(
              settingsText("settings.setAsDefaultProviderConfirm", "是否将新增的供应商设置为默认供应商？"),
              { title: settingsText("settings.setAsDefaultProviderTitle", "设为默认供应商") }
            )
            .then((yes) => {
              if (yes && draft) {
                draft.ai.defaultProviderId = id;
                renderProviderList();
              }
            });
        });
        sectionEl.appendChild(addBtn);

        defaultProviderRowEl = document.createElement("div");
        defaultProviderRowEl.className = "editorSettingsField";
        sectionEl.appendChild(defaultProviderRowEl);

        const behaviorHeading = document.createElement("h4");
        behaviorHeading.className = "editorSettingsSectionTitle";
        behaviorHeading.textContent = settingsText("settings.behaviorHeading", "生成与调整行为");
        sectionEl.appendChild(behaviorHeading);
      }

      for (const field of EDITOR_SETTINGS_FIELDS.filter((f) => f.section === section.id)) {
        const row = document.createElement("div");
        row.className =
          field.type === "checkbox" ? "editorSettingsField editorSettingsFieldCheck" : "editorSettingsField";
        const inputId = `editorSettingsField-${field.path.replace(/\./g, "-")}`;
        const label = document.createElement("label");
        label.setAttribute("for", inputId);
        let inputEl;
        const fieldLabel = settingsText(`settings.fields.${field.path}`, field.label);
        if (field.type === "checkbox") {
          inputEl = document.createElement("input");
          inputEl.type = "checkbox";
          inputEl.id = inputId;
          inputEl.dataset.settingsPath = field.path;
          label.appendChild(inputEl);
          label.appendChild(document.createTextNode(fieldLabel));
        } else if (field.type === "select") {
          label.textContent = fieldLabel;
          inputEl = document.createElement("select");
          inputEl.id = inputId;
          inputEl.dataset.settingsPath = field.path;
          for (const opt of field.options || []) {
            const option = document.createElement("option");
            option.value = opt.value;
            option.textContent = settingsText(
              `settings.options.${field.path}.${opt.value}`,
              opt.label
            );
            inputEl.appendChild(option);
          }
        } else if (field.type === "textarea") {
          label.textContent = fieldLabel;
          inputEl = document.createElement("textarea");
          inputEl.id = inputId;
          inputEl.dataset.settingsPath = field.path;
          inputEl.rows = 3;
        } else {
          label.textContent = fieldLabel;
          inputEl = document.createElement("input");
          inputEl.type =
            field.type === "password"
              ? "password"
              : field.type === "color"
                ? "color"
                : field.type === "number"
                  ? "number"
                  : "text";
          inputEl.id = inputId;
          inputEl.dataset.settingsPath = field.path;
          if (field.min != null) inputEl.min = String(field.min);
          if (field.max != null) inputEl.max = String(field.max);
          if (field.step != null) inputEl.step = String(field.step);
        }
        if (field.type !== "checkbox") {
          row.appendChild(label);
          row.appendChild(inputEl);
        } else {
          row.appendChild(label);
        }
        if (field.hint) {
          row.classList.add("editorSettingsFieldWithHint");
          const hint = document.createElement("div");
          hint.className = "editorSettingsHint";
          hint.textContent = settingsText(`settings.hints.${field.path}`, field.hint);
          row.appendChild(hint);
        }
        sectionEl.appendChild(row);
      }
      scroll.appendChild(sectionEl);
    }
  }

  function populateForm(source) {
    for (const field of EDITOR_SETTINGS_FIELDS) {
      const inputEl = scroll?.querySelector(`[data-settings-path="${field.path}"]`);
      writeSettingsFieldValueToInput(field, inputEl, getSettingsByPath(source, field.path));
    }
  }

  function readFormInto(target) {
    for (const field of EDITOR_SETTINGS_FIELDS) {
      const inputEl = scroll?.querySelector(`[data-settings-path="${field.path}"]`);
      const value = readSettingsFieldValueFromInput(field, inputEl);
      if (value !== undefined) {
        setSettingsByPath(target, field.path, value);
      }
    }
  }

  function bindScrollSpy() {
    scrollObserver?.disconnect();
    const sectionEls = scroll?.querySelectorAll(".editorSettingsSection");
    if (!sectionEls?.length) {
      return;
    }
    scrollObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible?.target?.dataset?.sectionId) {
          return;
        }
        const id = visible.target.dataset.sectionId;
        nav?.querySelectorAll(".editorSettingsNavBtn").forEach((btn) => {
          btn.classList.toggle("active", btn.dataset.sectionId === id);
        });
      },
      { root: scroll, rootMargin: "-20% 0px -55% 0px", threshold: [0, 0.15, 0.4, 0.7] }
    );
    sectionEls.forEach((el) => scrollObserver.observe(el));
  }

  function syncDeployAutoFitOverrideRowVisibility() {
    const deployEl = scroll?.querySelector('[data-settings-path="render.deployAutoFitCamera"]');
    const overrideRow = scroll
      ?.querySelector('[data-settings-path="render.deployAutoFitOverrideExplicitCamera"]')
      ?.closest(".editorSettingsField");
    if (!overrideRow) {
      return;
    }
    const on = deployEl?.type === "checkbox" && deployEl.checked;
    overrideRow.style.display = on ? "" : "none";
  }

  function wireEditorSettingsConditionalFields() {
    const deployEl = scroll?.querySelector('[data-settings-path="render.deployAutoFitCamera"]');
    syncDeployAutoFitOverrideRowVisibility();
    deployEl?.addEventListener("change", syncDeployAutoFitOverrideRowVisibility);
  }

  function refreshModalChrome() {
    const titleEl = document.getElementById("editorSettingsTitle");
    if (titleEl) {
      titleEl.textContent = settingsText("settings.modal.title", "Editor Settings");
    }
    if (saveBtn) {
      saveBtn.textContent = settingsText("settings.modal.save", "Save");
    }
    if (cancelBtn) {
      cancelBtn.textContent = settingsText("settings.modal.cancel", "Cancel");
    }
    if (resetBtn) {
      resetBtn.textContent = settingsText("settings.modal.reset", "Reset to Defaults");
    }
  }

  function refreshForLocale(currentSettings) {
    renderBody();
    wireEditorSettingsConditionalFields();
    refreshModalChrome();
    if (currentSettings) {
      draft = cloneEditorSettings(currentSettings);
      populateForm(draft);
      renderProviderList();
    }
  }

  function open(currentSettings, sectionId) {
    if (!modal) {
      return;
    }
    refreshModalChrome();
    draft = cloneEditorSettings(currentSettings);
    populateForm(draft);
    renderProviderList();
    modal.hidden = false;
    modal.classList.add("visible");
    bindScrollSpy();
    syncDeployAutoFitOverrideRowVisibility();
    if (sectionId) {
      document.getElementById(`editorSettingsSection-${sectionId}`)?.scrollIntoView({
        behavior: "auto",
        block: "start"
      });
    }
  }

  function close() {
    if (!modal) {
      return;
    }
    modal.classList.remove("visible");
    modal.hidden = true;
    draft = null;
    scrollObserver?.disconnect();
  }

  renderBody();
  wireEditorSettingsConditionalFields();
  refreshModalChrome();

  nav?.addEventListener("click", (event) => {
    const btn = event.target.closest(".editorSettingsNavBtn");
    if (!btn?.dataset?.sectionId) {
      return;
    }
    document.getElementById(`editorSettingsSection-${btn.dataset.sectionId}`)?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  });

  saveBtn?.addEventListener("click", () => {
    if (!draft) {
      return;
    }
    readFormInto(draft);
    onSave?.(cloneEditorSettings(draft));
    close();
  });

  cancelBtn?.addEventListener("click", close);
  resetBtn?.addEventListener("click", () => {
    void onReset?.();
  });

  modal?.addEventListener("click", (event) => {
    if (event.target === modal) {
      close();
    }
  });

  return {
    open,
    close,
    populateForm,
    refreshForLocale,
    mergeDraft(fileDefaults) {
      draft = deepMergeEditorSettings(fileDefaults, draft || {});
      populateForm(draft);
      renderProviderList();
    }
  };
}

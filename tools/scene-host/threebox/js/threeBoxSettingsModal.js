import {
  THREEBOX_SETTINGS_SECTIONS,
  THREEBOX_SETTINGS_FIELDS,
  THREEBOX_PROVIDER_TYPES
} from "./threeBoxSettingsSchema.js";
import {
  cloneThreeBoxSettings,
  getSettingsByPath,
  setSettingsByPath,
  loadThreeBoxSettingsBundle,
  persistThreeBoxSettings
} from "./threeBoxSettingsStore.js";
import { showToast } from "./threeBoxUiFeedback.js";
import { t } from "../../shared/i18n/index.js";

function createProviderId() {
  return `provider-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Derives a stable i18n key from a field's storage path (e.g. "general.locale" ->
 * "threebox.settings.field.general_locale") rather than storing the key in the schema itself —
 * keeps threeBoxSettingsSchema.js as plain zh-CN data (used as the `t()` fallback) while this
 * module owns the translation lookup. */
function fieldLabelKey(field) {
  return `threebox.settings.field.${field.path.replace(/\./g, "_")}`;
}

function fieldPlaceholderKey(field) {
  return `threebox.settings.fieldPlaceholder.${field.path.replace(/\./g, "_")}`;
}

function optionLabelKey(field, value) {
  return `threebox.settings.option.${field.path.replace(/\./g, "_")}.${value}`;
}

function sectionTitleKey(section) {
  return `threebox.settings.section.${section.id}`;
}

/**
 * @param {{ onSave?: (settings: object) => void }} [host]
 */
export function createThreeBoxSettingsModal(host = {}) {
  const modal = document.getElementById("settingsModal");
  const nav = document.getElementById("settingsNav");
  const scroll = document.getElementById("settingsScroll");
  const saveBtn = document.getElementById("settingsSaveBtn");
  const cancelBtn = document.getElementById("settingsCancelBtn");

  let settings = loadThreeBoxSettingsBundle();
  let draft = cloneThreeBoxSettings(settings);
  let activeSectionId = "general";

  function fieldsForSection(sectionId) {
    return THREEBOX_SETTINGS_FIELDS.filter((f) => f.section === sectionId);
  }

  function buildGenericField(field) {
    const row = document.createElement("div");
    row.className = "settingsField";
    const label = document.createElement("label");
    label.className = "settingsFieldLabel";
    label.textContent = t(fieldLabelKey(field), field.label);
    row.appendChild(label);

    const controlWrap = document.createElement("div");
    controlWrap.className = "settingsFieldControl";
    const value = getSettingsByPath(draft, field.path);

    let input;
    if (field.type === "checkbox") {
      input = document.createElement("input");
      input.type = "checkbox";
      input.checked = Boolean(value);
      input.addEventListener("change", () => setSettingsByPath(draft, field.path, input.checked));
    } else if (field.type === "select") {
      input = document.createElement("select");
      for (const [optValue, optLabel] of field.options || []) {
        const opt = document.createElement("option");
        opt.value = optValue;
        opt.textContent = t(optionLabelKey(field, optValue), optLabel);
        input.appendChild(opt);
      }
      input.value = value ?? "";
      input.addEventListener("change", () => setSettingsByPath(draft, field.path, input.value));
    } else if (field.type === "number") {
      input = document.createElement("input");
      input.type = "number";
      if (field.min != null) input.min = field.min;
      if (field.max != null) input.max = field.max;
      input.value = value ?? 0;
      input.addEventListener("change", () => setSettingsByPath(draft, field.path, Number(input.value)));
    } else if (field.type === "textarea") {
      input = document.createElement("textarea");
      input.rows = field.rows || 3;
      input.placeholder = field.placeholder ? t(fieldPlaceholderKey(field), field.placeholder) : "";
      input.value = value ?? "";
      input.addEventListener("change", () => setSettingsByPath(draft, field.path, input.value));
    } else {
      input = document.createElement("input");
      input.type = "text";
      input.value = value ?? "";
      input.addEventListener("change", () => setSettingsByPath(draft, field.path, input.value));
    }
    controlWrap.appendChild(input);
    row.appendChild(controlWrap);
    return row;
  }

  function buildProviderCard(provider) {
    const card = document.createElement("div");
    card.className = "providerCard";

    const labelRow = document.createElement("div");
    labelRow.className = "providerCardRow";
    const labelLabel = document.createElement("label");
    labelLabel.textContent = t("threebox.settings.provider.nameLabel", "名称");
    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.value = provider.label || "";
    labelInput.placeholder = t("threebox.settings.provider.namePlaceholder", "例如：我的 OpenAI");
    labelInput.addEventListener("input", () => {
      provider.label = labelInput.value;
    });
    labelRow.appendChild(labelLabel);
    labelRow.appendChild(labelInput);
    card.appendChild(labelRow);

    const typeRow = document.createElement("div");
    typeRow.className = "providerCardRow";
    const typeLabel = document.createElement("label");
    typeLabel.textContent = t("threebox.settings.provider.typeLabel", "供应商");
    const typeSelect = document.createElement("select");
    for (const [val, text] of THREEBOX_PROVIDER_TYPES) {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = t(`threebox.settings.providerType.${val}`, text);
      typeSelect.appendChild(opt);
    }
    typeSelect.value = provider.provider || "chatgpt";
    typeSelect.addEventListener("change", () => {
      provider.provider = typeSelect.value;
      renderActiveSection();
    });
    typeRow.appendChild(typeLabel);
    typeRow.appendChild(typeSelect);
    card.appendChild(typeRow);

    if (provider.provider === "custom") {
      const baseUrlRow = document.createElement("div");
      baseUrlRow.className = "providerCardRow";
      const baseUrlLabel = document.createElement("label");
      baseUrlLabel.textContent = t("threebox.settings.provider.baseUrlLabel", "Base URL");
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

    const modelRow = document.createElement("div");
    modelRow.className = "providerCardRow";
    const modelLabel = document.createElement("label");
    modelLabel.textContent = t("threebox.settings.provider.modelLabel", "模型");
    const modelInput = document.createElement("input");
    modelInput.type = "text";
    modelInput.value = provider.model || "";
    modelInput.placeholder = t("threebox.settings.provider.modelPlaceholder", "留空使用默认模型");
    modelInput.addEventListener("input", () => {
      provider.model = modelInput.value;
    });
    modelRow.appendChild(modelLabel);
    modelRow.appendChild(modelInput);
    card.appendChild(modelRow);

    const keyRow = document.createElement("div");
    keyRow.className = "providerCardRow";
    const keyLabel = document.createElement("label");
    keyLabel.textContent = t("threebox.settings.provider.apiKeyLabel", "API Key");
    const keyInput = document.createElement("input");
    keyInput.type = "password";
    keyInput.className = "providerApiKeyInput";
    keyInput.value = provider.apiKey || "";
    keyInput.autocomplete = "off";
    keyInput.addEventListener("input", () => {
      provider.apiKey = keyInput.value;
    });

    const keyControl = document.createElement("div");
    keyControl.className = "providerSecretControl";
    const keyVisibilityBtn = document.createElement("button");
    keyVisibilityBtn.type = "button";
    keyVisibilityBtn.className = "providerSecretToggle";
    keyVisibilityBtn.setAttribute("aria-pressed", "false");

    function updateKeyVisibilityButton(revealed) {
      const label = revealed
        ? t("threebox.settings.provider.hideApiKey", "隐藏 API Key")
        : t("threebox.settings.provider.showApiKey", "显示 API Key");
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
    card.insertBefore(keyRow, modelRow);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "providerCardDeleteBtn";
    deleteBtn.textContent = t("threebox.settings.provider.deleteBtn", "删除此供应商");
    deleteBtn.addEventListener("click", () => {
      draft.ai.providers = draft.ai.providers.filter((p) => p.id !== provider.id);
      if (draft.ai.defaultProviderId === provider.id) {
        draft.ai.defaultProviderId = draft.ai.providers[0]?.id || "";
      }
      renderActiveSection();
    });
    card.appendChild(deleteBtn);

    return card;
  }

  function buildAiSection() {
    const wrap = document.createElement("div");
    wrap.className = "settingsSectionPanel";

    const heading = document.createElement("div");
    heading.className = "settingsSectionHeading";
    heading.textContent = t("threebox.settings.providersHeading", "模型供应商");
    wrap.appendChild(heading);

    const providerList = document.createElement("div");
    providerList.className = "providerList";
    if (!draft.ai.providers?.length) {
      const hint = document.createElement("div");
      hint.className = "settingsEmptyHint";
      hint.textContent = t("threebox.settings.providersEmptyHint", "尚未添加任何供应商，添加后可在聊天输入框选择使用的模型。");
      providerList.appendChild(hint);
    } else {
      for (const provider of draft.ai.providers) {
        providerList.appendChild(buildProviderCard(provider));
      }
    }
    wrap.appendChild(providerList);

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "addProviderBtn";
    addBtn.textContent = t("threebox.settings.addProviderBtn", "+ 添加供应商");
    addBtn.addEventListener("click", () => {
      if (!Array.isArray(draft.ai.providers)) {
        draft.ai.providers = [];
      }
      const id = createProviderId();
      draft.ai.providers.push({
        id,
        label: t("threebox.settings.defaultProviderName", "供应商 {n}", { n: draft.ai.providers.length + 1 }),
        provider: "chatgpt",
        model: "",
        apiKey: "",
        baseUrl: ""
      });
      if (!draft.ai.defaultProviderId) {
        draft.ai.defaultProviderId = id;
      }
      renderActiveSection();
    });
    wrap.appendChild(addBtn);

    if (draft.ai.providers?.length) {
      const defaultRow = document.createElement("div");
      defaultRow.className = "settingsField";
      const defaultLabel = document.createElement("label");
      defaultLabel.className = "settingsFieldLabel";
      defaultLabel.textContent = t("threebox.settings.defaultProviderLabel", "默认模型供应商");
      const defaultControl = document.createElement("div");
      defaultControl.className = "settingsFieldControl";
      const defaultSelect = document.createElement("select");
      for (const provider of draft.ai.providers) {
        const opt = document.createElement("option");
        opt.value = provider.id;
        opt.textContent = provider.label || provider.id;
        defaultSelect.appendChild(opt);
      }
      defaultSelect.value = draft.ai.defaultProviderId || draft.ai.providers[0].id;
      defaultSelect.addEventListener("change", () => {
        draft.ai.defaultProviderId = defaultSelect.value;
      });
      defaultControl.appendChild(defaultSelect);
      defaultRow.appendChild(defaultLabel);
      defaultRow.appendChild(defaultControl);
      wrap.appendChild(defaultRow);
    }

    const behaviorHeading = document.createElement("div");
    behaviorHeading.className = "settingsSectionHeading";
    behaviorHeading.textContent = t("threebox.settings.behaviorHeading", "生成与调整行为");
    wrap.appendChild(behaviorHeading);

    for (const field of fieldsForSection("ai")) {
      wrap.appendChild(buildGenericField(field));
    }

    return wrap;
  }

  function buildGenericSection(sectionId) {
    const wrap = document.createElement("div");
    wrap.className = "settingsSectionPanel";
    for (const field of fieldsForSection(sectionId)) {
      wrap.appendChild(buildGenericField(field));
    }
    return wrap;
  }

  /** "General" section: the schema-driven fields (locale/theme/template-thumbnail toggle) plus a
   * hand-built sub-section with the two thumbnail-cache action buttons — these aren't settings
   * values so they don't fit the generic field loop, they call straight into
   * `host.onRebuildTemplateThumbnails` / `host.onClearTemplateThumbnails` (wired by threeBoxApp.js
   * to the live template gallery instance). */
  function buildGeneralSection() {
    const wrap = buildGenericSection("general");

    const heading = document.createElement("div");
    heading.className = "settingsSectionHeading";
    heading.textContent = t("threebox.settings.templateThumbHeading", "模板库缩略图缓存");
    wrap.appendChild(heading);

    const buttonRow = document.createElement("div");
    buttonRow.className = "settingsButtonRow";

    const rebuildBtn = document.createElement("button");
    rebuildBtn.type = "button";
    rebuildBtn.className = "settingsActionBtn";
    rebuildBtn.textContent = t("threebox.settings.rebuildThumbCacheBtn", "重建缩略图缓存");
    rebuildBtn.addEventListener("click", () => {
      host.onRebuildTemplateThumbnails?.();
      showToast(t("threebox.settings.rebuildThumbCacheToast", "正在后台重新生成模板缩略图…"), "info");
    });
    buttonRow.appendChild(rebuildBtn);

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "settingsActionBtn";
    clearBtn.textContent = t("threebox.settings.clearThumbCacheBtn", "清空缩略图缓存");
    clearBtn.addEventListener("click", () => {
      host.onClearTemplateThumbnails?.();
      showToast(t("threebox.settings.clearThumbCacheToast", "模板缩略图缓存已清空。"), "success");
    });
    buttonRow.appendChild(clearBtn);

    wrap.appendChild(buttonRow);
    return wrap;
  }

  function renderActiveSection() {
    if (!scroll) {
      return;
    }
    scroll.innerHTML = "";
    const panel =
      activeSectionId === "ai" ? buildAiSection()
      : activeSectionId === "general" ? buildGeneralSection()
      : buildGenericSection(activeSectionId);
    scroll.appendChild(panel);
  }

  function renderNav() {
    if (!nav) {
      return;
    }
    nav.innerHTML = "";
    for (const section of THREEBOX_SETTINGS_SECTIONS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "settingsNavBtn";
      btn.textContent = t(sectionTitleKey(section), section.title);
      btn.classList.toggle("active", section.id === activeSectionId);
      btn.addEventListener("click", () => {
        activeSectionId = section.id;
        renderNav();
        renderActiveSection();
      });
      nav.appendChild(btn);
    }
  }

  function open(sectionId = "general") {
    if (!modal) {
      return;
    }
    settings = loadThreeBoxSettingsBundle();
    draft = cloneThreeBoxSettings(settings);
    activeSectionId = THREEBOX_SETTINGS_SECTIONS.some((s) => s.id === sectionId) ? sectionId : "general";
    renderNav();
    renderActiveSection();
    modal.hidden = false;
  }

  function close() {
    if (modal) {
      modal.hidden = true;
    }
  }

  function commitSettings(nextSettings, { notify = true, toast = true, closeModal = true } = {}) {
    settings = cloneThreeBoxSettings(nextSettings);
    draft = cloneThreeBoxSettings(settings);
    persistThreeBoxSettings(settings);
    if (notify) {
      host.onSave?.(settings);
    }
    if (toast) {
      showToast(t("threebox.settings.savedToast", "设置已保存。"), "success");
    }
    if (closeModal) {
      close();
    }
    if (modal && !modal.hidden) {
      renderNav();
      renderActiveSection();
    }
  }

  function save() {
    commitSettings(draft);
  }

  function updateSettings(updater, options = {}) {
    const next = cloneThreeBoxSettings(settings);
    if (typeof updater === "function") {
      updater(next);
    }
    commitSettings(next, options);
    return settings;
  }

  function init() {
    saveBtn?.addEventListener("click", save);
    cancelBtn?.addEventListener("click", close);
    modal?.addEventListener("click", (event) => {
      if (event.target === modal) {
        close();
      }
    });
  }

  return {
    init,
    open,
    close,
    updateSettings,
    getSettings: () => settings
  };
}

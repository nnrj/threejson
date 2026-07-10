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

function createProviderId() {
  return `provider-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
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
    label.textContent = field.label;
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
        opt.textContent = optLabel;
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
    labelLabel.textContent = "名称";
    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.value = provider.label || "";
    labelInput.placeholder = "例如：我的 OpenAI";
    labelInput.addEventListener("input", () => {
      provider.label = labelInput.value;
    });
    labelRow.appendChild(labelLabel);
    labelRow.appendChild(labelInput);
    card.appendChild(labelRow);

    const typeRow = document.createElement("div");
    typeRow.className = "providerCardRow";
    const typeLabel = document.createElement("label");
    typeLabel.textContent = "供应商";
    const typeSelect = document.createElement("select");
    for (const [val, text] of THREEBOX_PROVIDER_TYPES) {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = text;
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
      baseUrlLabel.textContent = "Base URL";
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
    modelLabel.textContent = "模型";
    const modelInput = document.createElement("input");
    modelInput.type = "text";
    modelInput.value = provider.model || "";
    modelInput.placeholder = "留空使用默认模型";
    modelInput.addEventListener("input", () => {
      provider.model = modelInput.value;
    });
    modelRow.appendChild(modelLabel);
    modelRow.appendChild(modelInput);
    card.appendChild(modelRow);

    const keyRow = document.createElement("div");
    keyRow.className = "providerCardRow";
    const keyLabel = document.createElement("label");
    keyLabel.textContent = "API Key";
    const keyInput = document.createElement("input");
    keyInput.type = "password";
    keyInput.value = provider.apiKey || "";
    keyInput.autocomplete = "off";
    keyInput.addEventListener("input", () => {
      provider.apiKey = keyInput.value;
    });
    keyRow.appendChild(keyLabel);
    keyRow.appendChild(keyInput);
    card.appendChild(keyRow);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "providerCardDeleteBtn";
    deleteBtn.textContent = "删除此供应商";
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
    heading.textContent = "模型供应商";
    wrap.appendChild(heading);

    const providerList = document.createElement("div");
    providerList.className = "providerList";
    if (!draft.ai.providers?.length) {
      const hint = document.createElement("div");
      hint.className = "settingsEmptyHint";
      hint.textContent = "尚未添加任何供应商，添加后可在聊天输入框选择使用的模型。";
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
    addBtn.textContent = "+ 添加供应商";
    addBtn.addEventListener("click", () => {
      if (!Array.isArray(draft.ai.providers)) {
        draft.ai.providers = [];
      }
      const id = createProviderId();
      draft.ai.providers.push({ id, label: `供应商 ${draft.ai.providers.length + 1}`, provider: "chatgpt", model: "", apiKey: "", baseUrl: "" });
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
      defaultLabel.textContent = "默认模型供应商";
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
    behaviorHeading.textContent = "生成与调整行为";
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

  function renderActiveSection() {
    if (!scroll) {
      return;
    }
    scroll.innerHTML = "";
    const panel = activeSectionId === "ai" ? buildAiSection() : buildGenericSection(activeSectionId);
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
      btn.textContent = section.title;
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

  function save() {
    settings = cloneThreeBoxSettings(draft);
    persistThreeBoxSettings(settings);
    host.onSave?.(settings);
    showToast("设置已保存。", "success");
    close();
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
    getSettings: () => settings
  };
}

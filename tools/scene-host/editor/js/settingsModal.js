import {
  EDITOR_SETTINGS_FIELDS,
  EDITOR_SETTINGS_SECTIONS
} from "../../shared/js/editorSettingsSchema.js";
import {
  cloneEditorSettings,
  deepMergeEditorSettings,
  getSettingsByPath,
  setSettingsByPath
} from "../../shared/js/editorSettingsStore.js";
import { t } from "../../shared/i18n/index.js";

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

export function createSettingsModalController({ onSave, onReset }) {
  const modal = document.getElementById("editorSettingsModal");
  const nav = document.getElementById("editorSettingsNav");
  const scroll = document.getElementById("editorSettingsScroll");
  const saveBtn = document.getElementById("editorSettingsSaveBtn");
  const cancelBtn = document.getElementById("editorSettingsCancelBtn");
  const resetBtn = document.getElementById("editorSettingsResetBtn");
  let draft = null;
  let scrollObserver = null;

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
    }
  }

  function open(currentSettings) {
    if (!modal) {
      return;
    }
    refreshModalChrome();
    draft = cloneEditorSettings(currentSettings);
    populateForm(draft);
    modal.hidden = false;
    modal.classList.add("visible");
    bindScrollSpy();
    syncDeployAutoFitOverrideRowVisibility();
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
    }
  };
}

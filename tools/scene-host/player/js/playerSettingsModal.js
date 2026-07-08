import {
  PLAYER_SETTINGS_FIELDS,
  PLAYER_SETTINGS_SECTIONS
} from "../../shared/js/playerSettingsSchema.js";
import {
  clonePlayerSettings,
  deepMergePlayerSettings,
  getPlayerSettingsByPath,
  setPlayerSettingsByPath
} from "../../shared/js/playerSettingsStore.js";
import { t } from "../../shared/i18n/index.js";

function settingsText(key, fallback) {
  return t(key, fallback);
}

function writeFieldValue(field, inputEl, value) {
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
  inputEl.value = value != null ? String(value) : "";
}

function readFieldValue(field, inputEl) {
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
  return inputEl.value;
}

export function createPlayerSettingsModal({ getSettings, getFileDefaults, onSave, onReset }) {
  const modal = document.getElementById("playerSettingsModal");
  const nav = document.getElementById("playerSettingsNav");
  const scroll = document.getElementById("playerSettingsScroll");
  const saveBtn = document.getElementById("playerSettingsSaveBtn");
  const cancelBtn = document.getElementById("playerSettingsCancelBtn");
  const resetBtn = document.getElementById("playerSettingsResetBtn");
  let draft = null;
  let scrollObserver = null;

  function renderBody() {
    if (!scroll || !nav) {
      return;
    }
    nav.innerHTML = "";
    scroll.innerHTML = "";
    for (const section of PLAYER_SETTINGS_SECTIONS) {
      const navBtn = document.createElement("button");
      navBtn.type = "button";
      navBtn.className = "playerSettingsNavBtn";
      navBtn.dataset.sectionId = section.id;
      navBtn.textContent = settingsText(`player.settings.sections.${section.id}`, section.title);
      nav.appendChild(navBtn);

      const sectionEl = document.createElement("section");
      sectionEl.className = "playerSettingsSection";
      sectionEl.id = `playerSettingsSection-${section.id}`;
      sectionEl.dataset.sectionId = section.id;
      const title = document.createElement("h3");
      title.className = "playerSettingsSectionTitle";
      title.textContent = settingsText(`player.settings.sections.${section.id}`, section.title);
      sectionEl.appendChild(title);

      for (const field of PLAYER_SETTINGS_FIELDS.filter((f) => f.section === section.id)) {
        const row = document.createElement("div");
        row.className =
          field.type === "checkbox" ? "playerSettingsField playerSettingsFieldCheck" : "playerSettingsField";
        const inputId = `playerSettingsField-${field.path.replace(/\./g, "-")}`;
        const label = document.createElement("label");
        label.setAttribute("for", inputId);
        let inputEl;
        const fieldLabel = settingsText(`player.settings.fields.${field.path}`, field.label);
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
            const optionEl = document.createElement("option");
            optionEl.value = opt.value;
            optionEl.textContent = settingsText(
              `player.settings.options.${field.path}.${opt.value}`,
              opt.label
            );
            inputEl.appendChild(optionEl);
          }
          row.appendChild(label);
          row.appendChild(inputEl);
        } else {
          label.textContent = fieldLabel;
          inputEl = document.createElement("input");
          inputEl.type = field.type === "color" ? "color" : field.type === "number" ? "number" : "text";
          inputEl.id = inputId;
          inputEl.dataset.settingsPath = field.path;
          if (field.min != null) {
            inputEl.min = String(field.min);
          }
          if (field.max != null) {
            inputEl.max = String(field.max);
          }
          row.appendChild(label);
          row.appendChild(inputEl);
        }
        if (field.type === "checkbox") {
          row.appendChild(label);
        }
        if (field.hint) {
          row.classList.add("playerSettingsFieldWithHint");
          const hint = document.createElement("div");
          hint.className = "playerSettingsHint";
          hint.textContent = settingsText(`player.settings.hints.${field.path}`, field.hint);
          row.appendChild(hint);
        }
        sectionEl.appendChild(row);
      }
      scroll.appendChild(sectionEl);
    }
  }

  function populateForm(source) {
    for (const field of PLAYER_SETTINGS_FIELDS) {
      const inputEl = scroll?.querySelector(`[data-settings-path="${field.path}"]`);
      writeFieldValue(field, inputEl, getPlayerSettingsByPath(source, field.path));
    }
  }

  function readFormInto(target) {
    for (const field of PLAYER_SETTINGS_FIELDS) {
      const inputEl = scroll?.querySelector(`[data-settings-path="${field.path}"]`);
      const value = readFieldValue(field, inputEl);
      if (value !== undefined) {
        setPlayerSettingsByPath(target, field.path, value);
      }
    }
  }

  function bindScrollSpy() {
    scrollObserver?.disconnect();
    const sectionEls = scroll?.querySelectorAll(".playerSettingsSection");
    if (!sectionEls?.length) {
      return;
    }
    scrollObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        const id = visible?.target?.dataset?.sectionId;
        if (!id) {
          return;
        }
        nav?.querySelectorAll(".playerSettingsNavBtn").forEach((btn) => {
          btn.classList.toggle("active", btn.dataset.sectionId === id);
        });
      },
      { root: scroll, rootMargin: "-20% 0px -55% 0px", threshold: [0, 0.15, 0.4, 0.7] }
    );
    sectionEls.forEach((el) => scrollObserver.observe(el));
  }

  function refreshModalChrome() {
    const titleEl = document.getElementById("playerSettingsTitle");
    if (titleEl) {
      titleEl.textContent = settingsText("player.settings.modal.title", "Player Settings");
    }
    if (saveBtn) {
      saveBtn.textContent = settingsText("player.settings.modal.save", "Save & Apply");
    }
    if (cancelBtn) {
      cancelBtn.textContent = settingsText("player.settings.modal.cancel", "Cancel");
    }
    if (resetBtn) {
      resetBtn.textContent = settingsText("player.settings.modal.reset", "Reset to Defaults");
    }
  }

  function refreshForLocale(currentSettings) {
    renderBody();
    refreshModalChrome();
    if (currentSettings) {
      draft = clonePlayerSettings(currentSettings);
      populateForm(draft);
    }
  }

  function open() {
    if (!modal) {
      return;
    }
    renderBody();
    refreshModalChrome();
    draft = clonePlayerSettings(getSettings());
    populateForm(draft);
    modal.hidden = false;
    modal.classList.add("visible");
    bindScrollSpy();
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
  refreshModalChrome();
  saveBtn?.addEventListener("click", () => {
    if (!draft) {
      return;
    }
    readFormInto(draft);
    const merged = deepMergePlayerSettings(getFileDefaults(), draft);
    onSave(merged);
    close();
  });
  cancelBtn?.addEventListener("click", close);
  resetBtn?.addEventListener("click", () => {
    void onReset();
    populateForm(getSettings());
  });
  modal?.addEventListener("click", (event) => {
    if (event.target === modal) {
      close();
    }
  });
  nav?.addEventListener("click", (event) => {
    const btn = event.target.closest(".playerSettingsNavBtn");
    if (!btn?.dataset?.sectionId) {
      return;
    }
    document.getElementById(`playerSettingsSection-${btn.dataset.sectionId}`)?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  });

  return { open, close, refreshForLocale };
}

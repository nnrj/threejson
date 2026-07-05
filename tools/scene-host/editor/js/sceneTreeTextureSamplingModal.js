import {
  applyExplicitSamplingToMaterial,
  clearExplicitSamplingFromMaterial,
  formatEffectiveSummaryForMaterial,
  readExplicitSamplingFromMaterial,
  serializeFilterForForm
} from "./sceneTreeTextureSamplingHelpers.js";
import { syncEditorMeshVisualFromObjJson } from "./editorMeshVisualSync.js";
import { getByPointer } from "../../../../core/util/jsonPointer.js";

const FILTER_OPTIONS = [
  "",
  "nearest",
  "linear",
  "nearestMipmapNearest",
  "linearMipmapNearest",
  "nearestMipmapLinear",
  "linearMipmapLinear"
];

function buildFilterOptions(selected) {
  return FILTER_OPTIONS.map((v) => {
    const label = v || "（默认）";
    const sel = v === selected ? " selected" : "";
    return `<option value="${v.replace(/"/g, "&quot;")}"${sel}>${label}</option>`;
  }).join("");
}

export function createTextureSamplingAdvancedModal(host) {
  const modal = document.getElementById("textureSamplingAdvancedModal");
  const titleEl = modal?.querySelector("[data-ts-modal-title]");
  const summaryEl = modal?.querySelector("[data-ts-modal-summary]");
  const optOutEl = modal?.querySelector("[data-ts-opt-out]");
  const mipEl = modal?.querySelector("[data-ts-mipmaps]");
  const minEl = modal?.querySelector("[data-ts-min-filter]");
  const magEl = modal?.querySelector("[data-ts-mag-filter]");
  const anisoEl = modal?.querySelector("[data-ts-anisotropy]");
  const csEl = modal?.querySelector("[data-ts-color-space]");
  const btnApply = modal?.querySelector("[data-ts-apply]");
  const btnCancel = modal?.querySelector("[data-ts-cancel]");
  const btnReset = modal?.querySelector("[data-ts-reset]");

  /** @type {{ pointer: string, profileName: string, slotLabel: string, rootData: object, mesh: object|null }|null} */
  let session = null;

  function closeModal() {
    modal?.classList.remove("visible");
    if (modal) {
      modal.hidden = true;
    }
    session = null;
  }

  function refreshSummary() {
    if (!summaryEl || !session?.rootData) {
      return;
    }
    const mat = getByPointer(session.rootData, session.pointer);
    summaryEl.textContent = mat
      ? `当前生效：${formatEffectiveSummaryForMaterial(mat, session.profileName) || "—"}`
      : "";
  }

  function loadFormFromMaterial(mat) {
    const ex = readExplicitSamplingFromMaterial(mat);
    if (optOutEl) {
      optOutEl.checked = ex._optOut === true;
    }
    if (mipEl) {
      mipEl.checked = ex.generateMipmaps === true;
      mipEl.indeterminate = ex.generateMipmaps === undefined;
    }
    if (minEl) {
      minEl.innerHTML = buildFilterOptions(serializeFilterForForm(ex.minFilter));
    }
    if (magEl) {
      magEl.innerHTML = buildFilterOptions(serializeFilterForForm(ex.magFilter));
    }
    if (anisoEl) {
      anisoEl.value = ex.anisotropy !== undefined ? String(ex.anisotropy) : "";
    }
    if (csEl) {
      csEl.value = ex.colorSpace ? String(ex.colorSpace) : "";
    }
    refreshSummary();
  }

  function openModal({ pointer, profileName, slotLabel, rootData, mesh, onCommitted }) {
    if (!modal) {
      return;
    }
    session = { pointer, profileName, slotLabel, rootData, mesh, onCommitted };
    if (titleEl) {
      titleEl.textContent = `纹理采样 · ${slotLabel || pointer}`;
    }
    const mat = getByPointer(rootData, pointer);
    loadFormFromMaterial(mat);
    modal.hidden = false;
    modal.classList.add("visible");
  }

  btnCancel?.addEventListener("click", () => closeModal());
  modal?.addEventListener("click", (ev) => {
    if (ev.target === modal) {
      closeModal();
    }
  });

  btnReset?.addEventListener("click", () => {
    if (!session) {
      return;
    }
    const mat = getByPointer(session.rootData, session.pointer);
    if (mat) {
      clearExplicitSamplingFromMaterial(mat);
      loadFormFromMaterial(mat);
    }
  });

  btnApply?.addEventListener("click", () => {
    if (!session) {
      return;
    }
    const mat = getByPointer(session.rootData, session.pointer);
    if (!mat) {
      closeModal();
      return;
    }
    applyExplicitSamplingToMaterial(mat, {
      optOut: optOutEl?.checked === true,
      generateMipmaps: mipEl?.indeterminate ? undefined : mipEl?.checked === true,
      minFilter: minEl?.value || undefined,
      magFilter: magEl?.value || undefined,
      anisotropy: anisoEl?.value,
      colorSpace: csEl?.value || undefined
    }, session.profileName);
    host.markSceneDirty?.();
    if (session.mesh) {
      syncEditorMeshVisualFromObjJson(session.mesh, session.rootData);
    }
    session.onCommitted?.();
    closeModal();
  });

  return { openModal, closeModal };
}

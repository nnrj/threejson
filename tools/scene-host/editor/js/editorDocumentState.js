/** Editor document dirty state + overwrite confirmation modal. */
import { t } from "../../shared/i18n/index.js";

export function createEditorDocumentState(host) {
  let editorDirty = false;

  const modal = document.getElementById("editorOverwriteModal");
  const messageEl = document.getElementById("editorOverwriteMessage");
  const cancelBtn = document.getElementById("editorOverwriteCancelBtn");
  const saveBtn = document.getElementById("editorOverwriteSaveBtn");
  const confirmBtn = document.getElementById("editorOverwriteConfirmBtn");

  function syncDocumentTitle() {
    const base =
      host.getEditorSettings()?.general?.baseTitle?.trim() ||
      t("editor.shell.pageTitle", "Scene Editor");
    document.title = editorDirty ? `${base} *` : base;
  }

  function markDirty() {
    if (!editorDirty) {
      editorDirty = true;
      syncDocumentTitle();
    }
  }

  function markSaved() {
    editorDirty = false;
    syncDocumentTitle();
  }

  function isDirty() {
    return editorDirty;
  }

  function openOverwriteConfirmModalAndWait(options = {}) {
    const {
      actionLabel = "继续操作",
      saveLabel = "先保存再覆盖",
      confirmLabel = "直接覆盖",
      cancelLabel = "取消",
      message
    } = options;
    if (messageEl) {
      messageEl.textContent =
        message ||
        `当前场景有未保存的修改。\n${actionLabel}将覆盖当前编辑内容（含 Code 模式中尚未应用到 3D 的修改）。\n请选择如何处理：`;
    }
    if (saveBtn) {
      saveBtn.textContent = saveLabel;
    }
    if (confirmBtn) {
      confirmBtn.textContent = confirmLabel;
    }
    if (cancelBtn) {
      cancelBtn.textContent = cancelLabel;
    }
    modal?.classList.add("visible");
    requestAnimationFrame(() => {
      confirmBtn?.focus({ preventScroll: true });
    });
    return new Promise((resolve) => {
      let settled = false;
      const cleanup = () => {
        modal?.classList.remove("visible");
      };
      const finish = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
      };
      const onMask = (event) => {
        if (event.target === modal) {
          finish("cancel");
        }
      };
      const dialogPanel = modal?.querySelector(".tjzExportDialog");
      const stopBubble = (event) => {
        event.stopPropagation();
      };
      const once = { once: true };
      cancelBtn?.addEventListener("click", () => finish("cancel"), once);
      saveBtn?.addEventListener("click", () => finish("save"), once);
      confirmBtn?.addEventListener("click", () => finish("overwrite"), once);
      dialogPanel?.addEventListener("pointerdown", stopBubble, once);
      modal?.addEventListener("click", onMask, once);
    });
  }

  async function confirmOverwriteIfDirty(options = {}) {
    if (!editorDirty) {
      return true;
    }
    const choice = await openOverwriteConfirmModalAndWait(options);
    if (choice === "cancel") {
      return false;
    }
    if (choice === "save") {
      await host.getSceneDocumentOps()?.persistUserSceneBaseline?.(true);
      markSaved();
    }
    return true;
  }

  syncDocumentTitle();

  return {
    markDirty,
    markSaved,
    isDirty,
    confirmOverwriteIfDirty,
    openTriChoiceModal: openOverwriteConfirmModalAndWait,
    syncDocumentTitle
  };
}
